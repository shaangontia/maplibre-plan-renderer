const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const https = require("https");

const PORT = 8080;
const PLANS_DIR = path.join(__dirname, "plans");
const UPLOADS_DIR = path.join(PLANS_DIR, "images");
const DB_PATH = path.join(__dirname, "plans.json");

const app = express();
app.use(cors());
app.use(express.json());

// Ensure directories exist
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Multer config for plan image uploads
// ---------------------------------------------------------------------------
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".png";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/png", "image/jpeg", "image/webp"];
    cb(null, allowed.includes(file.mimetype));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
});

// ---------------------------------------------------------------------------
// Plans JSON store
// ---------------------------------------------------------------------------
// Schema per plan:
// {
//   id: string,
//   name: string,
//   imagePath: string,          (relative to UPLOADS_DIR)
//   center: [lon, lat],
//   widthDeg: number,           (longitude span)
//   heightDeg: number,          (latitude span)
//   opacity: number,            (0-1, default 0.85)
//   createdAt: string,
//   updatedAt: string,
// }

function readDb() {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeDb(plans) {
  fs.writeFileSync(DB_PATH, JSON.stringify(plans, null, 2));
}

function getBounds(plan) {
  const [lon, lat] = plan.center;
  const hw = plan.widthDeg / 2;
  const hh = plan.heightDeg / 2;
  return {
    sw: [lon - hw, lat - hh],
    ne: [lon + hw, lat + hh],
  };
}

// Seed default plan if DB is empty and floor_plan.png exists
function seedDefaultPlan() {
  const plans = readDb();
  if (plans.length > 0) return;

  const defaultImg = path.join(PLANS_DIR, "floor_plan.png");
  if (!fs.existsSync(defaultImg)) return;

  // Copy to uploads dir
  const filename = "default_floor_plan.png";
  const dest = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(dest)) fs.copyFileSync(defaultImg, dest);

  const defaultPlan = {
    id: crypto.randomUUID(),
    name: "Innovation Centre - Level 1",
    imagePath: filename,
    center: [-0.08685, 51.52125],
    widthDeg: 0.001,
    heightDeg: 0.0006,
    opacity: 0.85,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeDb([defaultPlan]);
  console.log(`Seeded default plan: ${defaultPlan.name}`);
}

// ---------------------------------------------------------------------------
// API: Plans CRUD
// ---------------------------------------------------------------------------

// GET /api/plans — list all plans
app.get("/api/plans", (_req, res) => {
  const plans = readDb();
  res.json({
    count: plans.length,
    plans: plans.map((p) => ({
      ...p,
      bounds: getBounds(p),
    })),
  });
});

// GET /api/plans/:id — get one plan
app.get("/api/plans/:id", (req, res) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === req.params.id);
  if (!plan) return res.status(404).json({ error: "Plan not found" });
  res.json({ ...plan, bounds: getBounds(plan) });
});

// POST /api/plans — create a new plan with image upload
// Body (multipart/form-data):
//   image: file (PNG/JPEG/WebP)
//   name: string
//   centerLon: number
//   centerLat: number
//   widthMeters: number  (approximate width in meters)
//   heightMeters: number (approximate height in meters)
//   opacity: number (0-1, optional, default 0.85)
app.post("/api/plans", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "Image file is required" });
  }

  const { name, centerLon, centerLat, widthMeters, heightMeters, opacity } =
    req.body;

  if (!name || !centerLon || !centerLat || !widthMeters || !heightMeters) {
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      error:
        "Required fields: name, centerLon, centerLat, widthMeters, heightMeters",
    });
  }

  const lat = parseFloat(centerLat);
  const lon = parseFloat(centerLon);
  const wm = parseFloat(widthMeters);
  const hm = parseFloat(heightMeters);

  // Convert meters to degrees (approximate)
  // 1 deg latitude ≈ 111,320 m
  // 1 deg longitude ≈ 111,320 * cos(lat) m
  const heightDeg = hm / 111320;
  const widthDeg = wm / (111320 * Math.cos((lat * Math.PI) / 180));

  const plan = {
    id: crypto.randomUUID(),
    name,
    imagePath: req.file.filename,
    center: [lon, lat],
    widthDeg,
    heightDeg,
    opacity: opacity ? parseFloat(opacity) : 0.85,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const plans = readDb();
  plans.push(plan);
  writeDb(plans);

  console.log(`Created plan: ${plan.name} at [${lon}, ${lat}]`);
  res.status(201).json({ ...plan, bounds: getBounds(plan) });
});

