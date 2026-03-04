# MapLibre 2D Plan Viewer

A mobile app for viewing geo-referenced floor plans on a real-world map with defect pinning, area marking, measurement tools, and annotation export/import. Plans are loaded as **GeoPDFs** — the server extracts geo-reference metadata and serves pre-rendered PNGs for optimal quality.

## Architecture

```
┌─────────────────────────┐       ┌──────────────────────────────┐
│  React Native App        │ HTTP  │  Node.js Tile Server          │
│  (Expo + MapLibre RN)    │◄─────►│  (Express)                    │
│                          │       │                                │
│  plan-viewer/            │       │  tile-server/                  │
│    app/(tabs)/           │       │    index.js        — main API  │
│      index.tsx           │       │    plans.json      — local DB  │
│      plan-viewer/        │       │    plans/images/   — GeoPDFs+PNGs│
│        types.ts          │       │    generate-geopdf.js          │
│        constants.ts      │       │                                │
│        geoUtils.ts       │       │  Pipeline:                     │
│        useAnnotations.ts │       │    Canvas → PNG (pixel-perfect)│
│        usePlanData.ts    │       │    PNG → embed into PDF        │
│        useExportImport.ts│       │    PDF → extract GEO: metadata │
│        MapLayers.tsx     │       │    PNG → serve to MapLibre     │
│        ToolBar.tsx       │       │                                │
│        PlanDropdown.tsx  │       │  Endpoints:                    │
│        BottomPanels.tsx  │       │    /style.json?mode=canvas     │
│                          │       │    /plan-info                  │
└─────────────────────────┘       │    /api/plans (CRUD + upload)  │
                                   │    /api/plans/:id/calibrate    │
                                   │    /proxy/osm, /proxy/satellite│
                                   └──────────────────────────────┘
```

## GeoPDF Pipeline

### How It Works

The server generates **high-quality GeoPDFs** with pixel-perfect rendering. The pipeline uses node-canvas for detailed architectural drawing, then embeds the PNG into a PDF with geo-reference metadata:

```
Canvas 2D API → PNG (pixel-perfect) → Embed in PDFKit PDF with GEO: metadata → Store both files
```

On startup, the server scans `plans/images/` for `.pdf` files, extracts geo-reference metadata from the PDF Keywords, and serves the pre-rendered companion PNG to MapLibre for optimal quality.

### GeoPDF Metadata Format

The PDF Keywords field contains semicolon-separated `GEO:` tags:

```
GEO:CRS=EPSG:4326; GEO:TOPLEFT=-0.0874,51.5214; GEO:TOPRIGHT=-0.0854,51.5214;
GEO:BOTTOMRIGHT=-0.0854,51.5208; GEO:BOTTOMLEFT=-0.0874,51.5208;
GEO:FLOOR=Level 1; GEO:BUILDING=Innovation Centre; GEO:SITE=10 Finsbury Square
```

### Canvas Mode

The app supports three view modes:
- **Map** — OpenStreetMap basemap + floor plan overlay
- **Satellite** — Esri satellite basemap + floor plan overlay  
- **Canvas** — Floor plan only (no basemap)

Canvas mode (`/style.json?mode=canvas`) skips basemap tiles entirely, showing only the geo-referenced floor plans.

### Extraction Priority (on upload via POST /api/plans)

| Priority | Method | Trigger | What Happens |
|----------|--------|---------|--------------|
| 1 | **GeoPDF** | `.pdf` upload | Reads `GEO:` metadata from PDF Keywords, prefers companion PNG, falls back to pdfjs-dist rendering |
| 2 | **GeoTIFF** | `.tif`/`.tiff` upload | Reads affine transform + CRS from TIFF tags. Auto-reprojects to WGS84 |
| 3 | **World File** | `.pgw`/`.tfw`/`.jgw` sidecar | Parses 6 affine parameters → computes corners |
| 4 | **Explicit corners** | `corners` in request body | Direct override — for BIM/CAD exports |
| 5 | **Center + dimensions** | `centerLon/Lat` + `widthMeters/heightMeters` | Convenience fallback |
| 6 | **Uncalibrated** | None of the above | Plan saved with `[0,0]` corners — calibrate later via `/calibrate` |

### Export/Import Annotations

The app supports exporting and importing all annotations (pins, areas, measurements) as JSON:

**Export:**
- Tap **📤 Export** in header
- Downloads JSON file with plan metadata and all annotations
- Format: `{ version, exportedAt, planId, planName, annotations: { defects, polygons, measurements } }`

**Import:**
- Tap **📥 Import** in header  
- Select previously exported JSON file
- Shows preview: pin count, area count, measurement count, source plan, export timestamp
- Replaces current annotations with imported data
- Works on both iOS (share sheet) and web (file picker)

### Upload Examples

**GeoPDF (fully automated — name extracted from PDF metadata):**
```bash
curl -X POST http://localhost:8080/api/plans \
  -F "image=@london_plan.pdf"
# Server reads GEO: metadata, renders to PNG, extracts name/floor/site
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

## Plan Viewer — Modular Architecture

The React Native app is split into focused modules under `app/(tabs)/plan-viewer/`:

| Module | Purpose |
|--------|---------|
| `types.ts` | All TypeScript interfaces and type aliases |
| `constants.ts` | Server URL, severity colors, tool modes, polygon colors |
| `geoUtils.ts` | Haversine distance, polygon area, formatting, centroid, uid |
| `useAnnotations.ts` | Hook: annotation state + AsyncStorage persistence per plan |
| `usePlanData.ts` | Hook: fetches plan data from server, manages active plan |
| `useExportImport.ts` | Hook: export/import annotations as JSON (web download, mobile share) |
| `MapLayers.tsx` | All MapLibreGL ShapeSource + Layer components (GeoJSON) |
| `ToolBar.tsx` | Tool mode selector, severity dots, drawing bar |
| `PlanDropdown.tsx` | Plan selector dropdown with modal |
| `BottomPanels.tsx` | Defect info bar, polygon list, measurement list |

The main `index.tsx` composes these into a ~300-line screen component.

## Running

### Generate GeoPDFs (first time)
```bash
cd tile-server
npm install
node generate-geopdf.js   # creates 3 GeoPDFs in plans/images/
```

### Tile Server
```bash
cd tile-server
npm start        # seeds from GeoPDFs on first run, starts on port 8080
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

- **GeoPDF loading** — PDFs with embedded geo-reference metadata, pixel-perfect Canvas rendering
- **Three view modes** — Map (OSM), Satellite (Esri), Canvas (plan-only, no basemap)
- **Floor plan overlay** — Geo-referenced image overlay with configurable opacity
- **Auto geo-reference extraction** — GeoPDF, GeoTIFF, world file, or manual calibration
- **Plan dropdown** — Switch between multiple plans (London, Berlin, Paris)
- **Per-plan persistence** — Pins, areas, measurements saved to device per plan (AsyncStorage)
- **Export/Import annotations** — JSON export/import of all pins, areas, and measurements
- **Defect pinning** — Tap to place severity-coded defect markers
- **Area marking** — Draw polygons, auto-calculates area (m²) and perimeter
- **Measurement tool** — Tap two points to measure distance (haversine formula)
- **Zoom-responsive labels** — Text and markers scale with zoom level
- **Manual calibration API** — 2+ control points → affine transform → corners
- **Modular codebase** — Plan viewer split into types, hooks, and component modules
