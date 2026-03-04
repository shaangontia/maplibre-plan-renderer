# MapLibre 2D Plan Viewer

A mobile app for viewing geo-referenced floor plans on a real-world map with defect pinning, area marking, and measurement tools. Plans are loaded as **GeoPDFs** — the server extracts geo-reference metadata and renders them to PNG automatically.

## Architecture

```
┌─────────────────────────┐       ┌──────────────────────────────┐
│  React Native App        │ HTTP  │  Node.js Tile Server          │
│  (Expo + MapLibre RN)    │◄─────►│  (Express)                    │
│                          │       │                                │
│  plan-viewer/            │       │  tile-server/                  │
│    app/(tabs)/           │       │    index.js        — main API  │
│      index.tsx           │       │    plans.json      — local DB  │
│      plan-viewer/        │       │    plans/images/   — GeoPDFs   │
│        types.ts          │       │    generate-geopdf.js          │
│        constants.ts      │       │                                │
│        geoUtils.ts       │       │  Pipeline:                     │
│        useAnnotations.ts │       │    PDF → extract GEO: metadata │
│        usePlanData.ts    │       │    PDF → render page to PNG    │
│        MapLayers.tsx     │       │    PNG → serve to MapLibre     │
│        ToolBar.tsx       │       │                                │
│        PlanDropdown.tsx  │       │  Endpoints:                    │
│        BottomPanels.tsx  │       │    /style.json                 │
│                          │       │    /plan-info                  │
└─────────────────────────┘       │    /api/plans (CRUD + upload)  │
                                   │    /api/plans/:id/calibrate    │
                                   │    /proxy/osm, /proxy/satellite│
                                   └──────────────────────────────┘
```

## GeoPDF Pipeline

### How It Works

The server loads **geospatial PDFs** — not plain images. Each PDF embeds geo-reference metadata in its Keywords field:

```
GeoPDF Upload → Extract GEO: metadata → Render PDF→PNG → Store corners in DB → Serve to MapLibre
```

On first startup with an empty database, the server scans `plans/images/` for `.pdf` files, extracts their geo-reference metadata, renders them to high-resolution PNGs, and populates `plans.json` automatically.

### GeoPDF Metadata Format

The PDF Keywords field contains semicolon-separated `GEO:` tags:

```
GEO:CRS=EPSG:4326; GEO:TOPLEFT=-0.0874,51.5214; GEO:TOPRIGHT=-0.0854,51.5214;
GEO:BOTTOMRIGHT=-0.0854,51.5208; GEO:BOTTOMLEFT=-0.0874,51.5208;
GEO:FLOOR=Level 1; GEO:BUILDING=Innovation Centre; GEO:SITE=10 Finsbury Square
```

This is extracted using `pdfjs-dist` and the PDF page is rendered to PNG via `node-canvas`.

### Extraction Priority (on upload via POST /api/plans)

| Priority | Method | Trigger | What Happens |
|----------|--------|---------|--------------|
| 1 | **GeoPDF** | `.pdf` upload | Reads `GEO:` metadata from PDF Keywords, renders page to PNG |
| 2 | **GeoTIFF** | `.tif`/`.tiff` upload | Reads affine transform + CRS from TIFF tags. Auto-reprojects to WGS84 |
| 3 | **World File** | `.pgw`/`.tfw`/`.jgw` sidecar | Parses 6 affine parameters → computes corners |
| 4 | **Explicit corners** | `corners` in request body | Direct override — for BIM/CAD exports |
| 5 | **Center + dimensions** | `centerLon/Lat` + `widthMeters/heightMeters` | Convenience fallback |
| 6 | **Uncalibrated** | None of the above | Plan saved with `[0,0]` corners — calibrate later via `/calibrate` |

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

- **GeoPDF loading** — PDFs with embedded geo-reference metadata, auto-rendered to PNG
- **Map + Satellite toggle** — OSM and Esri satellite basemaps
- **Floor plan overlay** — Geo-referenced image overlay with configurable opacity
- **Auto geo-reference extraction** — GeoPDF, GeoTIFF, world file, or manual calibration
- **Plan dropdown** — Switch between multiple plans (London, Berlin, Paris)
- **Per-plan persistence** — Pins, areas, measurements saved to device per plan (AsyncStorage)
- **Defect pinning** — Tap to place severity-coded defect markers
- **Area marking** — Draw polygons, auto-calculates area (m²) and perimeter
- **Measurement tool** — Tap two points to measure distance (haversine formula)
- **Zoom-responsive labels** — Text and markers scale with zoom level
- **Manual calibration API** — 2+ control points → affine transform → corners
- **Modular codebase** — Plan viewer split into types, hooks, and component modules
