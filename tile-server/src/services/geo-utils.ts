import path from "path";
import fs from "fs";
import proj4 from "proj4";
import type { Corners, WorldFileParams } from "../types";

// ---------------------------------------------------------------------------
// World file parsing
// ---------------------------------------------------------------------------
export function parseWorldFile(content: string): WorldFileParams | null {
  const lines = content.trim().split(/\r?\n/).map(Number);
  if (lines.length < 6 || lines.some(isNaN)) return null;
  return {
    resX: lines[0],
    rotY: lines[1],
    rotX: lines[2],
    resY: lines[3],
    originX: lines[4],
    originY: lines[5],
  };
}

// ---------------------------------------------------------------------------
// World file → corners
// ---------------------------------------------------------------------------
export function worldFileToCorners(
  wf: WorldFileParams,
  imgWidth: number,
  imgHeight: number,
  sourceCRS?: string,
): Corners {
  const cornersSource: Corners = {
    topLeft: [wf.originX, wf.originY],
    topRight: [wf.originX + imgWidth * wf.resX, wf.originY + imgWidth * wf.rotX],
    bottomRight: [
      wf.originX + imgWidth * wf.resX + imgHeight * wf.rotY,
      wf.originY + imgWidth * wf.rotX + imgHeight * wf.resY,
    ],
    bottomLeft: [wf.originX + imgHeight * wf.rotY, wf.originY + imgHeight * wf.resY],
  };

  if (!sourceCRS || sourceCRS === "EPSG:4326") return cornersSource;

  try {
    const transform = proj4(sourceCRS, "EPSG:4326");
    return {
      topLeft: transform.forward(cornersSource.topLeft) as [number, number],
      topRight: transform.forward(cornersSource.topRight) as [number, number],
      bottomRight: transform.forward(cornersSource.bottomRight) as [number, number],
      bottomLeft: transform.forward(cornersSource.bottomLeft) as [number, number],
    };
  } catch {
    console.warn(`World file: CRS ${sourceCRS} not recognized, using raw coords`);
    return cornersSource;
  }
}

// ---------------------------------------------------------------------------
// Find world file sidecar for a given image path
// ---------------------------------------------------------------------------
export function findWorldFile(imagePath: string): string | null {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath));
  const ext = path.extname(imagePath).toLowerCase();

  const worldExts: Record<string, string> = {
    ".tif": ".tfw", ".tiff": ".tfw",
    ".png": ".pgw", ".jpg": ".jgw", ".jpeg": ".jgw",
    ".bmp": ".bpw", ".gif": ".gfw",
  };

  const candidates = [
    worldExts[ext],
    ".wld",
    ext.charAt(1) + ext.slice(-1) + "w",
  ].filter(Boolean) as string[];

  for (const wExt of candidates) {
    const wPath = path.join(dir, base + wExt);
    if (fs.existsSync(wPath)) return wPath;
    if (fs.existsSync(path.join(dir, base + wExt.toUpperCase()))) {
      return path.join(dir, base + wExt.toUpperCase());
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Convert center + meters to corners
// ---------------------------------------------------------------------------
export function metersToCorners(
  centerLon: number,
  centerLat: number,
  widthM: number,
  heightM: number,
  rotationDeg: number,
): Corners {
  const DEG2RAD = Math.PI / 180;
  const latRad = centerLat * DEG2RAD;
  const mPerDegLat = 111320;
  const mPerDegLon = 111320 * Math.cos(latRad);

  const halfW = widthM / 2;
  const halfH = heightM / 2;

  let pts: [number, number][] = [
    [-halfW, halfH],
    [halfW, halfH],
    [halfW, -halfH],
    [-halfW, -halfH],
  ];

  if (rotationDeg) {
    const rad = rotationDeg * DEG2RAD;
    const cosR = Math.cos(rad);
    const sinR = Math.sin(rad);
    pts = pts.map(([x, y]) => [
      x * cosR + y * sinR,
      -x * sinR + y * cosR,
    ]);
  }

  return {
    topLeft: [centerLon + pts[0][0] / mPerDegLon, centerLat + pts[0][1] / mPerDegLat],
    topRight: [centerLon + pts[1][0] / mPerDegLon, centerLat + pts[1][1] / mPerDegLat],
    bottomRight: [centerLon + pts[2][0] / mPerDegLon, centerLat + pts[2][1] / mPerDegLat],
    bottomLeft: [centerLon + pts[3][0] / mPerDegLon, centerLat + pts[3][1] / mPerDegLat],
  };
}

// ---------------------------------------------------------------------------
// Get image dimensions using sharp
// ---------------------------------------------------------------------------
export async function getImageDimensions(
  filePath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const sharp = require("sharp");
    const meta = await sharp(filePath).metadata();
    return { width: meta.width!, height: meta.height! };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Bilinear pixel → geo coordinate interpolation
// ---------------------------------------------------------------------------
export function pixelToGeo(
  px: number,
  py: number,
  width: number,
  height: number,
  corners: Corners,
): [number, number] {
  const u = px / width;
  const v = py / height;
  const { topLeft, topRight, bottomRight, bottomLeft } = corners;
  const lon =
    (1 - u) * (1 - v) * topLeft[0] +
    u * (1 - v) * topRight[0] +
    u * v * bottomRight[0] +
    (1 - u) * v * bottomLeft[0];
  const lat =
    (1 - u) * (1 - v) * topLeft[1] +
    u * (1 - v) * topRight[1] +
    u * v * bottomRight[1] +
    (1 - u) * v * bottomLeft[1];
  return [lon, lat];
}
