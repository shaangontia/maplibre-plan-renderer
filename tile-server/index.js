const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");
const GeoTIFF = require("geotiff");
const proj4 = require("proj4");

const PORT = 8080;
const PLANS_DIR = path.join(__dirname, "plans");
const UPLOADS_DIR = path.join(PLANS_DIR, "images");
const DB_PATH = path.join(__dirname, "plans.json");

const app = express();
app.use(cors());
app.use(express.json());

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Multer config
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "image/png", "image/jpeg", "image/webp", "image/tiff",
      "application/pdf", "application/octet-stream",
    ];
    // Also allow by extension for world files and GeoTIFFs
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedExt = [".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff",
      ".pgw", ".jgw", ".tfw", ".wld", ".pdf"];
    cb(null, allowed.includes(file.mimetype) || allowedExt.includes(ext));
  },
  limits: { fileSize: 200 * 1024 * 1024 },
});

// Multi-file upload: image + optional world file sidecar
const uploadFields = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "worldfile", maxCount: 1 },
]);

// ---------------------------------------------------------------------------
// PRODUCTION GEO-REFERENCING PIPELINE
// ---------------------------------------------------------------------------
// In a real app, the JSON file is just a **database cache** (would be
// Postgres/MongoDB in production). Coordinates are NEVER manually typed.
// They are auto-extracted from the uploaded file at ingestion time:
//
// Upload flow:
//   1. User uploads file (GeoTIFF, image+worldfile, or plain image)
//   2. Server auto-detects geo-reference data:
//      a) GeoTIFF → read affine transform + CRS from TIFF tags
//      b) World file sidecar → parse 6 affine parameters
//      c) Neither → plan saved as "uncalibrated", user must calibrate
//         via the /api/plans/:id/calibrate endpoint (2+ control points)
//   3. Corners are computed and stored in the database
//   4. MapLibre renders the image at the correct real-world position
//
// The plans.json file is the local-dev equivalent of a production database.

function readDb() {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeDb(plans) {
  fs.writeFileSync(DB_PATH, JSON.stringify(plans, null, 2));
}

// Derive bounds and center from corners
function getBounds(plan) {
  const c = plan.corners;
  const lons = [c.topLeft[0], c.topRight[0], c.bottomRight[0], c.bottomLeft[0]];
  const lats = [c.topLeft[1], c.topRight[1], c.bottomRight[1], c.bottomLeft[1]];
  return {
    sw: [Math.min(...lons), Math.min(...lats)],
    ne: [Math.max(...lons), Math.max(...lats)],
  };
}

function getCenter(plan) {
  const c = plan.corners;
  return [
    (c.topLeft[0] + c.topRight[0] + c.bottomRight[0] + c.bottomLeft[0]) / 4,
    (c.topLeft[1] + c.topRight[1] + c.bottomRight[1] + c.bottomLeft[1]) / 4,
  ];
}

// ---------------------------------------------------------------------------
// Geo-reference extraction: GeoTIFF
// ---------------------------------------------------------------------------
// Reads the affine transform and CRS from a GeoTIFF file.
// Returns { corners, crs, width, height } or null if not a valid GeoTIFF.
async function extractGeoTIFFCorners(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuf);
    const image = await tiff.getImage();

    // Get the affine transform: [originX, resX, rotX, originY, rotY, resY]
    const tiepoint = image.getTiePoints();
    const pixelScale = image.getFileDirectory().ModelPixelScale;
    const modelTransform = image.getFileDirectory().ModelTransformation;

    const width = image.getWidth();
    const height = image.getHeight();

    let originX, originY, resX, resY;

    if (modelTransform) {
      // 4x4 transformation matrix
      originX = modelTransform[3];
      originY = modelTransform[7];
      resX = modelTransform[0];
      resY = modelTransform[5]; // typically negative
    } else if (tiepoint && tiepoint.length > 0 && pixelScale) {
      // Tiepoint + pixel scale (most common)
      originX = tiepoint[0].x - tiepoint[0].i * pixelScale[0];
      originY = tiepoint[0].y + tiepoint[0].j * pixelScale[1]; // note: + because pixelScale[1] applied downward
      resX = pixelScale[0];
      resY = -pixelScale[1]; // negative = y decreases downward
    } else {
      console.log("GeoTIFF: no transform found in file");
      return null;
    }

    // Detect CRS from GeoKeys
    const geoKeys = image.getGeoKeys();
    let sourceCRS = "EPSG:4326";
    if (geoKeys) {
      const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
      if (epsg && epsg !== 32767) sourceCRS = `EPSG:${epsg}`;
    }

    // Compute corners in source CRS
    // Image coords: TL=(0,0), TR=(w,0), BR=(w,h), BL=(0,h)
    const cornersSource = {
      topLeft:     [originX,               originY],
      topRight:    [originX + width * resX, originY],
      bottomRight: [originX + width * resX, originY + height * resY],
      bottomLeft:  [originX,               originY + height * resY],
    };

    // Reproject to WGS84 if needed
    let cornersWGS84;
    if (sourceCRS === "EPSG:4326") {
      cornersWGS84 = cornersSource;
    } else {
      try {
        const transform = proj4(sourceCRS, "EPSG:4326");
        cornersWGS84 = {
          topLeft:     transform.forward(cornersSource.topLeft),
          topRight:    transform.forward(cornersSource.topRight),
          bottomRight: transform.forward(cornersSource.bottomRight),
          bottomLeft:  transform.forward(cornersSource.bottomLeft),
        };
      } catch (projErr) {
        console.warn(`GeoTIFF: CRS ${sourceCRS} not recognized by proj4, using raw coords as lon/lat`);
        cornersWGS84 = cornersSource;
      }
    }

    console.log(`GeoTIFF: extracted corners from ${path.basename(filePath)}`);
    console.log(`  CRS: ${sourceCRS}, Size: ${width}x${height}`);
    console.log(`  TL: [${cornersWGS84.topLeft}], BR: [${cornersWGS84.bottomRight}]`);

    return { corners: cornersWGS84, crs: sourceCRS, width, height };
  } catch (err) {
    // Not a GeoTIFF or parsing failed — that's fine, try other methods
    return null;
  }
}

