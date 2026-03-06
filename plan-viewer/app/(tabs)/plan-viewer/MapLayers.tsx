import MapLibreGL from "@maplibre/maplibre-react-native";
import type { FeatureCollection, Point, Polygon, LineString } from "geojson";
import React, { useMemo } from "react";
import type { Defect, AreaPolygon, Measurement, Coord } from "./types";
import type { DetectedArea } from "./useDetectAreas";
import type { UserLocation } from "./useUserLocation";
import { SEVERITY_COLORS } from "./constants";
import {
  formatArea,
  formatDistance,
  centroid,
  midpoint,
  perimeterDistance,
} from "./geoUtils";

interface MapLayersProps {
  defects: Defect[];
  polygons: AreaPolygon[];
  measurements: Measurement[];
  drawingCoords: Coord[];
  measureStart: Coord | null;
  detectedAreas: DetectedArea[];
  userLocation: UserLocation | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onPinPress: (e: any) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onClusterPress?: (e: any) => void;
}

export default function MapLayers({
  defects,
  polygons,
  measurements,
  drawingCoords,
  measureStart,
  detectedAreas,
  userLocation,
  onPinPress,
  onClusterPress,
}: MapLayersProps) {
  // ------ GeoJSON: user location dot ------
  const userLocationGeoJSON = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: userLocation
        ? [
            {
              type: "Feature" as const,
              id: "user-location",
              properties: {
                accuracy: userLocation.accuracy ?? 8,
                heading: userLocation.heading ?? 0,
                hasHeading: userLocation.heading != null ? 1 : 0,
              },
              geometry: {
                type: "Point" as const,
                coordinates: [userLocation.longitude, userLocation.latitude],
              },
            },
          ]
        : [],
    }),
    [userLocation]
  );

  // ------ GeoJSON: defect pins ------
  const defectsGeoJSON = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: defects.map((d) => ({
        type: "Feature" as const,
        id: d.id,
        properties: {
          label: d.label,
          severity: d.severity,
          color: SEVERITY_COLORS[d.severity],
          defectId: d.id,
        },
        geometry: { type: "Point" as const, coordinates: [d.longitude, d.latitude] },
      })),
    }),
    [defects]
  );

  // ------ GeoJSON: detected areas (auto-detected rooms) ------
  const detectedGeoJSON = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: detectedAreas.map((a) => ({
        type: "Feature" as const,
        id: a.id,
        properties: { color: a.color, label: a.label },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[...a.coords, a.coords[0]]],
        },
      })),
    }),
    [detectedAreas]
  );

  const detectedLabelsGeoJSON = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: detectedAreas.map((a) => {
        const c = centroid(a.coords);
        return {
          type: "Feature" as const,
          id: `dlabel-${a.id}`,
          properties: { label: `${a.label}\n${formatArea(a.areaSqM)}` },
          geometry: { type: "Point" as const, coordinates: c },
        };
      }),
    }),
    [detectedAreas]
  );

  // ------ GeoJSON: completed polygons ------
  const polygonsGeoJSON = useMemo<FeatureCollection<Polygon>>(
    () => ({
      type: "FeatureCollection",
      features: polygons.map((p) => ({
        type: "Feature" as const,
        id: p.id,
        properties: {
          color: p.color,
          label: p.label,
          area: formatArea(p.areaSqM),
          polygonId: p.id,
        },
        geometry: {
          type: "Polygon" as const,
          coordinates: [[...p.coords, p.coords[0]]],
        },
      })),
    }),
    [polygons]
  );

  // ------ GeoJSON: polygon area labels (centroids) ------
  const polygonLabelsGeoJSON = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: polygons.map((p) => {
        const c = centroid(p.coords);
        return {
          type: "Feature" as const,
          id: `label-${p.id}`,
          properties: {
            label: `${p.label}\n${formatArea(p.areaSqM)}\nPerimeter: ${formatDistance(perimeterDistance(p.coords))}`,
          },
          geometry: { type: "Point" as const, coordinates: c },
        };
      }),
    }),
    [polygons]
  );

  // ------ GeoJSON: drawing-in-progress polygon outline ------
  const drawingGeoJSON = useMemo<FeatureCollection<LineString | Point>>(
    () => ({
      type: "FeatureCollection",
      features: [
        ...(drawingCoords.length >= 2
          ? [
              {
                type: "Feature" as const,
                id: "drawing-line",
                properties: {},
                geometry: {
                  type: "LineString" as const,
                  coordinates: drawingCoords,
                },
              },
            ]
          : []),
        ...drawingCoords.map((c, i) => ({
          type: "Feature" as const,
          id: `drawing-pt-${i}`,
          properties: { index: i },
          geometry: { type: "Point" as const, coordinates: c },
        })),
      ],
    }),
    [drawingCoords]
  );

  // ------ GeoJSON: measurements (lines + labels) ------
  const measureLinesGeoJSON = useMemo<FeatureCollection<LineString>>(
    () => ({
      type: "FeatureCollection",
      features: measurements.map((m) => ({
        type: "Feature" as const,
        id: m.id,
        properties: { dist: formatDistance(m.distanceM), measureId: m.id },
        geometry: { type: "LineString" as const, coordinates: [m.from, m.to] },
      })),
    }),
    [measurements]
  );

  const measureLabelsGeoJSON = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: measurements.map((m) => {
        const mid = midpoint(m.from, m.to);
        return {
          type: "Feature" as const,
          id: `ml-${m.id}`,
          properties: { label: formatDistance(m.distanceM) },
          geometry: { type: "Point" as const, coordinates: mid },
        };
      }),
    }),
    [measurements]
  );

  // ------ GeoJSON: measure start point (pending) ------
  const measurePendingGeoJSON = useMemo<FeatureCollection<Point | LineString>>(
    () => ({
      type: "FeatureCollection",
      features: measureStart
        ? [
            {
              type: "Feature" as const,
              id: "measure-start",
              properties: {},
              geometry: { type: "Point" as const, coordinates: measureStart },
            },
          ]
        : [],
    }),
    [measureStart]
  );

  return (
    <>
      {/* Detected areas — teal dashed outline + light fill */}
      <MapLibreGL.ShapeSource id="detected-areas" shape={detectedGeoJSON}>
        <MapLibreGL.FillLayer
          id="detected-areas-fill"
          style={{
            fillColor: ["get", "color"],
            fillOpacity: 0.12,
          }}
        />
        <MapLibreGL.LineLayer
          id="detected-areas-outline"
          style={{
            lineColor: ["get", "color"],
            lineWidth: 2,
            lineDasharray: [3, 2],
            lineOpacity: 0.85,
          }}
        />
      </MapLibreGL.ShapeSource>

      <MapLibreGL.ShapeSource id="detected-labels" shape={detectedLabelsGeoJSON}>
        <MapLibreGL.SymbolLayer
          id="detected-labels-layer"
          minZoomLevel={15}
          style={{
            textField: ["get", "label"],
            textSize: [
              "interpolate", ["linear"], ["zoom"],
              15, 8,
              17, 10,
              18, 12,
              20, 14,
            ],
            textColor: "#006064",
            textHaloColor: "#ffffff",
            textHaloWidth: 1.5,
            textAllowOverlap: true,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Completed polygons — fill + outline */}
      <MapLibreGL.ShapeSource id="polygons-fill" shape={polygonsGeoJSON}>
        <MapLibreGL.FillLayer
          id="polygons-fill-layer"
          style={{
            fillColor: ["get", "color"],
            fillOpacity: 0.2,
          }}
        />
        <MapLibreGL.LineLayer
          id="polygons-outline-layer"
          style={{
            lineColor: ["get", "color"],
            lineWidth: [
              "interpolate", ["linear"], ["zoom"],
              14, 1,
              17, 2,
              20, 3,
            ],
            lineOpacity: 0.9,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Polygon labels — zoom-responsive text size */}
      <MapLibreGL.ShapeSource id="polygon-labels" shape={polygonLabelsGeoJSON}>
        <MapLibreGL.SymbolLayer
          id="polygon-labels-layer"
          minZoomLevel={15}
          style={{
            textField: ["get", "label"],
            textSize: [
              "interpolate", ["linear"], ["zoom"],
              15, 8,
              17, 10,
              18, 12,
              20, 14,
              22, 16,
            ],
            textColor: "#1a1a1a",
            textHaloColor: "#ffffff",
            textHaloWidth: 1.5,
            textAllowOverlap: true,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Drawing-in-progress */}
      <MapLibreGL.ShapeSource id="drawing" shape={drawingGeoJSON}>
        <MapLibreGL.LineLayer
          id="drawing-line-layer"
          style={{
            lineColor: "#FF5722",
            lineWidth: 2,
            lineDasharray: [4, 3],
          }}
        />
        <MapLibreGL.CircleLayer
          id="drawing-points-layer"
          style={{
            circleRadius: [
              "interpolate", ["linear"], ["zoom"],
              14, 3,
              18, 6,
              22, 10,
            ],
            circleColor: "#FF5722",
            circleStrokeColor: "#fff",
            circleStrokeWidth: 2,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Measurement lines */}
      <MapLibreGL.ShapeSource id="measure-lines" shape={measureLinesGeoJSON}>
        <MapLibreGL.LineLayer
          id="measure-lines-layer"
          style={{
            lineColor: "#E91E63",
            lineWidth: [
              "interpolate", ["linear"], ["zoom"],
              14, 1.5,
              18, 2.5,
              22, 4,
            ],
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Measurement labels — zoom-responsive */}
      <MapLibreGL.ShapeSource id="measure-labels" shape={measureLabelsGeoJSON}>
        <MapLibreGL.SymbolLayer
          id="measure-labels-layer"
          minZoomLevel={15}
          style={{
            textField: ["get", "label"],
            textSize: [
              "interpolate", ["linear"], ["zoom"],
              15, 9,
              17, 11,
              18, 13,
              20, 15,
            ],
            textColor: "#E91E63",
            textHaloColor: "#ffffff",
            textHaloWidth: 2,
            textAllowOverlap: true,
            textOffset: [0, -1],
            textFont: ["Open Sans Regular"],
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Measure start pending point */}
      <MapLibreGL.ShapeSource id="measure-pending" shape={measurePendingGeoJSON}>
        <MapLibreGL.CircleLayer
          id="measure-pending-layer"
          style={{
            circleRadius: [
              "interpolate", ["linear"], ["zoom"],
              14, 4,
              18, 7,
              22, 11,
            ],
            circleColor: "#E91E63",
            circleStrokeColor: "#fff",
            circleStrokeWidth: 2,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* User location — blue dot with accuracy halo */}
      <MapLibreGL.ShapeSource id="user-location" shape={userLocationGeoJSON}>
        {/* Accuracy halo */}
        <MapLibreGL.CircleLayer
          id="user-location-halo"
          style={{
            circleRadius: 16,
            circleColor: "#2979FF",
            circleOpacity: 0.18,
            circleStrokeColor: "#2979FF",
            circleStrokeWidth: 1,
            circleStrokeOpacity: 0.35,
          }}
        />
        {/* White outline ring */}
        <MapLibreGL.CircleLayer
          id="user-location-outline"
          style={{
            circleRadius: 10,
            circleColor: "#ffffff",
            circleOpacity: 1,
          }}
        />
        {/* Blue dot */}
        <MapLibreGL.CircleLayer
          id="user-location-dot"
          style={{
            circleRadius: 7,
            circleColor: "#2979FF",
            circleOpacity: 1,
          }}
        />
      </MapLibreGL.ShapeSource>

      {/* Defect pins — clustered on zoom out, individual pins on zoom in */}
      <MapLibreGL.ShapeSource
        id="defects"
        shape={defectsGeoJSON}
        onPress={(e) => {
          // Route to cluster handler or pin handler based on feature type
          const f = e?.features?.[0];
          if (f?.properties?.cluster) {
            onClusterPress?.(e);
          } else {
            onPinPress(e);
          }
        }}
        cluster
        clusterRadius={40}
        clusterMaxZoomLevel={17}
        clusterProperties={{
          // Accumulate severities so we can color the cluster bubble
          hasCritical: ["+", ["case", ["==", ["get", "severity"], "critical"], 1, 0]],
          hasHigh:     ["+", ["case", ["==", ["get", "severity"], "high"],     1, 0]],
        }}
      >
        {/* Cluster bubble — size + color scale with count */}
        <MapLibreGL.CircleLayer
          id="clusters-circle"
          belowLayerID="defects-circle"
          filter={["has", "point_count"]}
          style={{
            circleRadius: [
              "step", ["get", "point_count"],
              16,  2,
              20,  5,
              26, 10,
              32,
            ],
            circleColor: [
              "case",
              [">", ["get", "hasCritical"], 0], "#E53935",
              [">", ["get", "hasHigh"],     0], "#FF6F00",
              "#1565C0",
            ],
            circleOpacity: 0.92,
            circleStrokeColor: "#ffffff",
            circleStrokeWidth: 2.5,
          }}
        />

        {/* Cluster count label — shown centred on every cluster bubble */}
        <MapLibreGL.SymbolLayer
          id="clusters-count"
          aboveLayerID="clusters-circle"
          filter={["has", "point_count"]}
          style={{
            textField: ["to-string", ["get", "point_count"]],
            textSize: 14,
            textColor: "#ffffff",
            textHaloColor: "rgba(0,0,0,0.4)",
            textHaloWidth: 1.5,
            textAllowOverlap: true,
            textIgnorePlacement: true,
            textAnchor: "center",
            textMaxWidth: 100,
          }}
        />

        {/* Individual pin — only shown for unclustered points */}
        <MapLibreGL.CircleLayer
          id="defects-circle"
          filter={["!", ["has", "point_count"]]}
          style={{
            circleRadius: [
              "interpolate", ["linear"], ["zoom"],
              14, 4,
              17, 6,
              19, 8,
              22, 12,
            ],
            circleColor: ["get", "color"],
            circleStrokeColor: "#ffffff",
            circleStrokeWidth: 2.5,
            circleOpacity: 0.95,
          }}
        />
      </MapLibreGL.ShapeSource>
    </>
  );
}
