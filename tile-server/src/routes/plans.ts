import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { Request, Response } from "express";
import type { Corners, ControlPoint, Plan } from "../types";
import { UPLOADS_DIR } from "../config";
import { readDb, writeDb, getBounds, getCenter, findPlanIndex } from "../db/plans";
import { autoExtractGeoReference } from "../services/geo-extract";
import { metersToCorners, getImageDimensions } from "../services/geo-utils";
import { detectAreas } from "../services/area-detect";
import { uploadFields, upload } from "../middleware/upload";

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/plans — list all
// ---------------------------------------------------------------------------
router.get("/", (_req: Request, res: Response) => {
  const plans = readDb();
  res.json({
    count: plans.length,
    plans: plans.map((p) => ({
      ...p,
      center: getCenter(p),
      bounds: getBounds(p),
    })),
  });
});

// ---------------------------------------------------------------------------
// GET /api/plans/:id
// ---------------------------------------------------------------------------
router.get("/:id", (req: Request, res: Response) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === (req.params.id as string));
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json({ ...plan, center: getCenter(plan), bounds: getBounds(plan) });
});

// ---------------------------------------------------------------------------
// POST /api/plans — create with auto geo-reference extraction
// ---------------------------------------------------------------------------
router.post("/", uploadFields, async (req: Request, res: Response) => {
  const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
  const imageFile = files?.image?.[0];
  if (!imageFile) {
    return res.status(400).json({ error: "Image file is required (field: 'image')" });
  }

  let { name, opacity, floor, building, site, rotation } = req.body;

  let corners: Corners | null = null;
  let calibrationMethod = "uncalibrated";
  let detectedCRS = "EPSG:4326";
  let resolvedImagePath = imageFile.filename;
  let pdfSourcePath: string | null = null;
  let extractedMeta: any = null;

  // Priority 1: Explicit corners in request body
  if (req.body.corners) {
    try {
      corners = typeof req.body.corners === "string"
        ? JSON.parse(req.body.corners)
        : req.body.corners;
      if (!corners!.topLeft || !corners!.topRight || !corners!.bottomRight || !corners!.bottomLeft) {
        throw new Error("Missing corner");
      }
      calibrationMethod = "manual";
    } catch {
      fs.unlinkSync(imageFile.path);
      return res.status(400).json({
        error: "corners must be JSON with topLeft, topRight, bottomRight, bottomLeft as [lon,lat]",
      });
    }
  }

  // Priority 2: Auto-extract from file
  if (!corners) {
    const worldFilePath = files?.worldfile?.[0]?.path || null;
    try {
      const extracted = await autoExtractGeoReference(imageFile.path, worldFilePath);
      if (extracted) {
        if (extracted.corners) corners = extracted.corners;
        calibrationMethod = extracted.calibrationMethod;
        detectedCRS = extracted.crs;
        extractedMeta = extracted.metadata || null;

        if (extracted.renderedImagePath) {
          pdfSourcePath = imageFile.filename;
          resolvedImagePath = extracted.renderedImagePath;
        }

        console.log(`Auto-extracted geo-reference: method=${calibrationMethod}, crs=${detectedCRS}`);
      }
    } catch (err: any) {
      console.warn("Geo-reference extraction failed:", err.message);
    }
  }

  // Priority 3: Center + dimensions fallback
  if (!corners && req.body.centerLon && req.body.centerLat && req.body.widthMeters && req.body.heightMeters) {
    corners = metersToCorners(
      parseFloat(req.body.centerLon),
      parseFloat(req.body.centerLat),
      parseFloat(req.body.widthMeters),
      parseFloat(req.body.heightMeters),
      parseFloat(rotation || 0),
    );
    calibrationMethod = "center-dimensions";
  }

  // Priority 4: Uncalibrated
  if (!corners) {
    corners = {
      topLeft: [0, 0], topRight: [0, 0],
      bottomRight: [0, 0], bottomLeft: [0, 0],
    };
    if (calibrationMethod === "uncalibrated") {
      console.log(`Plan "${name || "unnamed"}" saved as UNCALIBRATED`);
    }
  }

  // Use metadata from GeoPDF if fields not provided
  if (extractedMeta) {
    if (!name && extractedMeta.title) name = extractedMeta.title;
    if (!floor && extractedMeta.floor) floor = extractedMeta.floor;
    if (!building && extractedMeta.building) building = extractedMeta.building;
    if (!site && extractedMeta.site) site = extractedMeta.site;
  }

  if (!name) {
    fs.unlinkSync(imageFile.path);
    return res.status(400).json({ error: "name is required (not found in PDF metadata either)" });
  }

  const plan: Plan = {
    id: crypto.randomUUID(),
    name,
    imagePath: resolvedImagePath,
    pdfPath: pdfSourcePath || null,
    corners,
    opacity: opacity ? parseFloat(opacity) : 0.85,
    rotation: parseFloat(rotation || 0),
    floor: floor || "",
    building: building || "",
    site: site || "",
    crs: detectedCRS,
    calibrationMethod,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const plans = readDb();
  plans.push(plan);
  writeDb(plans);

  const center = getCenter(plan);
  console.log(`Created plan: ${plan.name} [${calibrationMethod}] at [${center[0].toFixed(6)}, ${center[1].toFixed(6)}]`);
  res.status(201).json({ ...plan, center, bounds: getBounds(plan) });
});

// ---------------------------------------------------------------------------
// PUT /api/plans/:id — update
// ---------------------------------------------------------------------------
router.put("/:id", upload.single("image"), (req: Request, res: Response) => {
  const { plans, idx } = findPlanIndex(req.params.id as string);
  if (idx === -1) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Plan not found" });
  }

  const plan = plans[idx];
  const { name, opacity, floor, building, site, rotation } = req.body;

  if (name) plan.name = name;
  if (opacity) plan.opacity = parseFloat(opacity);
  if (floor !== undefined) plan.floor = floor;
  if (building !== undefined) plan.building = building;
  if (site !== undefined) plan.site = site;
  if (rotation !== undefined) plan.rotation = parseFloat(rotation);

  if (req.body.corners) {
    try {
      plan.corners = typeof req.body.corners === "string"
        ? JSON.parse(req.body.corners)
        : req.body.corners;
      plan.calibrationMethod = "manual";
    } catch {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: "Invalid corners JSON" });
    }
  } else if (req.body.centerLon && req.body.centerLat && req.body.widthMeters && req.body.heightMeters) {
    plan.corners = metersToCorners(
      parseFloat(req.body.centerLon),
      parseFloat(req.body.centerLat),
      parseFloat(req.body.widthMeters),
      parseFloat(req.body.heightMeters),
      parseFloat(rotation || plan.rotation || 0),
    );
    plan.calibrationMethod = "center-dimensions";
  }

  if (req.file) {
    const oldPath = path.join(UPLOADS_DIR, plan.imagePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    plan.imagePath = req.file.filename;
  }

  plan.updatedAt = new Date().toISOString();
  plans[idx] = plan;
  writeDb(plans);

  console.log(`Updated plan: ${plan.name}`);
  res.json({ ...plan, center: getCenter(plan), bounds: getBounds(plan) });
});

