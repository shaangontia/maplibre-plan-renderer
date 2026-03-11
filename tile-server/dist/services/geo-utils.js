"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseWorldFile = parseWorldFile;
exports.worldFileToCorners = worldFileToCorners;
exports.findWorldFile = findWorldFile;
exports.metersToCorners = metersToCorners;
exports.getImageDimensions = getImageDimensions;
exports.pixelToGeo = pixelToGeo;
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const proj4_1 = __importDefault(require("proj4"));
// ---------------------------------------------------------------------------
// World file parsing
// ---------------------------------------------------------------------------
function parseWorldFile(content) {
    const lines = content.trim().split(/\r?\n/).map(Number);
    if (lines.length < 6 || lines.some(isNaN))
        return null;
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
function worldFileToCorners(wf, imgWidth, imgHeight, sourceCRS) {
    const cornersSource = {
        topLeft: [wf.originX, wf.originY],
        topRight: [wf.originX + imgWidth * wf.resX, wf.originY + imgWidth * wf.rotX],
        bottomRight: [
            wf.originX + imgWidth * wf.resX + imgHeight * wf.rotY,
            wf.originY + imgWidth * wf.rotX + imgHeight * wf.resY,
        ],
        bottomLeft: [wf.originX + imgHeight * wf.rotY, wf.originY + imgHeight * wf.resY],
    };
    if (!sourceCRS || sourceCRS === "EPSG:4326")
        return cornersSource;
    try {
        const transform = (0, proj4_1.default)(sourceCRS, "EPSG:4326");
        return {
            topLeft: transform.forward(cornersSource.topLeft),
            topRight: transform.forward(cornersSource.topRight),
            bottomRight: transform.forward(cornersSource.bottomRight),
            bottomLeft: transform.forward(cornersSource.bottomLeft),
        };
    }
    catch {
        console.warn(`World file: CRS ${sourceCRS} not recognized, using raw coords`);
        return cornersSource;
    }
}
// ---------------------------------------------------------------------------
// Find world file sidecar for a given image path
// ---------------------------------------------------------------------------
function findWorldFile(imagePath) {
    const dir = path_1.default.dirname(imagePath);
    const base = path_1.default.basename(imagePath, path_1.default.extname(imagePath));
    const ext = path_1.default.extname(imagePath).toLowerCase();
    const worldExts = {
        ".tif": ".tfw", ".tiff": ".tfw",
        ".png": ".pgw", ".jpg": ".jgw", ".jpeg": ".jgw",
        ".bmp": ".bpw", ".gif": ".gfw",
    };
    const candidates = [
        worldExts[ext],
        ".wld",
        ext.charAt(1) + ext.slice(-1) + "w",
    ].filter(Boolean);
    for (const wExt of candidates) {
        const wPath = path_1.default.join(dir, base + wExt);
        if (fs_1.default.existsSync(wPath))
            return wPath;
        if (fs_1.default.existsSync(path_1.default.join(dir, base + wExt.toUpperCase()))) {
            return path_1.default.join(dir, base + wExt.toUpperCase());
        }
    }
    return null;
}
// ---------------------------------------------------------------------------
// Convert center + meters to corners
// ---------------------------------------------------------------------------
function metersToCorners(centerLon, centerLat, widthM, heightM, rotationDeg) {
    const DEG2RAD = Math.PI / 180;
    const latRad = centerLat * DEG2RAD;
    const mPerDegLat = 111320;
    const mPerDegLon = 111320 * Math.cos(latRad);
    const halfW = widthM / 2;
    const halfH = heightM / 2;
    let pts = [
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
async function getImageDimensions(filePath) {
    try {
        const sharp = require("sharp");
        const meta = await sharp(filePath).metadata();
        return { width: meta.width, height: meta.height };
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// Bilinear pixel → geo coordinate interpolation
// ---------------------------------------------------------------------------
function pixelToGeo(px, py, width, height, corners) {
    const u = px / width;
    const v = py / height;
    const { topLeft, topRight, bottomRight, bottomLeft } = corners;
    const lon = (1 - u) * (1 - v) * topLeft[0] +
        u * (1 - v) * topRight[0] +
        u * v * bottomRight[0] +
        (1 - u) * v * bottomLeft[0];
    const lat = (1 - u) * (1 - v) * topLeft[1] +
        u * (1 - v) * topRight[1] +
        u * v * bottomRight[1] +
        (1 - u) * v * bottomLeft[1];
    return [lon, lat];
}
//# sourceMappingURL=geo-utils.js.map