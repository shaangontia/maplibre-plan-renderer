import { Router } from "express";
import https from "https";
import type { Request, Response } from "express";
import { PORT } from "../config";
import { readDb, getBounds, getCenter } from "../db/plans";

const router = Router();

// ---------------------------------------------------------------------------
// Tile proxy helper
// ---------------------------------------------------------------------------
function proxyTile(
  upstreamUrl: string,
  contentType: string,
  headers: Record<string, string>,
  res: Response,
): void {
  const opts = { headers: headers || {}, rejectUnauthorized: false };
  https
    .get(upstreamUrl, opts, (upstream) => {
      if (upstream.statusCode !== 200) {
        res.status(upstream.statusCode || 502).end();
        return;
      }
      const chunks: Buffer[] = [];
      upstream.on("data", (c: Buffer) => chunks.push(c));
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

// ---------------------------------------------------------------------------
// OSM proxy
// ---------------------------------------------------------------------------
router.get("/osm/:z/:x/:y.png", (req: Request, res: Response) => {
  const { z, x, y } = req.params;
  proxyTile(
    `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    "image/png",
    { "User-Agent": "PlanViewerTileProxy/1.0" },
    res,
  );
});

// ---------------------------------------------------------------------------
// Satellite proxy (Esri)
// ---------------------------------------------------------------------------
router.get("/satellite/:z/:x/:y", (req: Request, res: Response) => {
  const { z, x, y } = req.params;
  proxyTile(
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    "image/jpeg",
    {},
    res,
  );
});

// ---------------------------------------------------------------------------
// Empty glyph PBFs
// ---------------------------------------------------------------------------
router.get("/fonts/:fontstack/:range.pbf", (_req: Request, res: Response) => {
  const emptyPbf = Buffer.from([0x0a, 0x00]);
  res.set("Content-Type", "application/x-protobuf");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(emptyPbf);
});

// ---------------------------------------------------------------------------
// Dynamic style.json
// ---------------------------------------------------------------------------
router.get("/style.json", (req: Request, res: Response) => {
  const host = req.headers.host || `localhost:${PORT}`;
  const baseUrl = `http://${host}`;
  const mode = (req.query.mode as string) || "normal";
  const planId = (req.query.planId as string) || null;
  const allPlans = readDb();
  const plans = planId ? allPlans.filter((p) => p.id === planId) : allPlans;

  const sources: Record<string, any> = {};
  const layers: any[] = [];

  if (mode !== "canvas") {
    let basemapSource: any, basemapLayer: any;
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
    sources.basemap = basemapSource;
    layers.push(basemapLayer);
  }

  plans.forEach((plan) => {
    const c = plan.corners;
    const srcId = `plan-${plan.id}`;
    sources[srcId] = {
      type: "image",
      url: `${baseUrl}/api/plans/${plan.id}/image`,
      coordinates: [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft],
    };
    layers.push({
      id: `plan-layer-${plan.id}`,
      type: "raster",
      source: srcId,
      paint: { "raster-opacity": plan.opacity || 0.85 },
    });
  });

  const styleName =
    mode === "canvas" ? "Canvas (Plan Only)" :
    mode === "satellite" ? "Satellite + Plans" : "Map + Plans";

  res.json({
    version: 8,
    name: styleName,
    glyphs: `${baseUrl}/fonts/{fontstack}/{range}.pbf`,
    sources,
    layers,
  });
});

// ---------------------------------------------------------------------------
// Plan info endpoint (all plans with bounds)
// ---------------------------------------------------------------------------
router.get("/plan-info", (_req: Request, res: Response) => {
  const plans = readDb();
  if (plans.length === 0) {
    return res.json({ plans: [], center: [0, 0], zoom: 2 });
  }

  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  const result = plans.map((p) => {
    const bounds = getBounds(p);
    const center = getCenter(p);
    minLon = Math.min(minLon, bounds.sw[0]);
    maxLon = Math.max(maxLon, bounds.ne[0]);
    minLat = Math.min(minLat, bounds.sw[1]);
    maxLat = Math.max(maxLat, bounds.ne[1]);
    return {
      id: p.id,
      name: p.name,
      center,
      corners: p.corners,
      bounds,
      opacity: p.opacity,
      floor: p.floor,
      building: p.building,
      site: p.site,
      calibrationMethod: p.calibrationMethod,
      group: p.group,
      isOverview: p.isOverview,
      linkedSheets: p.linkedSheets,
      sheetNumber: p.sheetNumber,
    };
  });

  res.json({
    plans: result,
    center: [(minLon + maxLon) / 2, (minLat + maxLat) / 2],
    bounds: { sw: [minLon, minLat], ne: [maxLon, maxLat] },
    zoom: 18,
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
router.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", plans: readDb().length });
});

export default router;