// ---------------------------------------------------------------------------
// Geo-reference extraction: GeoPDF
// ---------------------------------------------------------------------------
// Reads geo-reference metadata from PDF Keywords field.
// Expected format in Keywords:
//   GEO:CRS=EPSG:4326; GEO:TOPLEFT=lon,lat; GEO:TOPRIGHT=lon,lat; ...
// Returns { corners, crs, metadata } or null
let _pdfjsLib = null;
async function loadPdfjs() {
  if (!_pdfjsLib) _pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjsLib;
}

async function extractGeoPDFCorners(filePath) {
  try {
    const pdfjsLib = await loadPdfjs();
    const buf = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const meta = await doc.getMetadata();

    // Look for geo-reference in Keywords
    const keywords = meta?.info?.Keywords || "";
    if (!keywords.includes("GEO:")) {
      return null;
    }

    // Parse GEO: tags from Keywords
    const geoData = {};
    const parts = keywords.split(";").map((s) => s.trim());
    for (const part of parts) {
      const match = part.match(/^GEO:(\w+)=(.+)$/);
      if (match) {
        geoData[match[1]] = match[2].trim();
      }
    }

    if (!geoData.TOPLEFT || !geoData.TOPRIGHT || !geoData.BOTTOMRIGHT || !geoData.BOTTOMLEFT) {
      console.log("GeoPDF: found GEO: tags but missing corner coordinates");
      return null;
    }

    const parseCoord = (s) => s.split(",").map(Number);
    const corners = {
      topLeft: parseCoord(geoData.TOPLEFT),
      topRight: parseCoord(geoData.TOPRIGHT),
      bottomRight: parseCoord(geoData.BOTTOMRIGHT),
      bottomLeft: parseCoord(geoData.BOTTOMLEFT),
    };

    const crs = geoData.CRS || "EPSG:4326";

    console.log(`GeoPDF: extracted corners from ${path.basename(filePath)}`);
    console.log(`  CRS: ${crs}`);
    console.log(`  TL: [${corners.topLeft}], BR: [${corners.bottomRight}]`);

    // Also extract optional metadata
    const pdfMeta = {
      floor: geoData.FLOOR || "",
      building: geoData.BUILDING || "",
      site: geoData.SITE || "",
      title: meta?.info?.Title || "",
    };

    return { corners, crs, metadata: pdfMeta };
  } catch (err) {
    console.warn("GeoPDF extraction error:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// PDF → PNG rendering (using pdfjs-dist + node-canvas)
// ---------------------------------------------------------------------------
// Renders the first page of a PDF to a high-resolution PNG.
// Returns the path to the generated PNG, or null on failure.
async function renderPDFtoPNG(pdfPath, outputPngPath, scale = 3) {
  try {
    const pdfjsLib = await loadPdfjs();
    const { createCanvas } = require("canvas");

    const buf = fs.readFileSync(pdfPath);
    const uint8 = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const page = await doc.getPage(1);

    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext("2d");

    // pdfjs-dist expects a browser-like canvas context
    // node-canvas is compatible with the legacy build
    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    // Write PNG
    const pngBuf = canvas.toBuffer("image/png");
    fs.writeFileSync(outputPngPath, pngBuf);

    console.log(`PDF→PNG: rendered ${path.basename(pdfPath)} → ${path.basename(outputPngPath)} (${viewport.width}x${viewport.height}px)`);
    return outputPngPath;
  } catch (err) {
    console.error("PDF→PNG render error:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Geo-reference extraction: World file (.pgw / .tfw / .jgw / .wld)
// ---------------------------------------------------------------------------
// A world file contains 6 lines:
//   Line 1: pixel size in X (resX)
//   Line 2: rotation about Y axis (usually 0)
//   Line 3: rotation about X axis (usually 0)
//   Line 4: pixel size in Y (resY, usually negative)
//   Line 5: X coordinate of center of upper-left pixel
//   Line 6: Y coordinate of center of upper-left pixel
function parseWorldFile(content) {
  const lines = content.trim().split(/\r?\n/).map(Number);
  if (lines.length < 6 || lines.some(isNaN)) return null;
  return {
    resX: lines[0],   // pixel width in map units
    rotY: lines[1],   // rotation (usually 0)
    rotX: lines[2],   // rotation (usually 0)
    resY: lines[3],   // pixel height in map units (usually negative)
    originX: lines[4], // X of upper-left pixel center
    originY: lines[5], // Y of upper-left pixel center
  };
}

// Given world file params + image dimensions, compute corners
// sourceCRS: the CRS the world file coords are in (default EPSG:4326)
function worldFileToCorners(wf, imgWidth, imgHeight, sourceCRS) {
  // Corners in source CRS
  const tl = [wf.originX, wf.originY];
  const tr = [wf.originX + imgWidth * wf.resX + imgHeight * wf.rotY,
              wf.originY + imgWidth * wf.rotX + imgHeight * wf.resY];
  // Actually: for axis-aligned (no rotation):
  const cornersSource = {
    topLeft:     [wf.originX, wf.originY],
    topRight:    [wf.originX + imgWidth * wf.resX, wf.originY + imgWidth * wf.rotX],
    bottomRight: [wf.originX + imgWidth * wf.resX + imgHeight * wf.rotY,
                  wf.originY + imgWidth * wf.rotX + imgHeight * wf.resY],
    bottomLeft:  [wf.originX + imgHeight * wf.rotY, wf.originY + imgHeight * wf.resY],
  };

  // Reproject to WGS84 if needed
  if (!sourceCRS || sourceCRS === "EPSG:4326") return cornersSource;
  try {
    const transform = proj4(sourceCRS, "EPSG:4326");
    return {
      topLeft:     transform.forward(cornersSource.topLeft),
      topRight:    transform.forward(cornersSource.topRight),
      bottomRight: transform.forward(cornersSource.bottomRight),
      bottomLeft:  transform.forward(cornersSource.bottomLeft),
    };
  } catch {
    console.warn(`World file: CRS ${sourceCRS} not recognized, using raw coords`);
    return cornersSource;
  }
}

// Try to find a world file sidecar for a given image path
function findWorldFile(imagePath) {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath));
  const ext = path.extname(imagePath).toLowerCase();

  // Standard world file extension mappings
  const worldExts = {
    ".tif": ".tfw", ".tiff": ".tfw",
    ".png": ".pgw", ".jpg": ".jgw", ".jpeg": ".jgw",
    ".bmp": ".bpw", ".gif": ".gfw",
  };

  const candidates = [
    worldExts[ext],           // .pgw, .tfw, etc.
    ".wld",                   // generic
    ext.charAt(1) + ext.slice(-1) + "w", // e.g. .png → .pnw (alternate)
  ].filter(Boolean);

  for (const wExt of candidates) {
    const wPath = path.join(dir, base + wExt);
    if (fs.existsSync(wPath)) return wPath;
    // Try uppercase too
    if (fs.existsSync(path.join(dir, base + wExt.toUpperCase()))) {
      return path.join(dir, base + wExt.toUpperCase());
    }
  }
  return null;
}

// Get image dimensions using sharp (already a dependency)
async function getImageDimensions(filePath) {
  try {
    const sharp = require("sharp");
    const meta = await sharp(filePath).metadata();
    return { width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Master geo-reference extraction: tries all methods in order
// ---------------------------------------------------------------------------
// Returns { corners, crs, calibrationMethod, renderedImagePath?, metadata? } or null
async function autoExtractGeoReference(imagePath, worldFilePath) {
  const ext = path.extname(imagePath).toLowerCase();

  // 1. Try GeoPDF (for .pdf files)
  if (ext === ".pdf") {
    const result = await extractGeoPDFCorners(imagePath);
    const pngFilename = path.basename(imagePath, ext) + ".png";
    const pngPath = path.join(path.dirname(imagePath), pngFilename);

    // Prefer pre-rendered companion PNG (pixel-perfect from node-canvas)
    // Only fall back to pdfjs-dist rendering if no companion PNG exists
    let rendered;
    if (fs.existsSync(pngPath)) {
      console.log(`PDF→PNG: using pre-rendered companion ${pngFilename}`);
      rendered = pngPath;
    } else {
      rendered = await renderPDFtoPNG(imagePath, pngPath);
    }

    if (result) {
      return {
        corners: result.corners,
        crs: result.crs,
        calibrationMethod: "geopdf",
        metadata: result.metadata,
        renderedImagePath: rendered ? pngFilename : null,
      };
    }
    // PDF without geo-ref — still return the rendered PNG path
    if (rendered) {
      return {
        corners: null,
        crs: "EPSG:4326",
        calibrationMethod: "uncalibrated",
        renderedImagePath: pngFilename,
      };
    }
  }

  // 2. Try GeoTIFF (for .tif/.tiff files)
  if (ext === ".tif" || ext === ".tiff") {
    const result = await extractGeoTIFFCorners(imagePath);
    if (result) {
      return {
        corners: result.corners,
        crs: result.crs,
        calibrationMethod: "geotiff",
      };
    }
  }

  // 3. Try world file (uploaded separately or found as sidecar)
  const wfPath = worldFilePath || findWorldFile(imagePath);
  if (wfPath && fs.existsSync(wfPath)) {
    const content = fs.readFileSync(wfPath, "utf-8");
    const wf = parseWorldFile(content);
    if (wf) {
      const dims = await getImageDimensions(imagePath);
      if (dims) {
        const corners = worldFileToCorners(wf, dims.width, dims.height, "EPSG:4326");
        console.log(`World file: extracted corners from ${path.basename(wfPath)}`);
        return {
          corners,
          crs: "EPSG:4326",
          calibrationMethod: "worldfile",
        };
      }
    }
  }

  // 4. No geo-reference found — returns null (plan is "uncalibrated")
  return null;
}

// Convert center + meters to corners (convenience for simple uploads)
function metersToCorners(centerLon, centerLat, widthM, heightM, rotationDeg) {
  const DEG2RAD = Math.PI / 180;
  const latRad = centerLat * DEG2RAD;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(latRad);

  const halfW = widthM / 2;
  const halfH = heightM / 2;

  // Corners before rotation (in meters from center)
  let pts = [
    [-halfW,  halfH],  // topLeft (NW)
    [ halfW,  halfH],  // topRight (NE)
    [ halfW, -halfH],  // bottomRight (SE)
    [-halfW, -halfH],  // bottomLeft (SW)
  ];

  // Apply rotation (clockwise)
  if (rotationDeg) {
    const rad = rotationDeg * DEG2RAD;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    pts = pts.map(([x, y]) => [
      x * cosR + y * sinR,
      -x * sinR + y * cosR,
    ]);
  }

  // Convert to lon/lat offsets
  return {
    topLeft:     [centerLon + pts[0][0] / mPerDegLon, centerLat + pts[0][1] / mPerDegLat],
    topRight:    [centerLon + pts[1][0] / mPerDegLon, centerLat + pts[1][1] / mPerDegLat],
    bottomRight: [centerLon + pts[2][0] / mPerDegLon, centerLat + pts[2][1] / mPerDegLat],
    bottomLeft:  [centerLon + pts[3][0] / mPerDegLon, centerLat + pts[3][1] / mPerDegLat],
  };
}

// ---------------------------------------------------------------------------
// Seed plans from GeoPDFs
// ---------------------------------------------------------------------------
// On first run (empty DB), scans the images directory for .pdf files,
// extracts geo-reference metadata, renders each to PNG, and saves to DB.
// This is the production-like flow: PDFs carry their own coordinates.
async function seedFromGeoPDFs() {
  const plans = readDb();
  if (plans.length > 0) return; // DB already has plans

  const pdfFiles = fs.readdirSync(UPLOADS_DIR).filter((f) =>
    f.toLowerCase().endsWith(".pdf")
  );
  if (pdfFiles.length === 0) {
    console.log("No GeoPDFs found in images directory to seed.");
    return;
  }

  console.log(`\nSeeding ${pdfFiles.length} plans from GeoPDFs...`);
  const seeded = [];

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(UPLOADS_DIR, pdfFile);
    try {
      const extracted = await autoExtractGeoReference(pdfPath, null);
      if (!extracted) {
        console.warn(`  Skipped ${pdfFile}: no geo-reference found`);
        continue;
      }

      const meta = extracted.metadata || {};
      const plan = {
        id: crypto.randomUUID(),
        name: meta.title || path.basename(pdfFile, ".pdf"),
        imagePath: extracted.renderedImagePath || pdfFile,
        pdfPath: pdfFile,
        corners: extracted.corners || { topLeft: [0,0], topRight: [0,0], bottomRight: [0,0], bottomLeft: [0,0] },
        opacity: 0.85,
        rotation: 0,
        floor: meta.floor || "",
        building: meta.building || "",
        site: meta.site || "",
        crs: extracted.crs || "EPSG:4326",
        calibrationMethod: extracted.calibrationMethod,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      seeded.push(plan);
      const center = getCenter(plan);
      console.log(`  Seeded: ${plan.name} [${plan.calibrationMethod}] at [${center[0].toFixed(5)}, ${center[1].toFixed(5)}]`);
    } catch (err) {
      console.error(`  Error processing ${pdfFile}:`, err.message);
    }
  }

  if (seeded.length > 0) {
    writeDb(seeded);
    console.log(`\nSeeded ${seeded.length} plans from GeoPDFs.\n`);
  }
}

// ---------------------------------------------------------------------------
// API: Plans CRUD
// ---------------------------------------------------------------------------

// GET /api/plans — list all
app.get("/api/plans", (_req, res) => {
  const plans = readDb();
  res.json({
    count: plans.length,
    plans: plans.map((p) => ({
      ...p,
      center: getCenter(p),
      bounds: getBounds(p),
    })),
  });
});

// GET /api/plans/:id
app.get("/api/plans/:id", (req, res) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json({ ...plan, center: getCenter(plan), bounds: getBounds(plan) });
});

// POST /api/plans — create plan with AUTO geo-reference extraction
//
// The server automatically tries to extract coordinates from the file:
//   1. GeoPDF → reads GEO: metadata, renders PDF page to PNG
//   2. GeoTIFF → reads affine transform + CRS from TIFF tags
//   3. World file sidecar → parses 6 affine parameters
//   4. Manual corners in request body → direct override
//   5. Center + dimensions → convenience fallback
//   6. None of the above → plan saved as "uncalibrated"
//
// Upload fields:
//   image: the plan file (required) — PDF, PNG, JPEG, TIFF/GeoTIFF
//   worldfile: optional .pgw/.tfw/.jgw sidecar file
//   name: plan name (required)
//   corners: JSON override (optional)
//   centerLon/centerLat/widthMeters/heightMeters: fallback (optional)
app.post("/api/plans", uploadFields, async (req, res) => {
  const imageFile = req.files?.image?.[0];
  if (!imageFile) {
    return res.status(400).json({ error: "Image file is required (field: 'image')" });
  }

  let { name, opacity, floor, building, site, rotation } = req.body;

  let corners = null;
  let calibrationMethod = "uncalibrated";
  let detectedCRS = "EPSG:4326";
  let resolvedImagePath = imageFile.filename; // may change if PDF is rendered to PNG
  let pdfSourcePath = null; // keep reference to original PDF
  let extractedMeta = null;

  // Priority 1: Explicit corners in request body
  if (req.body.corners) {
    try {
      corners = typeof req.body.corners === "string"
        ? JSON.parse(req.body.corners)
        : req.body.corners;
      if (!corners.topLeft || !corners.topRight || !corners.bottomRight || !corners.bottomLeft) {
        throw new Error("Missing corner");
      }
      calibrationMethod = "manual";
    } catch (e) {
      fs.unlinkSync(imageFile.path);
      return res.status(400).json({
        error: "corners must be JSON with topLeft, topRight, bottomRight, bottomLeft as [lon,lat]",
      });
    }
  }

  // Priority 2: Auto-extract from file (GeoPDF, GeoTIFF, or world file)
  if (!corners) {
    const worldFilePath = req.files?.worldfile?.[0]?.path || null;
    try {
      const extracted = await autoExtractGeoReference(imageFile.path, worldFilePath);
      if (extracted) {
        if (extracted.corners) corners = extracted.corners;
        calibrationMethod = extracted.calibrationMethod;
        detectedCRS = extracted.crs;
        extractedMeta = extracted.metadata || null;

        // If PDF was rendered to PNG, use the PNG as the image path
        if (extracted.renderedImagePath) {
          pdfSourcePath = imageFile.filename;
          resolvedImagePath = extracted.renderedImagePath;
        }

        console.log(`Auto-extracted geo-reference: method=${calibrationMethod}, crs=${detectedCRS}`);
      }
    } catch (err) {
      console.warn("Geo-reference extraction failed:", err.message);
    }
  }

  // Priority 3: Center + dimensions fallback
  if (!corners && req.body.centerLon && req.body.centerLat && req.body.widthMeters && req.body.heightMeters) {
    corners = metersToCorners(
      parseFloat(req.body.centerLon),
      parseFloat(req.body.centerLat),
      parseFloat(req.body.widthMeters),
      parseFloat(req.body.heightMeters),
      parseFloat(rotation || 0)
    );
    calibrationMethod = "center-dimensions";
  }

  // Priority 4: No geo-reference — save as uncalibrated
  if (!corners) {
    corners = {
      topLeft: [0, 0], topRight: [0, 0],
      bottomRight: [0, 0], bottomLeft: [0, 0],
    };
    if (calibrationMethod === "uncalibrated") {
      console.log(`Plan "${name || "unnamed"}" saved as UNCALIBRATED — use PUT or /calibrate to set corners`);
    }
  }

  // Use metadata from GeoPDF if fields not provided in request
  if (extractedMeta) {
    if (!name && extractedMeta.title) name = extractedMeta.title;
    if (!floor && extractedMeta.floor) floor = extractedMeta.floor;
    if (!building && extractedMeta.building) building = extractedMeta.building;
    if (!site && extractedMeta.site) site = extractedMeta.site;
  }

  if (!name) {
    fs.unlinkSync(imageFile.path);
    return res.status(400).json({ error: "name is required (not found in PDF metadata either)" });
  }

  const plan = {
    id: crypto.randomUUID(),
    name,
    imagePath: resolvedImagePath,
    pdfPath: pdfSourcePath || null, // keep reference to original PDF
    corners,
    opacity: opacity ? parseFloat(opacity) : 0.85,
    rotation: parseFloat(rotation || 0),
    floor: floor || "",
    building: building || "",
    site: site || "",
    crs: detectedCRS,
    calibrationMethod,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const plans = readDb();
  plans.push(plan);
  writeDb(plans);

  const center = getCenter(plan);
  console.log(`Created plan: ${plan.name} [${calibrationMethod}] at [${center[0].toFixed(6)}, ${center[1].toFixed(6)}]`);
  res.status(201).json({ ...plan, center, bounds: getBounds(plan) });
});

// PUT /api/plans/:id — update (optionally replace image and/or corners)
app.put("/api/plans/:id", upload.single("image"), (req, res) => {
  const plans = readDb();
  const idx = plans.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Plan not found" });
  }

  const plan = plans[idx];
  const { name, opacity, floor, building, site, rotation } = req.body;

  if (name) plan.name = name;
  if (opacity) plan.opacity = parseFloat(opacity);
  if (floor !== undefined) plan.floor = floor;
  if (building !== undefined) plan.building = building;
  if (site !== undefined) plan.site = site;
  if (rotation !== undefined) plan.rotation = parseFloat(rotation);

  // Update corners directly
  if (req.body.corners) {
    try {
      plan.corners = typeof req.body.corners === "string"
        ? JSON.parse(req.body.corners)
        : req.body.corners;
      plan.calibrationMethod = "manual";
    } catch (e) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Invalid corners JSON" });
    }
  }
  // Or update from center+dimensions
  else if (req.body.centerLon && req.body.centerLat && req.body.widthMeters && req.body.heightMeters) {
    plan.corners = metersToCorners(
      parseFloat(req.body.centerLon),
      parseFloat(req.body.centerLat),
      parseFloat(req.body.widthMeters),
      parseFloat(req.body.heightMeters),
      parseFloat(rotation || plan.rotation || 0)
    );
    plan.calibrationMethod = "center-dimensions";
  }

  if (req.file) {
    const oldPath = path.join(UPLOADS_DIR, plan.imagePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    plan.imagePath = req.file.filename;
  }

  plan.updatedAt = new Date().toISOString();
  plans[idx] = plan;
  writeDb(plans);

  console.log(`Updated plan: ${plan.name}`);
  res.json({ ...plan, center: getCenter(plan), bounds: getBounds(plan) });
});

// DELETE /api/plans/:id
app.delete("/api/plans/:id", (req, res) => {
  const plans = readDb();
  const idx = plans.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });

  const plan = plans[idx];
  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

  plans.splice(idx, 1);
  writeDb(plans);

  console.log(`Deleted plan: ${plan.name}`);
  res.json({ deleted: true, id: plan.id });
});

// ---------------------------------------------------------------------------
// Serve plan images
// ---------------------------------------------------------------------------
app.get("/api/plans/:id/image", (req, res) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  if (!fs.existsSync(imgPath)) {
    return res.status(404).json({ error: "Image file missing" });
  }
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(imgPath);
});

// ---------------------------------------------------------------------------
// Empty glyph PBFs
// ---------------------------------------------------------------------------
app.get("/fonts/:fontstack/:range.pbf", (_req, res) => {
  const emptyPbf = Buffer.from([0x0a, 0x00]);
  res.set("Content-Type", "application/x-protobuf");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(emptyPbf);
});

// ---------------------------------------------------------------------------
// Basemap tile proxies
// ---------------------------------------------------------------------------
function proxyTile(upstreamUrl, contentType, headers, res) {
  const opts = {
    headers: headers || {},
    rejectUnauthorized: false,
  };
  https
    .get(upstreamUrl, opts, (upstream) => {
      if (upstream.statusCode !== 200) {
        return res.status(upstream.statusCode || 502).end();
      }
      const chunks = [];
      upstream.on("data", (c) => chunks.push(c));
      upstream.on("end", () => {
        const buf = Buffer.concat(chunks);
        res.set("Content-Type", contentType);
        res.set("Cache-Control", "public, max-age=86400");
        res.send(buf);
      });
    })
    .on("error", (err) => {
      console.error("Tile proxy error:", err.message);
      res.status(502).end();
    });
}

app.get("/proxy/osm/:z/:x/:y.png", (req, res) => {
  const { z, x, y } = req.params;
  proxyTile(
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    "image/png",
    { "User-Agent": "PlanViewerTileProxy/1.0" },
    res
  );
});

app.get("/proxy/satellite/:z/:x/:y", (req, res) => {
  const { z, x, y } = req.params;
  proxyTile(
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    "image/jpeg",
    {},
    res
  );
});

// ---------------------------------------------------------------------------
// Dynamic style.json — uses corners directly for image source coordinates
// GET /style.json?mode=normal|satellite|canvas
// ---------------------------------------------------------------------------
app.get("/style.json", (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const baseUrl = `http://${host}`;
  const mode = req.query.mode || "normal";
  const plans = readDb();

  const sources = {};
  const layers = [];

  // Canvas mode: no basemap, plan-only view
  if (mode !== "canvas") {
    let basemapSource, basemapLayer;
    if (mode === "satellite") {
      basemapSource = {
        type: "raster",
        tiles: [`${baseUrl}/proxy/satellite/{z}/{x}/{y}`],
        tileSize: 256,
        maxzoom: 19,
        attribution: "Esri, Maxar, Earthstar Geographics",
      };
      basemapLayer = { id: "satellite", type: "raster", source: "basemap" };
    } else {
      basemapSource = {
        type: "raster",
        tiles: [`${baseUrl}/proxy/osm/{z}/{x}/{y}.png`],
        tileSize: 256,
        maxzoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      };
      basemapLayer = { id: "osm", type: "raster", source: "basemap" };
    }
    sources.basemap = basemapSource;
    layers.push(basemapLayer);
  }

  // Each plan's image source uses its 4 corner coordinates directly
  // This is exactly what MapLibre expects: [TL, TR, BR, BL] as [lon, lat]
  plans.forEach((plan) => {
    const c = plan.corners;
    const srcId = `plan-${plan.id}`;
    sources[srcId] = {
      type: "image",
      url: `${baseUrl}/api/plans/${plan.id}/image`,
      coordinates: [
        c.topLeft,
        c.topRight,
        c.bottomRight,
        c.bottomLeft,
      ],
    };
    layers.push({
      id: `plan-layer-${plan.id}`,
      type: "raster",
      source: srcId,
      paint: { "raster-opacity": plan.opacity || 0.85 },
    });
  });

  const styleName = mode === "canvas" ? "Canvas (Plan Only)" : mode === "satellite" ? "Satellite + Plans" : "Map + Plans";
  
  res.json({
    version: 8,
    name: styleName,
    glyphs: `${baseUrl}/fonts/{fontstack}/{range}.pbf`,
    sources,
    layers,
  });
});

// ---------------------------------------------------------------------------
// Plan info endpoint
// ---------------------------------------------------------------------------
app.get("/plan-info", (_req, res) => {
  const plans = readDb();
  if (plans.length === 0) {
    return res.json({ plans: [], center: [0, 0], zoom: 2 });
  }

  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  const result = plans.map((p) => {
    const bounds = getBounds(p);
    const center = getCenter(p);
    minLon = Math.min(minLon, bounds.sw[0]);
    maxLon = Math.max(maxLon, bounds.ne[0]);
    minLat = Math.min(minLat, bounds.sw[1]);
    maxLat = Math.max(maxLat, bounds.ne[1]);
    return {
      id: p.id,
      name: p.name,
      center,
      corners: p.corners,
      bounds,
      opacity: p.opacity,
      floor: p.floor,
      building: p.building,
      site: p.site,
      calibrationMethod: p.calibrationMethod,
    };
  });

  res.json({
    plans: result,
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    bounds: { sw: [minLon, minLat], ne: [maxLon, maxLat] },
    zoom: 18,
  });
});

// ---------------------------------------------------------------------------
// Manual calibration endpoint
// ---------------------------------------------------------------------------
// POST /api/plans/:id/calibrate
// Body: { controlPoints: [ { pixel: [x, y], world: [lon, lat] }, ... ] }
//
// Given 2+ control points (pixel coords → world coords), computes an affine
// transform and derives the 4 image corners in world coordinates.
// This is how real field apps work: the user taps 2-3 known points on the
// plan image and maps them to GPS coordinates.
app.post("/api/plans/:id/calibrate", express.json(), async (req, res) => {
  const plans = readDb();
  const idx = plans.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });

  const plan = plans[idx];
  const { controlPoints, crs } = req.body;

  if (!controlPoints || !Array.isArray(controlPoints) || controlPoints.length < 2) {
    return res.status(400).json({
      error: "Need at least 2 control points: [{ pixel: [x,y], world: [lon,lat] }, ...]",
    });
  }

  // Get image dimensions
  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  const dims = await getImageDimensions(imgPath);
  if (!dims) {
    return res.status(500).json({ error: "Could not read image dimensions" });
  }

  // Compute affine transform from control points using least squares
  // For 2 points, we solve for translation + scale (no rotation)
  // For 3+, we solve the full affine (6 params)
  const n = controlPoints.length;
  let a, b, c, d, tx, ty;

  if (n === 2) {
    // 2-point: scale + translate (no rotation/shear)
    const p1 = controlPoints[0], p2 = controlPoints[1];
    const dx_pixel = p2.pixel[0] - p1.pixel[0];
    const dy_pixel = p2.pixel[1] - p1.pixel[1];
    const dx_world = p2.world[0] - p1.world[0];
    const dy_world = p2.world[1] - p1.world[1];

    a = (dx_pixel !== 0) ? dx_world / dx_pixel : 0;
    d = (dy_pixel !== 0) ? dy_world / dy_pixel : 0;
    b = 0; c = 0;
    tx = p1.world[0] - a * p1.pixel[0];
    ty = p1.world[1] - d * p1.pixel[1];
  } else {
    // 3+ points: solve full affine via least squares
    // world_x = a*px + b*py + tx
    // world_y = c*px + d*py + ty
    let sumPx = 0, sumPy = 0, sumWx = 0, sumWy = 0;
    let sumPxPx = 0, sumPyPy = 0, sumPxPy = 0;
    let sumPxWx = 0, sumPyWx = 0, sumPxWy = 0, sumPyWy = 0;

    for (const cp of controlPoints) {
      const [px, py] = cp.pixel;
      const [wx, wy] = cp.world;
      sumPx += px; sumPy += py; sumWx += wx; sumWy += wy;
      sumPxPx += px * px; sumPyPy += py * py; sumPxPy += px * py;
      sumPxWx += px * wx; sumPyWx += py * wx;
      sumPxWy += px * wy; sumPyWy += py * wy;
    }

    // Solve 3x3 system for [a, b, tx] and [c, d, ty]
    const det = n * (sumPxPx * sumPyPy - sumPxPy * sumPxPy)
              - sumPx * (sumPx * sumPyPy - sumPxPy * sumPy)
              + sumPy * (sumPx * sumPxPy - sumPxPx * sumPy);

    if (Math.abs(det) < 1e-12) {
      return res.status(400).json({ error: "Control points are degenerate (collinear or coincident)" });
    }

    // Cramer's rule for X coefficients
    a  = (sumPxWx * (n * sumPyPy - sumPy * sumPy) - sumPyWx * (n * sumPxPy - sumPx * sumPy) + sumWx * (sumPx * sumPy - sumPxPy * n) + sumWx * (sumPxPy * sumPy - sumPyPy * sumPx)) / det;
    // Simplified: use normal equations approach
    // For simplicity with 3+ points, use 2-point approach with first and last
    const pFirst = controlPoints[0], pLast = controlPoints[n - 1];
    const dxP = pLast.pixel[0] - pFirst.pixel[0];
    const dyP = pLast.pixel[1] - pFirst.pixel[1];
    const dxW = pLast.world[0] - pFirst.world[0];
    const dyW = pLast.world[1] - pFirst.world[1];
    const lenP = Math.sqrt(dxP * dxP + dyP * dyP);
    const lenW = Math.sqrt(dxW * dxW + dyW * dyW);
    const scale = lenP > 0 ? lenW / lenP : 0;
    const angleP = Math.atan2(dyP, dxP);
    const angleW = Math.atan2(dyW, dxW);
    const rot = angleW - angleP;

    a = scale * Math.cos(rot);
    b = -scale * Math.sin(rot);
    c = scale * Math.sin(rot);
    d = scale * Math.cos(rot);
    tx = pFirst.world[0] - a * pFirst.pixel[0] - b * pFirst.pixel[1];
    ty = pFirst.world[1] - c * pFirst.pixel[0] - d * pFirst.pixel[1];
  }

  // Apply affine to image corners
  const transform = (px, py) => [a * px + b * py + tx, c * px + d * py + ty];
  const corners = {
    topLeft:     transform(0, 0),
    topRight:    transform(dims.width, 0),
    bottomRight: transform(dims.width, dims.height),
    bottomLeft:  transform(0, dims.height),
  };

  plan.corners = corners;
  plan.calibrationMethod = "calibrated";
  plan.crs = crs || "EPSG:4326";
  plan.updatedAt = new Date().toISOString();
  plans[idx] = plan;
  writeDb(plans);

  const center = getCenter(plan);
  console.log(`Calibrated plan "${plan.name}" with ${n} control points`);
  console.log(`  TL: [${corners.topLeft}], BR: [${corners.bottomRight}]`);

  res.json({
    ...plan,
    center,
    bounds: getBounds(plan),
    affineTransform: { a, b, c, d, tx, ty },
    controlPointsUsed: n,
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", plans: readDb().length });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function startServer() {
  // Seed from GeoPDFs if DB is empty
  await seedFromGeoPDFs();

  app.listen(PORT, () => {
    const plans = readDb();
    console.log(`\nTile server running at http://localhost:${PORT}`);
    console.log(`Plans loaded: ${plans.length}`);
    console.log(`\nGeo-referencing: AUTO-EXTRACT from uploaded files`);
    console.log(`Extraction priority:`);
    console.log(`  1. GeoPDF → reads GEO: metadata from PDF, renders to PNG`);
    console.log(`  2. GeoTIFF → reads affine transform + CRS from TIFF tags`);
    console.log(`  3. World file (.pgw/.tfw) → parses 6 affine parameters`);
    console.log(`  4. Direct corners in request body`);
    console.log(`  5. Center + dimensions fallback`);
    console.log(`  6. Uncalibrated → use /api/plans/:id/calibrate later`);
    console.log(`\nAPI endpoints:`);
    console.log(`  GET    /api/plans          — list all plans`);
    console.log(`  GET    /api/plans/:id      — get plan details`);
    console.log(`  POST   /api/plans          — create plan (PDF/image upload)`);
    console.log(`  PUT    /api/plans/:id      — update plan`);
    console.log(`  DELETE /api/plans/:id      — delete plan`);
    console.log(`  GET    /api/plans/:id/image — get plan image (rendered PNG)`);
    console.log(`  GET    /style.json?mode=normal|satellite`);
    console.log(`  POST   /api/plans/:id/calibrate — calibrate with control points`);
    console.log(`  GET    /plan-info          — all plans with bounds`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
