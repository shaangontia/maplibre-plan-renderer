#!/usr/bin/env node
"use strict";

/**
 * plan2png.js — Convert a calibrated GeoPDF (PDFKit GEO: Keywords format) to PNG
 * and emit a plans.json-compatible record with extracted geo-coordinates.
 *
 * Usage:
 *   node plan2png.js <plan.pdf> [--page 1] [--dpi 300] [--outDir <dir>] [--imageName <name.png>] [--jsonName <name.json>]
 *
 * Outputs:
 *   <outDir>/<imageName>   — rasterised PNG of page 1
 *   <outDir>/<jsonName>    — JSON array with one plans.json-compatible record
 *
 * Requires: poppler-utils (pdftoppm) — install via `brew install poppler`
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { v4: uuidv4 } = require("uuid");

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function die(msg, code = 1) {
  process.stderr.write(msg + "\n");
  process.exit(code);
}

function parseArgs(argv) {
  const args = { pdf: null, page: 1, dpi: 300, outDir: null, imageName: null, jsonName: null };
  const a = argv.slice(2);
  if (a.length === 0) {
    die(
      "Usage: node plan2png.js <plan.pdf> [--page 1] [--dpi 300] [--outDir <dir>] [--imageName <name.png>] [--jsonName <name.json>]"
    );
  }
  args.pdf = a[0];
  for (let i = 1; i < a.length; i++) {
    const k = a[i], v = a[i + 1];
    if      (k === "--page")      { args.page      = Number(v); i++; }
    else if (k === "--dpi")       { args.dpi        = Number(v); i++; }
    else if (k === "--outDir")    { args.outDir     = v;         i++; }
    else if (k === "--imageName") { args.imageName  = v;         i++; }
    else if (k === "--jsonName")  { args.jsonName   = v;         i++; }
    else { die(`Unknown argument: ${k}`); }
  }
  if (!args.pdf) die("Missing PDF path.");
  if (!Number.isFinite(args.page) || args.page < 1) die("--page must be >= 1");
  if (!Number.isFinite(args.dpi)  || args.dpi  < 30) die("--dpi must be >= 30");
  return args;
}

// ---------------------------------------------------------------------------
// GEO metadata extraction (raw PDF string parsing — no external deps needed)
// ---------------------------------------------------------------------------

/**
 * Reads the raw PDF bytes and finds the GEO: keyword string embedded by PDFKit.
 * Format stored in PDF: (GEO:CRS=EPSG:4326; GEO:TOPLEFT=lon,lat; ...)
 * Returns a structured object or throws.
 */
function extractGeoMetadata(pdfPath) {
  const buf = fs.readFileSync(pdfPath);
  // PDF strings are latin1-encoded; search for our GEO: marker
  const raw = buf.toString("latin1");

  const match = raw.match(/\(GEO:([^)]+)\)/);
  if (!match) {
    throw new Error(
      "No GEO: metadata found in PDF Keywords.\n" +
      "This tool expects PDFKit-generated GeoPDFs with Keywords containing GEO:CRS=...; GEO:TOPLEFT=...; etc."
    );
  }

  const geoStr = match[1]; // e.g. "GEO:CRS=EPSG:4326; GEO:TOPLEFT=13.413,52.5218; ..."
  const geo = {};
  for (const part of geoStr.split(";").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^GEO:([^=]+)=(.+)$/);
    if (!m) continue;
    geo[m[1].toLowerCase()] = m[2].trim();
  }

  const parseCoord = (key) => {
    const v = geo[key];
    if (!v) throw new Error(`Missing GEO:${key.toUpperCase()} in PDF Keywords`);
    const nums = v.split(",").map(Number);
    if (nums.length !== 2 || !nums.every(Number.isFinite)) {
      throw new Error(`Invalid coordinate for GEO:${key.toUpperCase()}: "${v}"`);
    }
    return nums; // [lon, lat]
  };

  return {
    crs:         geo.crs         || "EPSG:4326",
    building:    geo.building    || "",
    floor:       geo.floor       || "",
    site:        geo.site        || "",
    topLeft:     parseCoord("topleft"),
    topRight:    parseCoord("topright"),
    bottomRight: parseCoord("bottomright"),
    bottomLeft:  parseCoord("bottomleft"),
  };
}

// ---------------------------------------------------------------------------
// PDF → PNG rendering via pdftoppm (poppler)
// ---------------------------------------------------------------------------

/**
 * Uses pdftoppm to render one page of the PDF to PNG.
 * pdftoppm outputs files named <prefix>-<page>.png (zero-padded).
 * Returns the path of the generated PNG.
 */