// ---------------------------------------------------------------------------
// DELETE /api/plans/:id
// ---------------------------------------------------------------------------
router.delete("/:id", (req: Request, res: Response) => {
  const { plans, idx } = findPlanIndex(req.params.id as string);
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });

  const plan = plans[idx];
  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);

  plans.splice(idx, 1);
  writeDb(plans);

  console.log(`Deleted plan: ${plan.name}`);
  res.json({ deleted: true, id: plan.id });
});

// ---------------------------------------------------------------------------
// GET /api/plans/:id/detect-areas
// ---------------------------------------------------------------------------
router.get("/:id/detect-areas", async (req: Request, res: Response) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === (req.params.id as string));
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  if (!fs.existsSync(imgPath)) {
    return res.status(404).json({ error: "Image file missing" });
  }

  try {
    const areas = await detectAreas(imgPath, plan.corners);
    console.log(`Detected ${areas.length} rooms in plan: ${plan.name}`);
    res.json({ planId: plan.id, count: areas.length, areas });
  } catch (err: any) {
    console.error("detect-areas error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/plans/:id/image — serve plan image
// ---------------------------------------------------------------------------
router.get("/:id/image", (req: Request, res: Response) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === (req.params.id as string));
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  if (!fs.existsSync(imgPath)) {
    return res.status(404).json({ error: "Image file missing" });
  }
  res.set("Content-Type", "image/png");
  res.set("Cache-Control", "public, max-age=3600");
  res.sendFile(imgPath);
});

