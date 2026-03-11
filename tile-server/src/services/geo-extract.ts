import fs from "fs";
import path from "path";
import proj4 from "proj4";
import type { Corners, GeoExtractResult, GeoTIFFResult, GeoPDFResult, PdfMetadata } from "../types";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const GeoTIFF = require("geotiff");
import { loadPdfjs, renderPDFtoPNG } from "./pdf-render";
import { parseWorldFile, worldFileToCorners, findWorldFile, getImageDimensions } from "./geo-utils";

// ---------------------------------------------------------------------------
// GeoTIFF corner extraction
// ---------------------------------------------------------------------------
export async function extractGeoTIFFCorners(filePath: string): Promise<GeoTIFFResult | null> {
  try {
    const buf = fs.readFileSync(filePath);
    const arrayBuf = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const tiff = await GeoTIFF.fromArrayBuffer(arrayBuf);
    const image = await tiff.getImage();

    const tiepoint = image.getTiePoints();
    const pixelScale = (image.getFileDirectory() as any).ModelPixelScale;
    const modelTransform = (image.getFileDirectory() as any).ModelTransformation;

    const width = image.getWidth();
    const height = image.getHeight();

    let originX: number, originY: number, resX: number, resY: number;

    if (modelTransform) {
      originX = modelTransform[3];
      originY = modelTransform[7];
      resX = modelTransform[0];
      resY = modelTransform[5];
    } else if (tiepoint && tiepoint.length > 0 && pixelScale) {
      originX = tiepoint[0].x - tiepoint[0].i * pixelScale[0];
      originY = tiepoint[0].y + tiepoint[0].j * pixelScale[1];
      resX = pixelScale[0];
      resY = -pixelScale[1];
    } else {
      console.log("GeoTIFF: no transform found in file");
      return null;
    }

    const geoKeys = image.getGeoKeys();
    let sourceCRS = "EPSG:4326";
    if (geoKeys) {
      const epsg = (geoKeys as any).ProjectedCSTypeGeoKey || (geoKeys as any).GeographicTypeGeoKey;
      if (epsg && epsg !== 32767) sourceCRS = `EPSG:${epsg}`;
    }

    const cornersSource: Corners = {
      topLeft: [originX, originY],
      topRight: [originX + width * resX, originY],
      bottomRight: [originX + width * resX, originY + height * resY],
      bottomLeft: [originX, originY + height * resY],
    };

    let cornersWGS84: Corners;
    if (sourceCRS === "EPSG:4326") {
      cornersWGS84 = cornersSource;
    } else {
      try {
        const transform = proj4(sourceCRS, "EPSG:4326");
        cornersWGS84 = {
          topLeft: transform.forward(cornersSource.topLeft) as [number, number],
          topRight: transform.forward(cornersSource.topRight) as [number, number],
          bottomRight: transform.forward(cornersSource.bottomRight) as [number, number],
          bottomLeft: transform.forward(cornersSource.bottomLeft) as [number, number],
        };
      } catch {
        console.warn(`GeoTIFF: CRS ${sourceCRS} not recognized by proj4, using raw coords as lon/lat`);
        cornersWGS84 = cornersSource;
      }
    }

    console.log(`GeoTIFF: extracted corners from ${path.basename(filePath)}`);
    console.log(`  CRS: ${sourceCRS}, Size: ${width}x${height}`);
    console.log(`  TL: [${cornersWGS84.topLeft}], BR: [${cornersWGS84.bottomRight}]`);

    return { corners: cornersWGS84, crs: sourceCRS, width, height };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// GeoPDF corner extraction
// ---------------------------------------------------------------------------
export async function extractGeoPDFCorners(filePath: string): Promise<GeoPDFResult | null> {
  try {
    const pdfjsLib = await loadPdfjs();
    const buf = fs.readFileSync(filePath);
    const uint8 = new Uint8Array(buf);
    const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
    const meta = await doc.getMetadata();

    const keywords: string = meta?.info?.Keywords || "";
    if (!keywords.includes("GEO:")) return null;

    const geoData: Record<string, string> = {};
    const parts = keywords.split(";").map((s: string) => s.trim());
    for (const part of parts) {
      const match = part.match(/^GEO:(\w+)=(.+)$/);
      if (match) geoData[match[1]] = match[2].trim();
    }

    if (!geoData.TOPLEFT || !geoData.TOPRIGHT || !geoData.BOTTOMRIGHT || !geoData.BOTTOMLEFT) {
      console.log("GeoPDF: found GEO: tags but missing corner coordinates");
      return null;
    }

    const parseCoord = (s: string): [number, number] => s.split(",").map(Number) as [number, number];
    const corners: Corners = {
      topLeft: parseCoord(geoData.TOPLEFT),
      topRight: parseCoord(geoData.TOPRIGHT),
      bottomRight: parseCoord(geoData.BOTTOMRIGHT),
      bottomLeft: parseCoord(geoData.BOTTOMLEFT),
    };

    const crs = geoData.CRS || "EPSG:4326";

    console.log(`GeoPDF: extracted corners from ${path.basename(filePath)}`);
    console.log(`  CRS: ${crs}`);
    console.log(`  TL: [${corners.topLeft}], BR: [${corners.bottomRight}]`);

    const pdfMeta: PdfMetadata = {
      floor: geoData.FLOOR || "",
      building: geoData.BUILDING || "",
      site: geoData.SITE || "",
      title: meta?.info?.Title || "",
    };

    return { corners, crs, metadata: pdfMeta };
  } catch (err: any) {
    console.warn("GeoPDF extraction error:", err.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Master geo-reference extraction: tries all methods in order
// ---------------------------------------------------------------------------
export async function autoExtractGeoReference(
  imagePath: string,
  worldFilePath: string | null,
): Promise<GeoExtractResult | null> {
  const ext = path.extname(imagePath).toLowerCase();

  // 1. Try GeoPDF
  if (ext === ".pdf") {
    const result = await extractGeoPDFCorners(imagePath);
    const pngFilename = path.basename(imagePath, ext) + ".png";
    const pngPath = path.join(path.dirname(imagePath), pngFilename);

    let rendered: string | null;
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

  // 4. No geo-reference found
  return null;
}
