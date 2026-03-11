"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadPdfjs = loadPdfjs;
exports.renderPDFtoPNG = renderPDFtoPNG;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// ---------------------------------------------------------------------------
// Lazy-load pdfjs-dist (ESM module)
// ---------------------------------------------------------------------------
let _pdfjsLib = null;
async function loadPdfjs() {
    if (!_pdfjsLib)
        _pdfjsLib = await Promise.resolve().then(() => __importStar(require("pdfjs-dist/legacy/build/pdf.mjs")));
    return _pdfjsLib;
}
// ---------------------------------------------------------------------------
// PDF → PNG rendering (using pdfjs-dist + node-canvas)
// ---------------------------------------------------------------------------
async function renderPDFtoPNG(pdfPath, outputPngPath, scale = 3) {
    try {
        const pdfjsLib = await loadPdfjs();
        const { createCanvas } = require("canvas");
        const buf = fs_1.default.readFileSync(pdfPath);
        const uint8 = new Uint8Array(buf);
        const doc = await pdfjsLib.getDocument({ data: uint8 }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale });
        const canvas = createCanvas(viewport.width, viewport.height);
        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;
        const pngBuf = canvas.toBuffer("image/png");
        fs_1.default.writeFileSync(outputPngPath, pngBuf);
        console.log(`PDF→PNG: rendered ${path_1.default.basename(pdfPath)} → ${path_1.default.basename(outputPngPath)} (${viewport.width}x${viewport.height}px)`);
        return outputPngPath;
    }
    catch (err) {
        console.error("PDF→PNG render error:", err.message);
        return null;
    }
}
//# sourceMappingURL=pdf-render.js.map