function renderPageToPng(pdfAbs, pageNumber, dpi, outPngPath) {
  // Check pdftoppm is available
  const which = spawnSync("which", ["pdftoppm"], { encoding: "utf8" });
  if (which.status !== 0) {
    die(
      "pdftoppm not found. Install poppler:\n  brew install poppler\n  # or: sudo apt-get install poppler-utils"
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "plan2png-"));
  const tmpPrefix = path.join(tmpDir, "page");

  const res = spawnSync(
    "pdftoppm",
    [
      "-png",
      "-r", String(dpi),
      "-f", String(pageNumber),
      "-l", String(pageNumber),
      "-singlefile",
      pdfAbs,
      tmpPrefix,
    ],
    { encoding: "utf8" }
  );

  if (res.error) die(`pdftoppm failed to start: ${res.error.message}`);
  if (res.status !== 0) die(`pdftoppm error:\n${res.stderr || res.stdout || "(no output)"}`);

  // pdftoppm with -singlefile writes exactly <tmpPrefix>.png
  const tmpPng = tmpPrefix + ".png";
  if (!fs.existsSync(tmpPng)) {
    die(`pdftoppm succeeded but output PNG not found at: ${tmpPng}`);
  }

  fs.copyFileSync(tmpPng, outPngPath);
  fs.rmSync(tmpDir, { recursive: true, force: true });

  console.log(`  Rendered page ${pageNumber} at ${dpi} DPI → ${outPngPath}`);
}

// ---------------------------------------------------------------------------
// Build plans.json-compatible record
// ---------------------------------------------------------------------------

function buildPlanRecord({ pdfAbs, pdfBaseName, imageFileName, geo }) {
  const nowIso = new Date().toISOString();
  return {
    id:          uuidv4(),
    name:        geo.building || pdfBaseName,
    imagePath:   imageFileName,
    pdfPath:     path.basename(pdfAbs),
    corners: {
      topLeft:     geo.topLeft,
      topRight:    geo.topRight,
      bottomRight: geo.bottomRight,
      bottomLeft:  geo.bottomLeft,
    },
    opacity:          0.85,
    rotation:         0,
    floor:            geo.floor,
    building:         geo.building,
    site:             geo.site,
    crs:              geo.crs,
    calibrationMethod: "geopdf",
    createdAt:        nowIso,
    updatedAt:        nowIso,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args   = parseArgs(process.argv);
  const pdfAbs = path.resolve(args.pdf);

  if (!fs.existsSync(pdfAbs)) die(`PDF not found: ${pdfAbs}`);

  const outDir      = path.resolve(args.outDir || path.dirname(pdfAbs));
  const pdfBaseName = path.basename(pdfAbs, path.extname(pdfAbs));
  const imageFileName = args.imageName || `${pdfBaseName}.png`;
  const jsonFileName  = args.jsonName  || `${pdfBaseName}.plan.json`;

  fs.mkdirSync(outDir, { recursive: true });

  // 1. Extract geo metadata
  console.log(`Extracting geo metadata from: ${pdfAbs}`);
  const geo = extractGeoMetadata(pdfAbs);
  console.log(`  CRS:      ${geo.crs}`);
  console.log(`  Building: ${geo.building}`);
  console.log(`  Floor:    ${geo.floor}`);
  console.log(`  Site:     ${geo.site}`);
  console.log(`  TopLeft:  [${geo.topLeft}]`);
  console.log(`  TopRight: [${geo.topRight}]`);
  console.log(`  BotRight: [${geo.bottomRight}]`);
  console.log(`  BotLeft:  [${geo.bottomLeft}]`);

  // 2. Render PDF page → PNG
  const outPngPath  = path.join(outDir, imageFileName);
  console.log(`\nRendering PDF page ${args.page} to PNG...`);
  renderPageToPng(pdfAbs, args.page, args.dpi, outPngPath);

  // 3. Build and write plans.json-compatible record
  const record = buildPlanRecord({ pdfAbs, pdfBaseName, imageFileName, geo });
  const outJsonPath = path.join(outDir, jsonFileName);
  fs.writeFileSync(outJsonPath, JSON.stringify([record], null, 2), "utf8");

  const pngSize = (fs.statSync(outPngPath).size / 1024).toFixed(1);
  console.log(`\nDone.`);
  console.log(`  PNG  (${pngSize} KB): ${outPngPath}`);
  console.log(`  JSON:              ${outJsonPath}`);
}

main();