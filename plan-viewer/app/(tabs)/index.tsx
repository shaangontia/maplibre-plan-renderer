import MapLibreGL from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, Point, Polygon, LineString } from "geojson";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Severity = "low" | "medium" | "high" | "critical";
type MapMode = "normal" | "satellite";
type ToolMode = "pin" | "polygon" | "measure";

interface PlanInfo {
  id: string;
  name: string;
  center: [number, number];
  bounds: { sw: [number, number]; ne: [number, number] };
  opacity: number;
}

interface PlanInfoResponse {
  plans: PlanInfo[];
  center: [number, number];
  bounds: { sw: [number, number]; ne: [number, number] };
  zoom: number;
}

interface Defect {
  id: string;
  longitude: number;
  latitude: number;
  label: string;
  severity: Severity;
  createdAt: number;
}

type Coord = [number, number]; // [lon, lat]

interface AreaPolygon {
  id: string;
  coords: Coord[];
  label: string;
  areaSqM: number;
  color: string;
}

interface Measurement {
  id: string;
  from: Coord;
  to: Coord;
  distanceM: number;
}

// ---------------------------------------------------------------------------
// Geo utilities
// ---------------------------------------------------------------------------
const DEG2RAD = Math.PI / 180;

function haversineDistance(a: Coord, b: Coord): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const R = 6371000;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function polygonAreaSqM(coords: Coord[]): number {
  if (coords.length < 3) return 0;
  const R = 6371000;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[j];
    total +=
      (lon2 - lon1) * DEG2RAD * (2 + Math.sin(lat1 * DEG2RAD) + Math.sin(lat2 * DEG2RAD));
  }
  return Math.abs((total * R * R) / 2);
}

function formatDistance(m: number): string {
  if (m < 1) return `${(m * 100).toFixed(0)} cm`;
  if (m < 1000) return `${m.toFixed(2)} m`;
  return `${(m / 1000).toFixed(3)} km`;
}

function formatArea(sqm: number): string {
  if (sqm < 1) return `${(sqm * 10000).toFixed(0)} cm\u00B2`;
  if (sqm < 10000) return `${sqm.toFixed(2)} m\u00B2`;
  return `${(sqm / 10000).toFixed(3)} ha`;
}

function centroid(coords: Coord[]): Coord {
  let lon = 0;
  let lat = 0;
  for (const c of coords) {
    lon += c[0];
    lat += c[1];
  }
  return [lon / coords.length, lat / coords.length];
}

function midpoint(a: Coord, b: Coord): Coord {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function perimeterDistance(coords: Coord[]): number {
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    total += haversineDistance(coords[i], coords[(i + 1) % coords.length]);
  }
  return total;
}

const POLYGON_COLORS = [
  "#2196F3",
  "#E91E63",
  "#00BCD4",
  "#FF5722",
  "#8BC34A",
  "#673AB7",
  "#FFC107",
  "#009688",
];

