import { Router } from "express";
import https from "https";
import type { Request, Response } from "express";
import { MAPILLARY_CLIENT_TOKEN, MAPILLARY_API_BASE } from "../config";

const router = Router();

// ---------------------------------------------------------------------------
// Helper: fetch JSON from Mapillary Graph API
// ---------------------------------------------------------------------------
function fetchMapillary(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { Authorization: `OAuth ${MAPILLARY_CLIENT_TOKEN}` }, rejectUnauthorized: false }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Mapillary API returned ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString()));
          } catch (e) {
            reject(new Error("Failed to parse Mapillary response"));
          }
        });
      })
      .on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// GET /mapillary/nearest?lng=...&lat=...&radius=...
// Find the nearest Mapillary image to a given coordinate
// ---------------------------------------------------------------------------
router.get("/nearest", async (req: Request, res: Response) => {
  if (!MAPILLARY_CLIENT_TOKEN) {
    return res.status(503).json({
      error: "Mapillary client token not configured. Set MAPILLARY_CLIENT_TOKEN env var.",
    });
  }

  const lng = parseFloat(req.query.lng as string);
  const lat = parseFloat(req.query.lat as string);
  const radius = parseInt(req.query.radius as string) || 100; // meters

  if (isNaN(lng) || isNaN(lat)) {
    return res.status(400).json({ error: "lng and lat query params are required (numbers)" });
  }

  try {
    // Mapillary Graph API: search images near a point
    // bbox approach: create a small bbox around the point
    const dlng = radius / (111320 * Math.cos((lat * Math.PI) / 180));
    const dlat = radius / 111320;
    const bbox = `${lng - dlng},${lat - dlat},${lng + dlng},${lat + dlat}`;

    const url =
      `${MAPILLARY_API_BASE}/images?` +
      `fields=id,geometry,captured_at,compass_angle,sequence,creator,thumb_1024_url,is_pano` +
      `&bbox=${bbox}` +
      `&limit=10`;

    const data = await fetchMapillary(url);
    const images: any[] = data?.data || [];

    if (images.length === 0) {
      return res.json({
        found: false,
        message: "No Mapillary coverage here",
        searchCenter: { lng, lat },
        radiusMeters: radius,
      });
    }

    // Sort by distance to the requested point, pick nearest
    const toRad = (d: number) => (d * Math.PI) / 180;
    function haversineM(lon1: number, lat1: number, lon2: number, lat2: number): number {
      const R = 6371000;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    const ranked = images
      .map((img: any) => {
        const [iLng, iLat] = img.geometry.coordinates;
        return {
          id: img.id,
          lng: iLng,
          lat: iLat,
          capturedAt: img.captured_at,
          compassAngle: img.compass_angle,
          sequenceId: img.sequence,
          isPano: img.is_pano,
          thumbUrl: img.thumb_1024_url,
          distanceM: haversineM(lng, lat, iLng, iLat),
        };
      })
      .sort((a: any, b: any) => a.distanceM - b.distanceM);

    const nearest = ranked[0];
    const nearby = ranked.slice(1, 5); // up to 4 more candidates

    res.json({
      found: true,
      searchCenter: { lng, lat },
      radiusMeters: radius,
      nearest,
      nearby,
    });
  } catch (err: any) {
    console.error("Mapillary API error:", err.message);
    res.status(502).json({ error: "Failed to query Mapillary API", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /mapillary/image/:id — get metadata for a specific image
// ---------------------------------------------------------------------------
router.get("/image/:id", async (req: Request, res: Response) => {
  if (!MAPILLARY_CLIENT_TOKEN) {
    return res.status(503).json({ error: "Mapillary client token not configured" });
  }

  const imageId = req.params.id as string;
  const url =
    `${MAPILLARY_API_BASE}/${imageId}?` +
    `fields=id,geometry,captured_at,compass_angle,sequence,creator,thumb_1024_url,thumb_2048_url,is_pano`;

  try {
    const data = await fetchMapillary(url);
    const [iLng, iLat] = data.geometry.coordinates;
    res.json({
      id: data.id,
      lng: iLng,
      lat: iLat,
      capturedAt: data.captured_at,
      compassAngle: data.compass_angle,
      sequenceId: data.sequence,
      isPano: data.is_pano,
      thumbUrl: data.thumb_1024_url,
      thumbUrlHi: data.thumb_2048_url,
    });
  } catch (err: any) {
    console.error("Mapillary image fetch error:", err.message);
    res.status(502).json({ error: "Failed to fetch Mapillary image", detail: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /mapillary/viewer?imageId=... — serve the MapillaryJS viewer HTML page
// ---------------------------------------------------------------------------
router.get("/viewer", (_req: Request, res: Response) => {
  const imageId = _req.query.imageId as string || "";
  const token = MAPILLARY_CLIENT_TOKEN;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no"/>
  <title>Street View</title>
  <link rel="stylesheet" href="https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.css"/>
  <script src="https://unpkg.com/mapillary-js@4.1.2/dist/mapillary.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{width:100%;height:100%;overflow:hidden;background:#1a1a1a}
    #viewer{width:100%;height:100%}
    #placeholder{display:flex;align-items:center;justify-content:center;width:100%;height:100%;color:#999;font-family:-apple-system,sans-serif;font-size:16px;text-align:center;padding:20px}
    #placeholder.hidden{display:none}
    #viewer.hidden{display:none}
    #info{position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.7);color:#fff;padding:8px 12px;font-family:monospace;font-size:11px;z-index:10}
  </style>
</head>
<body>
  <div id="placeholder">Loading street-level imagery...</div>
  <div id="viewer" class="hidden"></div>
  <div id="info"></div>
  <script>
    var viewer = null;
    var placeholderEl = document.getElementById("placeholder");
    var viewerEl = document.getElementById("viewer");
    var infoEl = document.getElementById("info");

    function showViewer(){placeholderEl.classList.add("hidden");viewerEl.classList.remove("hidden")}

    function init(){
      viewer = new mapillary.Viewer({
        accessToken: ${JSON.stringify(token)},
        container: "viewer",
        component: {cover:false, bearing:{size:mapillary.ComponentSize.Small}, sequence:{visible:true}, zoom:{size:mapillary.ComponentSize.Small}}
      });
      viewer.on("image", function(e){
        var img = e.image;
        if(img){
          infoEl.textContent = "Image " + img.id + " | " + img.lngLat.lat.toFixed(5) + ", " + img.lngLat.lng.toFixed(5);
        }
      });
      var imageId = ${JSON.stringify(imageId)};
      if(imageId){
        showViewer();
        viewer.moveTo(imageId).catch(function(err){
          placeholderEl.textContent = "Could not load image: " + err.message;
          placeholderEl.classList.remove("hidden");
          viewerEl.classList.add("hidden");
        });
      } else {
        placeholderEl.textContent = "No image ID provided";
      }
    }

    init();
  </script>
</body>
</html>`;

  res.set("Content-Type", "text/html");
  res.send(html);
});

export default router;
