import app from "./app";
import { PORT } from "./config";
import { readDb } from "./db/plans";
import { seedFromGeoPDFs } from "./services/seed";

async function startServer(): Promise<void> {
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
