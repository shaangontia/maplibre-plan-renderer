# MapLibre 2D Plan Viewer

A mobile app for viewing geo-referenced floor plans on a real-world map with defect pinning, area marking, and measurement tools.

## Architecture

```
┌─────────────────┐       ┌──────────────────────┐
│  React Native    │ HTTP  │  Node.js Tile Server  │
│  (Expo + MapLibre│◄─────►│  (Express)            │
│   React Native)  │       │                       │
└─────────────────┘       └──────────────────────┘
                               │
                               ├─ /style.json  (MapLibre style with plan overlays)
                               ├─ /plan-info   (plan metadata + corners)
                               ├─ /api/plans   (CRUD with auto geo-reference extraction)
                               ├─ /api/plans/:id/calibrate  (manual calibration)
                               ├─ /proxy/osm   (basemap tile proxy)
                               └─ /proxy/satellite
```

## Production Geo-Referencing Pipeline

### The Problem
Floor plans are flat images (PNG, JPEG, TIFF, PDF). They contain no geospatial data by default. To overlay them on a real-world map, the server must know the real-world coordinates of each image corner.

### The Solution: Auto-Extract at Upload Time

**Coordinates are NEVER hardcoded.** The server automatically extracts them from the uploaded file:

```
Upload → Auto-detect → Extract corners → Store in DB → Serve to MapLibre
```

The `plans.json` file is just a **local-dev database** (would be Postgres/MongoDB in production). It is populated automatically — not edited by hand.

### Extraction Priority (on upload)

| Priority | Method | Trigger | What Happens |
|----------|--------|---------|--------------|
| 1 | **GeoTIFF** | `.tif`/`.tiff` upload | Reads affine transform + CRS from TIFF tags. Auto-reprojects to WGS84. |
| 2 | **World File** | `.pgw`/`.tfw`/`.jgw` sidecar uploaded alongside image | Parses 6 affine parameters → computes corners. |
| 3 | **Explicit corners** | `corners` field in request body | Direct override — for BIM/CAD exports that provide corners separately. |
| 4 | **Center + dimensions** | `centerLon/Lat` + `widthMeters/heightMeters` | Convenience fallback — converts to corners via haversine. |
| 5 | **Uncalibrated** | None of the above | Plan saved with `[0,0]` corners. User calibrates later via `/calibrate`. |

### Real-World Customer Scenarios

| Customer Workflow | File Format | Auto-Extraction |
|-------------------|-------------|-----------------|
| **Surveyor exports from QGIS** | GeoTIFF (`.tif`) | Fully automated — CRS + transform embedded in TIFF tags |
| **Architect exports from AutoCAD** | PNG + World file (`.pgw`) | Automated — world file parsed on upload |
| **BIM coordinator exports from Revit** | Image + JSON corners | Semi-automated — corners passed in API call |
| **Field engineer with a PDF scan** | Plain PNG/JPEG | Manual — user calibrates via `/calibrate` endpoint with 2+ GPS control points |

### Upload Examples

**GeoTIFF (fully automated — no coordinates needed):**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@georeferenced_plan.tif" \
  -F "name=Level 1"
# Server auto-reads CRS + affine transform from TIFF tags
```

**Image + World File sidecar:**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@floor_plan.png" \
  -F "worldfile=@floor_plan.pgw" \
  -F "name=Level 1"
# Server parses .pgw and computes corners automatically
```

**Plain image (uploaded uncalibrated, then calibrated):**
```bash
# Step 1: Upload without coordinates
curl -X POST http://localhost:8080/api/plans \
  -F "image=@scan.png" \
  -F "name=Level 1"
# Returns: { "calibrationMethod": "uncalibrated", "id": "abc123" }

# Step 2: Calibrate with control points (field engineer maps 2+ points)
curl -X POST http://localhost:8080/api/plans/abc123/calibrate \
  -H "Content-Type: application/json" \
  -d '{
    "controlPoints": [
      { "pixel": [0, 0],       "world": [-0.0877, 51.5210] },
      { "pixel": [2000, 1400], "world": [-0.0857, 51.5204] }
    ]
  }'
# Server computes affine transform → derives all 4 corners
```

**Explicit corners (from BIM/CAD metadata):**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@floor_plan.png" \
  -F "name=Level 1" \
  -F 'corners={"topLeft":[-0.0877,51.521],"topRight":[-0.0857,51.521],"bottomRight":[-0.0857,51.5204],"bottomLeft":[-0.0877,51.5204]}'
```

### About PDFs

Standard PDFs from architects contain **no geospatial data** — they are just vectors/rasters. However:
- **GeoPDFs** (OGC standard) embed a coordinate system and transform matrix. These can be parsed with GDAL (`gdalinfo plan.pdf`). Support can be added via a GDAL binding.
- For regular PDFs, the production workflow is: convert to PNG/TIFF → upload with a world file or calibrate manually.

## Running

### Tile Server
```bash
cd tile-server
npm install
npm start        # starts on port 8080
npm run stop     # kills the server
npm run restart  # stop + start
```

### Plan Viewer (React Native)
```bash
cd plan-viewer
npm install
npx expo run:ios    # or npx expo run:android
```

## Features

- **Map + Satellite toggle** — OSM and Esri satellite basemaps
- **Floor plan overlay** — Geo-referenced image overlay with configurable opacity
- **Auto geo-reference extraction** — GeoTIFF, world file, or manual calibration
- **Plan dropdown** — Switch between multiple plans (London, Berlin, Paris)
- **Per-plan persistence** — Pins, areas, measurements saved to device per plan (AsyncStorage)
- **Defect pinning** — Tap to place severity-coded defect markers
- **Area marking** — Draw polygons, auto-calculates area (m²) and perimeter
- **Measurement tool** — Tap two points to measure distance (haversine formula)
- **Zoom-responsive labels** — Text and markers scale with zoom level
- **Manual calibration API** — 2+ control points → affine transform → corners