// PUT /api/plans/:id — update plan metadata (optionally replace image)
app.put("/api/plans/:id", upload.single("image"), (req, res) => {
  const plans = readDb();
  const idx = plans.findIndex((p) => p.id === req.params.id);
  if (idx === -1) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: "Plan not found" });
  }

  const plan = plans[idx];
  const { name, centerLon, centerLat, widthMeters, heightMeters, opacity } =
    req.body;

  if (name) plan.name = name;
  if (opacity) plan.opacity = parseFloat(opacity);

  if (centerLon && centerLat) {
    plan.center = [parseFloat(centerLon), parseFloat(centerLat)];
  }

  if (widthMeters && heightMeters) {
    const lat = plan.center[1];
    plan.heightDeg = parseFloat(heightMeters) / 111320;
    plan.widthDeg =
      parseFloat(widthMeters) / (111320 * Math.cos((lat * Math.PI) / 180));
  }

  if (req.file) {
    // Delete old image
    const oldPath = path.join(UPLOADS_DIR, plan.imagePath);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    plan.imagePath = req.file.filename;
  }

  plan.updatedAt = new Date().toISOString();
  plans[idx] = plan;
  writeDb(plans);

  console.log(`Updated plan: ${plan.name}`);
  res.json({ ...plan, bounds: getBounds(plan) });
});

