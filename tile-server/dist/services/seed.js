"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedFromGeoPDFs = seedFromGeoPDFs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
const plans_1 = require("../db/plans");
const geo_extract_1 = require("./geo-extract");
// ---------------------------------------------------------------------------
// Seed plans from GeoPDFs on first run (empty DB)
// ---------------------------------------------------------------------------
async function seedFromGeoPDFs() {
    const plans = (0, plans_1.readDb)();
    if (plans.length > 0)
        return;
    const pdfFiles = fs_1.default.readdirSync(config_1.UPLOADS_DIR).filter((f) => f.toLowerCase().endsWith(".pdf"));
    if (pdfFiles.length === 0) {
        console.log("No GeoPDFs found in images directory to seed.");
        return;
    }
    console.log(`\nSeeding ${pdfFiles.length} plans from GeoPDFs...`);
    const seeded = [];
    for (const pdfFile of pdfFiles) {
        const pdfPath = path_1.default.join(config_1.UPLOADS_DIR, pdfFile);
        try {
            const extracted = await (0, geo_extract_1.autoExtractGeoReference)(pdfPath, null);
            if (!extracted) {
                console.warn(`  Skipped ${pdfFile}: no geo-reference found`);
                continue;
            }
            const meta = extracted.metadata || { title: "", floor: "", building: "", site: "" };
            const plan = {
                id: crypto_1.default.randomUUID(),
                name: meta.title || path_1.default.basename(pdfFile, ".pdf"),
                imagePath: extracted.renderedImagePath || pdfFile,
                pdfPath: pdfFile,
                corners: extracted.corners || {
                    topLeft: [0, 0], topRight: [0, 0],
                    bottomRight: [0, 0], bottomLeft: [0, 0],
                },
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
            const center = (0, plans_1.getCenter)(plan);
            console.log(`  Seeded: ${plan.name} [${plan.calibrationMethod}] at [${center[0].toFixed(5)}, ${center[1].toFixed(5)}]`);
        }
        catch (err) {
            console.error(`  Error processing ${pdfFile}:`, err.message);
        }
    }
    if (seeded.length > 0) {
        (0, plans_1.writeDb)(seeded);
        console.log(`\nSeeded ${seeded.length} plans from GeoPDFs.\n`);
    }
}
//# sourceMappingURL=seed.js.map