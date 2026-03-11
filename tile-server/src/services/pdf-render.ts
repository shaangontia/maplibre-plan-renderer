import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Lazy-load pdfjs-dist (ESM module)
// ---------------------------------------------------------------------------
let _pdfjsLib: any = null;

export async function loadPdfjs(): Promise<any> {
  if (!_pdfjsLib) _pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  return _pdfjsLib;
}

// ---------------------------------------------------------------------------
// PDF → PNG rendering (using pdfjs-dist + node-canvas)
// ---------------------------------------------------------------------------
export async function renderPDFtoPNG(
  pdfPath: string,
  outputPngPath: string,
  scale = 3,
): Promise<string | null> {
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

    await page.render({ canvasContext: ctx, viewport }).promise;

    const pngBuf = canvas.toBuffer("image/png");
    fs.writeFileSync(outputPngPath, pngBuf);

    console.log(
      `PDF→PNG: rendered ${path.basename(pdfPath)} → ${path.basename(outputPngPath)} (${viewport.width}x${viewport.height}px)`,
    );
    return outputPngPath;
  } catch (err: any) {
    console.error("PDF→PNG render error:", err.message);
    return null;
  }
}