// DELETE /api/plans/:id — remove a plan and its image
app.delete("/api/plans/:id", (req, res) => {
  const plans = readDb();
  const idx = plans.findIndex((p) => p.id === req.params.id);
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
// Serve plan images by ID
// ---------------------------------------------------------------------------
app.get("/api/plans/:id/image", (req, res) => {
  const plans = readDb();
  const plan = plans.find((p) => p.id === req.params.id);
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
// Empty glyph PBFs (avoid TLS errors)
// ---------------------------------------------------------------------------
app.get("/fonts/:fontstack/:range.pbf", (_req, res) => {
  const emptyPbf = Buffer.from([0x0a, 0x00]);
  res.set("Content-Type", "application/x-protobuf");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(emptyPbf);
});

// ---------------------------------------------------------------------------
// Basemap tile proxies (avoid TLS issues on iOS simulator)
// ---------------------------------------------------------------------------
// Helper: proxy an HTTPS tile URL to the client over HTTP
function proxyTile(upstreamUrl, contentType, headers, res) {
  const opts = {
    headers: headers || {},
    rejectUnauthorized: false, // bypass local CA cert issues
  };
  https
    .get(upstreamUrl, opts, (upstream) => {
      if (upstream.statusCode !== 200) {
        return res.status(upstream.statusCode || 502).end();
      }
      const chunks = [];
      upstream.on("data", (c) => chunks.push(c));
      upstream.on("end", () => {
        const buf = Buffer.concat(chunks);
        res.set("Content-Type", contentType);
        res.set("Cache-Control", "public, max-age=86400");
        res.send(buf);
      });
    })
    .on("error", (err) => {
      console.error("Tile proxy error:", err.message);
      res.status(502).end();
    });
}

app.get("/proxy/osm/:z/:x/:y.png", (req, res) => {
  const { z, x, y } = req.params;
  proxyTile(
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    "image/png",
    { "User-Agent": "PlanViewerTileProxy/1.0" },
    res
  );
});

app.get("/proxy/satellite/:z/:x/:y", (req, res) => {
  const { z, x, y } = req.params;
  proxyTile(
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    "image/jpeg",
    {},
    res
  );
});

// ---------------------------------------------------------------------------
// Dynamic style.json — renders ALL plans as image overlays on the basemap
// GET /style.json?mode=normal|satellite
// ---------------------------------------------------------------------------
app.get("/style.json", (req, res) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const baseUrl = `http://${host}`;
  const mode = req.query.mode || "normal";
  const plans = readDb();

  // Basemap source
  let basemapSource, basemapLayer;
  if (mode === "satellite") {
    basemapSource = {
      type: "raster",
      tiles: [`${baseUrl}/proxy/satellite/{z}/{x}/{y}`],
      tileSize: 256,
      maxzoom: 19,
      attribution: "Esri, Maxar, Earthstar Geographics",
    };
    basemapLayer = { id: "satellite", type: "raster", source: "basemap" };
  } else {
    basemapSource = {
      type: "raster",
      tiles: [`${baseUrl}/proxy/osm/{z}/{x}/{y}.png`],
      tileSize: 256,
      maxzoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    };
    basemapLayer = { id: "osm", type: "raster", source: "basemap" };
  }

  // Build sources and layers for each plan
  const sources = { basemap: basemapSource };
  const layers = [basemapLayer];

  plans.forEach((plan, i) => {
    const bounds = getBounds(plan);
    const srcId = `plan-${plan.id}`;
    sources[srcId] = {
      type: "image",
      url: `${baseUrl}/api/plans/${plan.id}/image`,
      coordinates: [
        [bounds.sw[0], bounds.ne[1]], // top-left
        [bounds.ne[0], bounds.ne[1]], // top-right
        [bounds.ne[0], bounds.sw[1]], // bottom-right
        [bounds.sw[0], bounds.sw[1]], // bottom-left
      ],
    };
    layers.push({
      id: `plan-layer-${plan.id}`,
      type: "raster",
      source: srcId,
      paint: { "raster-opacity": plan.opacity || 0.85 },
    });
  });

  res.json({
    version: 8,
    name: mode === "satellite" ? "Satellite + Plans" : "Map + Plans",
    glyphs: `${baseUrl}/fonts/{fontstack}/{range}.pbf`,
    sources,
    layers,
  });
});

// ---------------------------------------------------------------------------
// Plan info endpoint — returns all plans with bounds for the app
// ---------------------------------------------------------------------------
app.get("/plan-info", (_req, res) => {
  const plans = readDb();
  if (plans.length === 0) {
    return res.json({ plans: [], center: [0, 0], zoom: 2 });
  }

  // Calculate center that encompasses all plans
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  const result = plans.map((p) => {
    const bounds = getBounds(p);
    minLon = Math.min(minLon, bounds.sw[0]);
    maxLon = Math.max(maxLon, bounds.ne[0]);
    minLat = Math.min(minLat, bounds.sw[1]);
    maxLat = Math.max(maxLat, bounds.ne[1]);
    return {
      id: p.id,
      name: p.name,
      center: p.center,
      bounds,
      opacity: p.opacity,
    };
  });

  res.json({
    plans: result,
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    bounds: { sw: [minLon, minLat], ne: [maxLon, maxLat] },
    zoom: 18,
  });
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", plans: readDb().length });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
seedDefaultPlan();

app.listen(PORT, () => {
  const plans = readDb();
  console.log(`\nTile server running at http://localhost:${PORT}`);
  console.log(`Plans loaded: ${plans.length}`);
  console.log(`\nAPI endpoints:`);
  console.log(`  GET    /api/plans          — list all plans`);
  console.log(`  GET    /api/plans/:id      — get plan details`);
  console.log(`  POST   /api/plans          — create plan (multipart with image)`);
  console.log(`  PUT    /api/plans/:id      — update plan`);
  console.log(`  DELETE /api/plans/:id      — delete plan`);
  console.log(`  GET    /api/plans/:id/image — get plan image`);
  console.log(`  GET    /style.json?mode=normal|satellite`);
  console.log(`  GET    /plan-info          — all plans with bounds`);
});
