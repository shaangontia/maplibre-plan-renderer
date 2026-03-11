import fs from "fs";
import path from "path";
import crypto from "crypto";
import { UPLOADS_DIR } from "../config";
import { readDb, writeDb, getCenter } from "../db/plans";
import { autoExtractGeoReference } from "./geo-extract";
import type { Plan } from "../types";

// ---------------------------------------------------------------------------
// Seed plans from GeoPDFs on first run (empty DB)
// ---------------------------------------------------------------------------
export async function seedFromGeoPDFs(): Promise<void> {
  const plans = readDb();
  if (plans.length > 0) return;

  const pdfFiles = fs.readdirSync(UPLOADS_DIR).filter((f) =>
    f.toLowerCase().endsWith(".pdf"),
  );
  if (pdfFiles.length === 0) {
    console.log("No GeoPDFs found in images directory to seed.");
    return;
  }

  console.log(`\nSeeding ${pdfFiles.length} plans from GeoPDFs...`);
  const seeded: Plan[] = [];

  for (const pdfFile of pdfFiles) {
    const pdfPath = path.join(UPLOADS_DIR, pdfFile);
    try {
      const extracted = await autoExtractGeoReference(pdfPath, null);
      if (!extracted) {
        console.warn(`  Skipped ${pdfFile}: no geo-reference found`);
        continue;
      }

      const meta = extracted.metadata || { title: "", floor: "", building: "", site: "" };
      const plan: Plan = {
        id: crypto.randomUUID(),
        name: meta.title || path.basename(pdfFile, ".pdf"),
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
      const center = getCenter(plan);
      console.log(`  Seeded: ${plan.name} [${plan.calibrationMethod}] at [${center[0].toFixed(5)}, ${center[1].toFixed(5)}]`);
    } catch (err: any) {
      console.error(`  Error processing ${pdfFile}:`, err.message);
    }
  }

  if (seeded.length > 0) {
    writeDb(seeded);
    console.log(`\nSeeded ${seeded.length} plans from GeoPDFs.\n`);
  }
}