let _uid = 0;
function uid(): string {
  return `${Date.now()}-${++_uid}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TILE_SERVER =
  Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://localhost:8080";

const SEVERITY_COLORS: Record<Severity, string> = {
  low: "#4CAF50",
  medium: "#FF9800",
  high: "#F44336",
  critical: "#9C27B0",
};

const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

const TOOL_MODES: { key: ToolMode; label: string; icon: string }[] = [
  { key: "pin", label: "Pin", icon: "\uD83D\uDCCC" },
  { key: "polygon", label: "Area", icon: "\u2B1F" },
  { key: "measure", label: "Measure", icon: "\uD83D\uDCCF" },
];

const DEFAULT_CENTER: [number, number] = [0, 0];

const getStyleUrl = (mode: MapMode) =>
  `${TILE_SERVER}/style.json?mode=${mode}`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PlanViewerScreen() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);

  // Server-fetched plan data
  const [planData, setPlanData] = useState<PlanInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  // Tool state
  const [toolMode, setToolMode] = useState<ToolMode>("pin");

  // Pin state
  const [defects, setDefects] = useState<Defect[]>([]);
  const [selectedSeverity, setSelectedSeverity] = useState<Severity>("medium");
  const [selectedDefect, setSelectedDefect] = useState<Defect | null>(null);

  // Polygon state
  const [polygons, setPolygons] = useState<AreaPolygon[]>([]);
  const [drawingCoords, setDrawingCoords] = useState<Coord[]>([]);

  // Measurement state
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [measureStart, setMeasureStart] = useState<Coord | null>(null);

  const [mapMode, setMapMode] = useState<MapMode>("normal");

  // Fetch plan info from server
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${TILE_SERVER}/plan-info`);
        const data: PlanInfoResponse = await resp.json();
        setPlanData(data);
        if (data.plans.length > 0) setActivePlanId(data.plans[0].id);
      } catch (err) {
        console.warn("Failed to fetch plan info:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activePlan = useMemo(
    () => planData?.plans.find((p) => p.id === activePlanId) ?? null,
    [planData, activePlanId]
  );

  const mapCenter = useMemo<[number, number]>(
    () => activePlan?.center ?? planData?.center ?? DEFAULT_CENTER,
    [activePlan, planData]
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

  // ------ Callbacks ------
  const flyToPlan = useCallback(
    (plan?: PlanInfo | null) => {
      const target = plan ?? activePlan;
      if (!target) return;
      cameraRef.current?.setCamera({
        centerCoordinate: target.center,
        zoomLevel: 19,
        animationDuration: 500,
      });
    },
    [activePlan]
  );

  const onMapReady = useCallback(() => {
    flyToPlan();
  }, [flyToPlan]);

  // Handle map tap based on active tool
  const handleMapPress = useCallback(
    (feature: Feature) => {
      if (feature.geometry.type !== "Point") return;
      const [lon, lat] = feature.geometry.coordinates;
      const coord: Coord = [lon, lat];

      if (toolMode === "pin") {
        const id = uid();
        const defectNumber = defects.length + 1;
        const newDefect: Defect = {
          id,
          longitude: lon,
          latitude: lat,
          label: `Defect #${defectNumber}`,
          severity: selectedSeverity,
          createdAt: Date.now(),
        };
        setDefects((prev) => [...prev, newDefect]);
        setSelectedDefect(newDefect);
      } else if (toolMode === "polygon") {
        setDrawingCoords((prev) => [...prev, coord]);
      } else if (toolMode === "measure") {
        if (!measureStart) {
          setMeasureStart(coord);
        } else {
          const dist = haversineDistance(measureStart, coord);
          setMeasurements((prev) => [
            ...prev,
            { id: uid(), from: measureStart, to: coord, distanceM: dist },
          ]);
          setMeasureStart(null);
        }
      }
    },
    [toolMode, defects.length, selectedSeverity, measureStart]
  );

  const finishPolygon = useCallback(() => {
    if (drawingCoords.length < 3) {
      Alert.alert("Need at least 3 points", "Tap more points on the map first.");
      return;
    }
    const area = polygonAreaSqM(drawingCoords);
    const color = POLYGON_COLORS[polygons.length % POLYGON_COLORS.length];
    const poly: AreaPolygon = {
      id: uid(),
      coords: [...drawingCoords],
      label: `Area ${polygons.length + 1}`,
      areaSqM: area,
      color,
    };
    setPolygons((prev) => [...prev, poly]);
    setDrawingCoords([]);
  }, [drawingCoords, polygons.length]);

  const cancelDrawing = useCallback(() => {
    setDrawingCoords([]);
    setMeasureStart(null);
  }, []);

  const undoLastPoint = useCallback(() => {
    setDrawingCoords((prev) => prev.slice(0, -1));
  }, []);

  const deleteDefect = useCallback((id: string) => {
    setDefects((prev) => prev.filter((d) => d.id !== id));
    setSelectedDefect(null);
  }, []);

  const confirmDeleteDefect = useCallback(
    (defect: Defect) => {
      Alert.alert("Delete Defect", `Remove "${defect.label}"?`, [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteDefect(defect.id) },
      ]);
    },
    [deleteDefect]
  );

  const deletePolygon = useCallback((id: string) => {
    setPolygons((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const deleteMeasurement = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    Alert.alert("Clear All", "Remove all polygons & measurements?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear",
        style: "destructive",
        onPress: () => {
          setPolygons([]);
          setMeasurements([]);
          setDrawingCoords([]);
          setMeasureStart(null);
        },
      },
    ]);
  }, []);

  const handlePinPress = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const feature = e?.features?.[0];
      if (!feature?.properties?.defectId) return;
      const defect = defects.find((d) => d.id === feature.properties.defectId);
      if (defect) setSelectedDefect(defect);
    },
    [defects]
  );

  const selectPlan = useCallback(
    (plan: PlanInfo) => {
      setActivePlanId(plan.id);
      flyToPlan(plan);
    },
    [flyToPlan]
  );

  // Status text
  const statusText = useMemo(() => {
    if (toolMode === "polygon" && drawingCoords.length > 0) {
      return `Drawing polygon: ${drawingCoords.length} point${drawingCoords.length > 1 ? "s" : ""}`;
    }
    if (toolMode === "measure" && measureStart) {
      return "Tap second point to measure";
    }
    return null;
  }, [toolMode, drawingCoords.length, measureStart]);

  if (loading) {
    return (
      <SafeAreaView style={[styles.root, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading plans...</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Plan Viewer</Text>
        <Text style={styles.sub}>
          {activePlan ? activePlan.name : "No plans loaded"} |{" "}
          {defects.length} pins | {polygons.length} areas | {measurements.length} measures
        </Text>
      </View>

      {/* Plan picker */}
      {planData && planData.plans.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.planPicker}
        >
          {planData.plans.map((plan) => (
            <TouchableOpacity
              key={plan.id}
              style={[styles.planChip, activePlanId === plan.id && styles.planChipActive]}
              onPress={() => selectPlan(plan)}
            >
              <Text
                style={[styles.planChipText, activePlanId === plan.id && styles.planChipTextActive]}
                numberOfLines={1}
              >
                {plan.name}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Tool mode selector */}
      <View style={styles.toolBar}>
        {TOOL_MODES.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.toolBtn, toolMode === t.key && styles.toolBtnActive]}
            onPress={() => {
              setToolMode(t.key);
              cancelDrawing();
            }}
          >
            <Text style={styles.toolIcon}>{t.icon}</Text>
            <Text style={[styles.toolLabel, toolMode === t.key && styles.toolLabelActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}

        {/* Severity (only in pin mode) */}
        {toolMode === "pin" && (
          <View style={styles.severityInline}>
            {SEVERITY_ORDER.map((sev) => (
              <TouchableOpacity
                key={sev}
                style={[
                  styles.sevDot,
                  { backgroundColor: SEVERITY_COLORS[sev] },
                  selectedSeverity === sev && styles.sevDotActive,
                ]}
                onPress={() => setSelectedSeverity(sev)}
              />
            ))}
          </View>
        )}

        {/* Clear all */}
        {(polygons.length > 0 || measurements.length > 0) && (
          <TouchableOpacity style={styles.clearBtn} onPress={clearAll}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Drawing controls */}
      {toolMode === "polygon" && drawingCoords.length > 0 && (
        <View style={styles.drawingBar}>
          <Text style={styles.drawingText}>
            {drawingCoords.length} pts |{" "}
            {drawingCoords.length >= 2
              ? formatDistance(
                  drawingCoords.reduce(
                    (sum, c, i) =>
                      i === 0 ? 0 : sum + haversineDistance(drawingCoords[i - 1], c),
                    0
                  )
                )
              : "0 m"}
          </Text>
          <TouchableOpacity style={styles.drawingAction} onPress={undoLastPoint}>
            <Text style={styles.drawingActionText}>Undo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.drawingAction} onPress={cancelDrawing}>
            <Text style={[styles.drawingActionText, { color: "#F44336" }]}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.drawingAction, styles.finishBtn]}
            onPress={finishPolygon}
          >
            <Text style={[styles.drawingActionText, { color: "#fff" }]}>Finish</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Status line */}
      {statusText && (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{statusText}</Text>
        </View>
      )}

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapLibreGL.MapView
          ref={mapRef}
          style={styles.map}
          mapStyle={getStyleUrl(mapMode)}
          logoEnabled={false}
          attributionEnabled={false}
          onDidFinishLoadingMap={onMapReady}
          onPress={handleMapPress}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: mapCenter, zoomLevel: 19 }}
            minZoomLevel={2}
            maxZoomLevel={22}
          />

          {/* Completed polygons — fill */}
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
                lineWidth: 2,
                lineOpacity: 0.9,
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Polygon labels */}
          <MapLibreGL.ShapeSource id="polygon-labels" shape={polygonLabelsGeoJSON}>
            <MapLibreGL.SymbolLayer
              id="polygon-labels-layer"
              style={{
                textField: ["get", "label"],
                textSize: 11,
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
                circleRadius: 6,
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
                lineWidth: 2.5,
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Measurement labels */}
          <MapLibreGL.ShapeSource id="measure-labels" shape={measureLabelsGeoJSON}>
            <MapLibreGL.SymbolLayer
              id="measure-labels-layer"
              style={{
                textField: ["get", "label"],
                textSize: 13,
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
                circleRadius: 7,
                circleColor: "#E91E63",
                circleStrokeColor: "#fff",
                circleStrokeWidth: 2,
              }}
            />
          </MapLibreGL.ShapeSource>

          {/* Defect pins */}
          <MapLibreGL.ShapeSource id="defects" shape={defectsGeoJSON} onPress={handlePinPress}>
            <MapLibreGL.CircleLayer
              id="defects-circle"
              style={{
                circleRadius: 8,
                circleColor: ["get", "color"],
                circleStrokeColor: "#ffffff",
                circleStrokeWidth: 2.5,
                circleOpacity: 0.95,
              }}
            />
          </MapLibreGL.ShapeSource>
        </MapLibreGL.MapView>

        {/* Map mode toggle */}
        <View style={styles.mapToggle}>
          {(["normal", "satellite"] as MapMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.toggleBtn, mapMode === m && styles.toggleBtnActive]}
              onPress={() => setMapMode(m)}
            >
              <Text style={[styles.toggleBtnText, mapMode === m && styles.toggleBtnTextActive]}>
                {m === "normal" ? "Map" : "Satellite"}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Zoom controls */}
        <View style={styles.zoomControls}>
          <TouchableOpacity
            style={styles.zoomBtn}
            onPress={async () => {
              const z = await mapRef.current?.getZoom();
              if (z != null) cameraRef.current?.zoomTo(Math.min(z + 1, 22), 200);
            }}
          >
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.zoomBtn}
            onPress={async () => {
              const z = await mapRef.current?.getZoom();
              if (z != null) cameraRef.current?.zoomTo(Math.max(z - 1, 2), 200);
            }}
          >
            <Text style={styles.zoomBtnText}>{"\u2212"}</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.centerBtn} onPress={() => flyToPlan()}>
          <Text style={styles.centerBtnText}>Center</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom panel: info bars */}
      {selectedDefect && (
        <View style={styles.infoBar}>
          <View style={[styles.infoDot, { backgroundColor: SEVERITY_COLORS[selectedDefect.severity] }]} />
          <View style={styles.infoText}>
            <Text style={styles.infoTitle}>{selectedDefect.label}</Text>
            <Text style={styles.infoDetail}>
              {selectedDefect.severity.toUpperCase()} | {selectedDefect.longitude.toFixed(6)}, {selectedDefect.latitude.toFixed(6)}
            </Text>
          </View>
          <TouchableOpacity style={styles.deleteBtn} onPress={() => confirmDeleteDefect(selectedDefect)}>
            <Text style={styles.deleteBtnText}>Delete</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setSelectedDefect(null)}>
            <Text style={styles.closeBtnText}>X</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Polygon list */}
      {polygons.length > 0 && (
        <ScrollView style={styles.itemList} horizontal showsHorizontalScrollIndicator={false}>
          {polygons.map((p) => (
            <View key={p.id} style={[styles.itemChip, { borderColor: p.color }]}>
              <View style={[styles.itemDot, { backgroundColor: p.color }]} />
              <Text style={styles.itemLabel} numberOfLines={1}>
                {p.label}: {formatArea(p.areaSqM)}
              </Text>
              <TouchableOpacity onPress={() => deletePolygon(p.id)}>
                <Text style={styles.itemDelete}>X</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Measurement list */}
      {measurements.length > 0 && (
        <ScrollView style={styles.itemList} horizontal showsHorizontalScrollIndicator={false}>
          {measurements.map((m, i) => (
            <View key={m.id} style={[styles.itemChip, { borderColor: "#E91E63" }]}>
              <Text style={styles.itemLabel}>
                M{i + 1}: {formatDistance(m.distanceM)}
              </Text>
              <TouchableOpacity onPress={() => deleteMeasurement(m.id)}>
                <Text style={styles.itemDelete}>X</Text>
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: "#666" },

  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 2 },
  title: { fontSize: 18, fontWeight: "700", color: "#1a1a1a" },
  sub: { fontSize: 11, color: "#666", marginTop: 1 },

  // Plan picker
  planPicker: { paddingHorizontal: 16, paddingVertical: 4, gap: 8 },
  planChip: {
    paddingHorizontal: 12, paddingVertical: 5, borderRadius: 16,
    backgroundColor: "#eee", borderWidth: 1, borderColor: "#ddd",
  },
  planChipActive: { backgroundColor: "#007AFF", borderColor: "#007AFF" },
  planChipText: { fontSize: 12, fontWeight: "500", color: "#555" },
  planChipTextActive: { color: "#fff", fontWeight: "700" },

  // Tool mode bar
  toolBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6, gap: 4,
    borderBottomWidth: 1, borderBottomColor: "#eee",
  },
  toolBtn: {
    flexDirection: "row", alignItems: "center", gap: 3,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: "#f5f5f5",
  },
  toolBtnActive: { backgroundColor: "#007AFF" },
  toolIcon: { fontSize: 14 },
  toolLabel: { fontSize: 12, fontWeight: "600", color: "#555" },
  toolLabelActive: { color: "#fff" },

  severityInline: { flexDirection: "row", gap: 4, marginLeft: 8 },
  sevDot: { width: 22, height: 22, borderRadius: 11, opacity: 0.5 },
  sevDotActive: { opacity: 1, borderWidth: 2, borderColor: "#fff", transform: [{ scale: 1.15 }] },

  clearBtn: {
    marginLeft: "auto",
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 6, backgroundColor: "#F44336",
  },
  clearBtnText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  // Drawing bar
  drawingBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "#FFF3E0", gap: 8,
  },
  drawingText: { fontSize: 12, fontWeight: "600", color: "#E65100", flex: 1 },
  drawingAction: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  drawingActionText: { fontSize: 12, fontWeight: "700", color: "#333" },
  finishBtn: { backgroundColor: "#4CAF50" },

  // Status bar
  statusBar: {
    paddingHorizontal: 16, paddingVertical: 4, backgroundColor: "#E3F2FD",
  },
  statusText: { fontSize: 11, color: "#1565C0", fontWeight: "600" },

  mapContainer: { flex: 1 },
  map: { flex: 1 },

  // Map mode toggle
  mapToggle: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", borderRadius: 8, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(0,0,0,0.2)",
  },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(255,255,255,0.9)" },
  toggleBtnActive: { backgroundColor: "#007AFF" },
  toggleBtnText: { fontSize: 12, fontWeight: "600", color: "#333" },
  toggleBtnTextActive: { color: "#fff" },

  // Zoom controls
  zoomControls: { position: "absolute", right: 12, bottom: 24, gap: 8 },
  zoomBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center",
  },
  zoomBtnText: { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 22 },

  // Center button
  centerBtn: {
    position: "absolute", left: 12, bottom: 24,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  centerBtnText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  // Info bar
  infoBar: {
    flexDirection: "row", alignItems: "center", backgroundColor: "#fff",
    paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: "#e0e0e0", gap: 6,
  },
  infoDot: { width: 10, height: 10, borderRadius: 5 },
  infoText: { flex: 1 },
  infoTitle: { fontSize: 13, fontWeight: "600", color: "#1a1a1a" },
  infoDetail: { fontSize: 10, color: "#888", marginTop: 1 },
  deleteBtn: {
    backgroundColor: "#F44336", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
  },
  deleteBtnText: { color: "#fff", fontSize: 11, fontWeight: "600" },
  closeBtn: { paddingHorizontal: 6, paddingVertical: 4 },
  closeBtnText: { fontSize: 13, fontWeight: "700", color: "#999" },

  // Item list (polygons / measurements)
  itemList: {
    maxHeight: 40, paddingHorizontal: 12,
    borderTopWidth: 1, borderTopColor: "#f0f0f0",
  },
  itemChip: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 6, marginRight: 6,
    borderRadius: 8, borderWidth: 1.5, backgroundColor: "#fafafa",
  },
  itemDot: { width: 8, height: 8, borderRadius: 4 },
  itemLabel: { fontSize: 11, fontWeight: "600", color: "#333" },
  itemDelete: { fontSize: 12, fontWeight: "700", color: "#999", marginLeft: 4 },
});