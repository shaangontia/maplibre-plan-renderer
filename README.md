# MapLibre 2D Plan Viewer

A mobile app for viewing geo-referenced floor plans on a real-world map with automatic room detection, defect pinning, area marking, measurement tools, and annotation export/import. Plans are loaded as **GeoPDFs** — the server extracts geo-reference metadata, renders PNGs, and serves them to MapLibre for overlay.

## Architecture

```
┌──────────────────────────────┐       ┌───────────────────────────────────┐
│  React Native App             │ HTTP  │  Node.js Tile Server (TypeScript)  │
│  (Expo + MapLibre GL RN)      │◄─────►│  (Express)                         │
│                                │       │                                     │
│  plan-viewer/                  │       │  tile-server/                       │
│    app/                        │       │    src/                             │
│      _layout.tsx               │       │      index.ts         — entry point │
│      (tabs)/                   │       │      app.ts           — Express app │
│        _layout.tsx             │       │      config/index.ts  — constants   │
│        index.tsx  — main screen│       │      types/index.ts   — interfaces  │
│        plan-viewer/            │       │      db/plans.ts      — JSON store  │
│          types.ts              │       │      middleware/       — multer      │
│          constants.ts          │       │      routes/                        │
│          geoUtils.ts           │       │        plans.ts  — CRUD + detect   │
│          useAnnotations.ts     │       │        tiles.ts  — proxy + styles  │
│          usePlanData.ts        │       │      services/                      │
│          useDetectAreas.ts     │       │        geo-extract.ts — GeoTIFF/PDF│
│          useExportImport.ts    │       │        geo-utils.ts   — transforms │
│          useOrientation.ts     │       │        pdf-render.ts  — PDF → PNG  │
│          useUserLocation.ts    │       │        area-detect.ts — room detect│
│          MapLayers.tsx         │       │        seed.ts         — auto-seed │
│          ToolBar.tsx           │       │                                     │
│          PlanDropdown.tsx      │       │    plans.json          — local DB   │
│          BottomPanels.tsx      │       │    plans/images/       — files      │
│                                │       │    dist/               — compiled JS│
└──────────────────────────────┘       └───────────────────────────────────┘
```

## Tile Server

### TypeScript Project Structure

The server is a modular TypeScript project under `tile-server/src/`:

| Module | Path | Responsibility |
|--------|------|----------------|
| **Entry** | `index.ts` | Server bootstrap, GeoPDF seeding on first run |
| **App** | `app.ts` | Express setup, CORS, route mounting |
| **Config** | `config/index.ts` | PORT, file paths, upload limits, detection constants |
| **Types** | `types/index.ts` | Shared interfaces: `Plan`, `Corners`, `Bounds`, `DetectedArea`, etc. |
| **Database** | `db/plans.ts` | `readDb`, `writeDb`, `getBounds`, `getCenter` (JSON file store) |
| **Upload** | `middleware/upload.ts` | Multer disk storage, file type filtering, size limits |
| **Plan Routes** | `routes/plans.ts` | CRUD, image serving, detect-areas, calibrate |
| **Tile Routes** | `routes/tiles.ts` | OSM/satellite proxy, dynamic `style.json`, fonts, plan-info, health |
| **Geo Extract** | `services/geo-extract.ts` | GeoTIFF corners, GeoPDF corners, auto-extract pipeline |
| **Geo Utils** | `services/geo-utils.ts` | World file parsing, `metersToCorners`, `pixelToGeo` (bilinear interpolation) |
| **PDF Render** | `services/pdf-render.ts` | PDF → PNG rendering via `pdfjs-dist` + `node-canvas` |
| **Area Detect** | `services/area-detect.ts` | Flood-fill + grid detection, NMS, full room detection pipeline |
| **Seed** | `services/seed.ts` | Scan `plans/images/` for GeoPDFs, auto-populate DB on first run |

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/plans` | List all plans with center + bounds |
| `GET` | `/api/plans/:id` | Get single plan details |
| `POST` | `/api/plans` | Upload plan (PDF/image + optional worldfile) |
| `PUT` | `/api/plans/:id` | Update plan metadata or replace image |
| `DELETE` | `/api/plans/:id` | Delete plan and image file |
| `GET` | `/api/plans/:id/image` | Serve rendered plan image (PNG) |
| `GET` | `/api/plans/:id/detect-areas` | Auto-detect rooms in floor plan |
| `POST` | `/api/plans/:id/calibrate` | Calibrate with 2+ control points (affine transform) |
| `GET` | `/style.json?mode=normal\|satellite\|canvas` | Dynamic MapLibre style with basemap + plan layers |
| `GET` | `/plan-info` | All plans with bounds (for initial map positioning) |
| `GET` | `/proxy/osm/:z/:x/:y.png` | OpenStreetMap tile proxy |
| `GET` | `/proxy/satellite/:z/:x/:y` | Esri World Imagery tile proxy |
| `GET` | `/fonts/:fontstack/:range.pbf` | Empty glyph PBFs (MapLibre requirement) |
| `GET` | `/health` | Health check with plan count |

### Geo-Reference Extraction Priority

When a plan is uploaded via `POST /api/plans`, the server tries these methods in order:

| Priority | Method | Trigger | What Happens |
|----------|--------|---------|--------------|
| 1 | **GeoPDF** | `.pdf` upload | Reads `GEO:` metadata from PDF Keywords, renders companion PNG via `pdfjs-dist` |
| 2 | **GeoTIFF** | `.tif`/`.tiff` upload | Reads affine transform + CRS from TIFF tags, auto-reprojects to WGS84 via `proj4` |
| 3 | **World File** | `.pgw`/`.tfw`/`.jgw` sidecar | Parses 6 affine parameters → computes corners |
| 4 | **Explicit corners** | `corners` in request body | Direct JSON override — for BIM/CAD exports |
| 5 | **Center + dimensions** | `centerLon/Lat` + `widthMeters/heightMeters` | Convenience fallback with optional rotation |
| 6 | **Uncalibrated** | None of the above | Saved with `[0,0]` corners — calibrate later via `/calibrate` |

### Automatic Room Detection

The `/api/plans/:id/detect-areas` endpoint runs a two-strategy image processing pipeline:

1. **Downscale** — Resize plan image to 1000x744 greyscale using `sharp`
2. **Flood-fill detection** — Dilate wall pixels to seal doorway gaps, flood-fill from borders to mark "outside", label enclosed connected components as candidate rooms
3. **Grid/projection detection** — Build horizontal + vertical projection profiles of dark pixels, find wall bands, intersect to form a grid of candidate cells
4. **Merge** — Combine candidates from both strategies
5. **Non-maximum suppression** — Remove overlapping boxes (IoU > 0.25)
6. **Container removal** — Discard large boxes that are >50% covered by smaller detected rooms
7. **Geo-mapping** — Convert pixel bounding boxes to geo-coordinates via bilinear interpolation against the plan's corner coordinates

### GeoPDF Metadata Format

The PDF Keywords field contains semicolon-separated `GEO:` tags:

```
GEO:CRS=EPSG:4326; GEO:TOPLEFT=-0.0874,51.5214; GEO:TOPRIGHT=-0.0854,51.5214;
GEO:BOTTOMRIGHT=-0.0854,51.5208; GEO:BOTTOMLEFT=-0.0874,51.5208;
GEO:FLOOR=Level 1; GEO:BUILDING=Innovation Centre; GEO:SITE=10 Finsbury Square
```

### Upload Examples

**GeoPDF (fully automated — name extracted from PDF metadata):**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@london_plan.pdf"
```

**GeoTIFF:**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@georeferenced_plan.tif" \
  -F "name=Level 1"
```

**Image + World File sidecar:**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@floor_plan.png" \
  -F "worldfile=@floor_plan.pgw" \
  -F "name=Level 1"
```

**Manual calibration (2+ control points):**
```bash
curl -X POST http://localhost:8080/api/plans/abc123/calibrate \
  -H "Content-Type: application/json" \
  -d '{
    "controlPoints": [
      { "pixel": [0, 0],       "world": [-0.0877, 51.5210] },
      { "pixel": [2000, 1400], "world": [-0.0857, 51.5204] }
    ]
  }'
```

## Plan Viewer (React Native)

### View Modes

- **Map** — OpenStreetMap basemap + floor plan overlay
- **Satellite** — Esri satellite basemap + floor plan overlay
- **Canvas** — Floor plan only (no basemap, white background)

### Modular Architecture

The app is split into focused modules under `plan-viewer/app/(tabs)/plan-viewer/`:

