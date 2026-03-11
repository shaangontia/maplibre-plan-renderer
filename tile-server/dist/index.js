"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = __importDefault(require("./app"));
const config_1 = require("./config");
const plans_1 = require("./db/plans");
const seed_1 = require("./services/seed");
async function startServer() {
    await (0, seed_1.seedFromGeoPDFs)();
    app_1.default.listen(config_1.PORT, () => {
        const plans = (0, plans_1.readDb)();
        console.log(`\nTile server running at http://localhost:${config_1.PORT}`);
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
//# sourceMappingURL=index.js.map