// ---------------------------------------------------------------------------
// POST /api/plans/:id/calibrate — manual calibration with control points
// ---------------------------------------------------------------------------
router.post("/:id/calibrate", async (req: Request, res: Response) => {
  const { plans, idx } = findPlanIndex(req.params.id as string);
  if (idx === -1) return res.status(404).json({ error: "Plan not found" });

  const plan = plans[idx];
  const { controlPoints, crs } = req.body as { controlPoints: ControlPoint[]; crs?: string };

  if (!controlPoints || !Array.isArray(controlPoints) || controlPoints.length < 2) {
    return res.status(400).json({
      error: "Need at least 2 control points: [{ pixel: [x,y], world: [lon,lat] }, ...]",
    });
  }

  const imgPath = path.join(UPLOADS_DIR, plan.imagePath);
  const dims = await getImageDimensions(imgPath);
  if (!dims) {
    return res.status(500).json({ error: "Could not read image dimensions" });
  }

  const n = controlPoints.length;
  let a: number, b: number, c: number, d: number, tx: number, ty: number;

  if (n === 2) {
    const p1 = controlPoints[0], p2 = controlPoints[1];
    const dxPixel = p2.pixel[0] - p1.pixel[0];
    const dyPixel = p2.pixel[1] - p1.pixel[1];
    const dxWorld = p2.world[0] - p1.world[0];
    const dyWorld = p2.world[1] - p1.world[1];

    a = dxPixel !== 0 ? dxWorld / dxPixel : 0;
    d = dyPixel !== 0 ? dyWorld / dyPixel : 0;
    b = 0; c = 0;
    tx = p1.world[0] - a * p1.pixel[0];
    ty = p1.world[1] - d * p1.pixel[1];
  } else {
    const pFirst = controlPoints[0], pLast = controlPoints[n - 1];
    const dxP = pLast.pixel[0] - pFirst.pixel[0];
    const dyP = pLast.pixel[1] - pFirst.pixel[1];
    const dxW = pLast.world[0] - pFirst.world[0];
    const dyW = pLast.world[1] - pFirst.world[1];
    const lenP = Math.sqrt(dxP * dxP + dyP * dyP);
    const lenW = Math.sqrt(dxW * dxW + dyW * dyW);
    const scale = lenP > 0 ? lenW / lenP : 0;
    const angleP = Math.atan2(dyP, dxP);
    const angleW = Math.atan2(dyW, dxW);
    const rot = angleW - angleP;

    a = scale * Math.cos(rot);
    b = -scale * Math.sin(rot);
    c = scale * Math.sin(rot);
    d = scale * Math.cos(rot);
    tx = pFirst.world[0] - a * pFirst.pixel[0] - b * pFirst.pixel[1];
    ty = pFirst.world[1] - c * pFirst.pixel[0] - d * pFirst.pixel[1];
  }

  const transform = (px: number, py: number): [number, number] =>
    [a * px + b * py + tx, c * px + d * py + ty];

  const corners: Corners = {
    topLeft: transform(0, 0),
    topRight: transform(dims.width, 0),
    bottomRight: transform(dims.width, dims.height),
    bottomLeft: transform(0, dims.height),
  };

  plan.corners = corners;
  plan.calibrationMethod = "calibrated";
  plan.crs = crs || "EPSG:4326";
  plan.updatedAt = new Date().toISOString();
  plans[idx] = plan;
  writeDb(plans);

  const center = getCenter(plan);
  console.log(`Calibrated plan "${plan.name}" with ${n} control points`);
  console.log(`  TL: [${corners.topLeft}], BR: [${corners.bottomRight}]`);

  res.json({
    ...plan,
    center,
    bounds: getBounds(plan),
    affineTransform: { a, b, c, d, tx, ty },
    controlPointsUsed: n,
  });
});

export default router;
