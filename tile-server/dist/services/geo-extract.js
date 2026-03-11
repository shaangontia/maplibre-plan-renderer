"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractGeoTIFFCorners = extractGeoTIFFCorners;
exports.extractGeoPDFCorners = extractGeoPDFCorners;
exports.autoExtractGeoReference = autoExtractGeoReference;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const proj4_1 = __importDefault(require("proj4"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const GeoTIFF = require("geotiff");
const pdf_render_1 = require("./pdf-render");
const geo_utils_1 = require("./geo-utils");
// ---------------------------------------------------------------------------
// GeoTIFF corner extraction
// ---------------------------------------------------------------------------
async function extractGeoTIFFCorners(filePath) {
    try {
        const buf = fs_1.default.readFileSync(filePath);
        const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const tiff = await GeoTIFF.fromArrayBuffer(arrayBuf);
        const image = await tiff.getImage();
        const tiepoint = image.getTiePoints();
        const pixelScale = image.getFileDirectory().ModelPixelScale;
        const modelTransform = image.getFileDirectory().ModelTransformation;
        const width = image.getWidth();
        const height = image.getHeight();
        let originX, originY, resX, resY;
        if (modelTransform) {
            originX = modelTransform[3];
            originY = modelTransform[7];
            resX = modelTransform[0];
            resY = modelTransform[5];
        }
        else if (tiepoint && tiepoint.length > 0 && pixelScale) {
            originX = tiepoint[0].x - tiepoint[0].i * pixelScale[0];
            originY = tiepoint[0].y + tiepoint[0].j * pixelScale[1];
            resX = pixelScale[0];
            resY = -pixelScale[1];
        }
        else {
            console.log("GeoTIFF: no transform found in file");
            return null;
        }
        const geoKeys = image.getGeoKeys();
        let sourceCRS = "EPSG:4326";
        if (geoKeys) {
            const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
            if (epsg && epsg !== 32767)
                sourceCRS = `EPSG:${epsg}`;
        }
        const cornersSource = {
            topLeft: [originX, originY],
            topRight: [originX + width * resX, originY],
            bottomRight: [originX + width * resX, originY + height * resY],
            bottomLeft: [originX, originY + height * resY],
        };
        let cornersWGS84;
        if (sourceCRS === "EPSG:4326") {
            cornersWGS84 = cornersSource;
        }
        else {
            try {
                const transform = (0, proj4_1.default)(sourceCRS, "EPSG:4326");
                cornersWGS84 = {
                    topLeft: transform.forward(cornersSource.topLeft),
                    topRight: transform.forward(cornersSource.topRight),
                    bottomRight: transform.forward(cornersSource.bottomRight),
                    bottomLeft: transform.forward(cornersSource.bottomLeft),
                };
            }
            catch {
                console.warn(`GeoTIFF: CRS ${sourceCRS} not recognized by proj4, using raw coords as lon/lat`);
                cornersWGS84 = cornersSource;
            }
        }
        console.log(`GeoTIFF: extracted corners from ${path_1.default.basename(filePath)}`);
        console.log(`  CRS: ${sourceCRS}, Size: ${width}x${height}`);
        console.log(`  TL: [${cornersWGS84.topLeft}], BR: [${cornersWGS84.bottomRight}]`);
        return { corners: cornersWGS84, crs: sourceCRS, width, height };
    }
    catch {
        return null;
    }
}
// ---------------------------------------------------------------------------
// GeoPDF corner extraction
// ---------------------------------------------------------------------------
async function extractGeoPDFCorners(filePath) {
    try {
        const pdfjsLib = await (0, pdf_render_1.loadPdfjs)();
        const buf = fs_1.default.readFileSync(filePath);
        const uint8 = new Uint8Array(buf);
        const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
        const meta = await doc.getMetadata();
        const keywords = meta?.info?.Keywords || "";
        if (!keywords.includes("GEO:"))
            return null;
        const geoData = {};
        const parts = keywords.split(";").map((s) => s.trim());
        for (const part of parts) {
            const match = part.match(/^GEO:(\w+)=(.+)$/);
            if (match)
                geoData[match[1]] = match[2].trim();
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
        console.log(`GeoPDF: extracted corners from ${path_1.default.basename(filePath)}`);
        console.log(`  CRS: ${crs}`);
        console.log(`  TL: [${corners.topLeft}], BR: [${corners.bottomRight}]`);
        const pdfMeta = {
            floor: geoData.FLOOR || "",
            building: geoData.BUILDING || "",
            site: geoData.SITE || "",
            title: meta?.info?.Title || "",
        };
        return { corners, crs, metadata: pdfMeta };
    }
    catch (err) {
        console.warn("GeoPDF extraction error:", err.message);
        return null;
    }
}
// ---------------------------------------------------------------------------
// Master geo-reference extraction: tries all methods in order
// ---------------------------------------------------------------------------
async function autoExtractGeoReference(imagePath, worldFilePath) {
    const ext = path_1.default.extname(imagePath).toLowerCase();
    // 1. Try GeoPDF
    if (ext === ".pdf") {
        const result = await extractGeoPDFCorners(imagePath);
        const pngFilename = path_1.default.basename(imagePath, ext) + ".png";
        const pngPath = path_1.default.join(path_1.default.dirname(imagePath), pngFilename);
        let rendered;
        if (fs_1.default.existsSync(pngPath)) {
            console.log(`PDF→PNG: using pre-rendered companion ${pngFilename}`);
            rendered = pngPath;
        }
        else {
            rendered = await (0, pdf_render_1.renderPDFtoPNG)(imagePath, pngPath);
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
        if (rendered) {
            return {
                corners: null,
                crs: "EPSG:4326",
                calibrationMethod: "uncalibrated",
                renderedImagePath: pngFilename,
            };
        }
    }
    // 2. Try GeoTIFF
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
    // 3. Try world file
    const wfPath = worldFilePath || (0, geo_utils_1.findWorldFile)(imagePath);
    if (wfPath && fs_1.default.existsSync(wfPath)) {
        const content = fs_1.default.readFileSync(wfPath, "utf-8");
        const wf = (0, geo_utils_1.parseWorldFile)(content);
        if (wf) {
            const dims = await (0, geo_utils_1.getImageDimensions)(imagePath);
            if (dims) {
                const corners = (0, geo_utils_1.worldFileToCorners)(wf, dims.width, dims.height, "EPSG:4326");
                console.log(`World file: extracted corners from ${path_1.default.basename(wfPath)}`);
                return {
                    corners,
                    crs: "EPSG:4326",
                    calibrationMethod: "worldfile",
                };
            }
        }
    }
    // 4. No geo-reference found
    return null;
}
//# sourceMappingURL=geo-extract.js.map