| Module | Purpose |
|--------|---------|
| `types.ts` | All TypeScript interfaces and type aliases |
| `constants.ts` | Server URL, severity colors, tool modes, polygon colors, style URL builder |
| `geoUtils.ts` | Haversine distance, polygon area (m²), formatting, centroid, uid generation |
| `useAnnotations.ts` | Hook: annotation state (pins, polygons, measurements) + AsyncStorage persistence per plan |
| `usePlanData.ts` | Hook: fetches plan list from server, manages active plan selection |
| `useDetectAreas.ts` | Hook: triggers server-side room detection, computes area (m²) per room, assigns colors |
| `useExportImport.ts` | Hook: export/import annotations as JSON (web download / mobile share sheet) |
| `useOrientation.ts` | Hook: tracks device orientation changes, detects tablet (shortest edge >= 600px) |
| `useUserLocation.ts` | Hook: GPS location tracking with permission handling |
| `MapLayers.tsx` | MapLibreGL ShapeSource + Layer components for pins, polygons, measurements, detected areas |
| `ToolBar.tsx` | Tool mode selector, severity dots, drawing bar (horizontal scroll on tablet/landscape) |
| `PlanDropdown.tsx` | Plan selector dropdown with modal, compact mode for tablets |
| `BottomPanels.tsx` | Defect info bar, polygon list, measurement list |

The main `index.tsx` composes these into the primary screen with responsive layout for both phone and tablet in portrait/landscape orientations.

### Export/Import Annotations

**Export:**
- Tap Export in header
- Downloads JSON file with plan metadata and all annotations
- Format: `{ version, exportedAt, planId, planName, annotations: { defects, polygons, measurements } }`

**Import:**
- Tap Import in header
- Select previously exported JSON file
- Shows preview: pin count, area count, measurement count, source plan, export timestamp
- Replaces current annotations with imported data
- Works on both iOS (share sheet) and web (file picker)

## Running

### Generate GeoPDFs (first time)
```bash
cd tile-server
npm install
node generate-geopdf.js   # creates GeoPDFs in plans/images/
```

### Tile Server
```bash
cd tile-server
npm install
npm run dev      # development with hot-reload (tsx watch)
npm run build    # compile TypeScript to dist/
npm start        # production (node dist/index.js)
npm run stop     # kill the server on port 8080
npm run restart  # stop + dev
```

The server auto-seeds from GeoPDFs in `plans/images/` on first run (empty `plans.json`).

### Plan Viewer (React Native)
```bash
cd plan-viewer
npm install
npx expo run:ios    # or npx expo run:android
```

## Tech Stack

### Tile Server
- **Runtime** — Node.js + TypeScript
- **Framework** — Express 5
- **Image processing** — sharp (resize, greyscale, raw buffer)
- **PDF rendering** — pdfjs-dist + node-canvas
- **Geo-spatial** — geotiff, proj4
- **File uploads** — multer

### Plan Viewer
- **Framework** — React Native (Expo)
- **Map** — MapLibre GL Native via `@maplibre/maplibre-react-native`
- **Navigation** — Expo Router (file-based)
- **Storage** — AsyncStorage (per-plan annotation persistence)
- **Orientation** — expo-screen-orientation

## Features

- **GeoPDF loading** — PDFs with embedded geo-reference metadata, auto-rendered to PNG
- **Three view modes** — Map (OSM), Satellite (Esri), Canvas (plan-only)
- **Floor plan overlay** — Geo-referenced image overlay with configurable opacity
- **Auto geo-reference extraction** — GeoPDF, GeoTIFF, world file, explicit corners, or center+dimensions
- **Automatic room detection** — Flood-fill + grid projection dual-strategy with NMS merging
- **Plan selector** — Switch between multiple uploaded plans
- **Per-plan persistence** — Pins, areas, measurements saved to device per plan
- **Export/Import annotations** — JSON export/import of all annotation data
- **Defect pinning** — Tap to place severity-coded defect markers
- **Area marking** — Draw polygons, auto-calculates area (m²) and perimeter
- **Measurement tool** — Tap two points to measure distance (haversine formula)
- **Zoom-responsive labels** — Text and markers scale with zoom level
- **Manual calibration API** — 2+ control points → affine transform → geo-referenced corners
- **Tablet support** — Responsive layout adapts to phone/tablet in portrait and landscape
- **User location** — GPS tracking with permission handling
- **Modular TypeScript codebase** — Server and client both use TypeScript with separated concerns
