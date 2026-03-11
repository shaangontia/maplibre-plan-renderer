import MapLibreGL from "@maplibre/maplibre-react-native";
import type { Feature } from "geojson";
import React, { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import type { Coord, MapMode, PlanInfo, ToolMode } from "./plan-viewer/types";
import { getStyleUrl } from "./plan-viewer/constants";
import { usePlanData } from "./plan-viewer/usePlanData";
import { useAnnotations } from "./plan-viewer/useAnnotations";
import { useExportImport } from "./plan-viewer/useExportImport";
import { useDetectAreas } from "./plan-viewer/useDetectAreas";
import { useUserLocation } from "./plan-viewer/useUserLocation";
import { useOrientation } from "./plan-viewer/useOrientation";
import MapLayers from "./plan-viewer/MapLayers";
import { ToolBar, DrawingBar } from "./plan-viewer/ToolBar";
import PlanDropdown from "./plan-viewer/PlanDropdown";
import { DefectInfoBar, PolygonList, MeasurementList, DetectedAreasList } from "./plan-viewer/BottomPanels";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function PlanViewerScreen() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cameraRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const { orientation, isTablet } = useOrientation();
  const isLandscape = orientation === "landscape";
  const useCompactHeader = isLandscape || isTablet;

  const { planData, loading, activePlanId, setActivePlanId, activePlan, mapCenter } =
    usePlanData();

  const annotations = useAnnotations(activePlanId);
  const {
    defects,
    polygons,
    measurements,
    drawingCoords,
    measureStart,
    selectedDefect,
    selectedSeverity,
    setSelectedDefect,
    setSelectedSeverity,
    addDefect,
    deleteDefect,
    addDrawingPoint,
    finishPolygon,
    deletePolygon,
    addMeasurement,
    deleteMeasurement,
    cancelDrawing,
    undoLastPoint,
    clearAll,
    loadImportedAnnotations,
  } = annotations;

  const { exportAnnotations, importAnnotations } = useExportImport(
    activePlanId,
    activePlan?.name || "Unknown Plan",
    { defects, polygons, measurements },
    loadImportedAnnotations
  );

  const [toolMode, setToolMode] = useState<ToolMode>("pin");
  const [mapMode, setMapMode] = useState<MapMode>("normal");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [showDetectedAreas, setShowDetectedAreas] = useState(false);
  const [areaNavMode, setAreaNavMode] = useState(false);

  const {
    detectedAreas,
    detecting,
    detectAreas,
    clearDetectedAreas,
    acceptDetectedAreas,
  } = useDetectAreas(activePlanId);

  const {
    location: userLocation,
    permissionGranted,
    simMode,
    following,
    toggleFollowing,
    requestPermission,
    startSim,
    moveSimulated,
  } = useUserLocation();

  // ------ Callbacks ------
  const flyToPlan = useCallback(
    (plan?: PlanInfo | null) => {
      const target = plan ?? activePlan;
      if (!target) return;
      cameraRef.current?.setCamera({
        centerCoordinate: target.center,
        zoomLevel: 18,
        animationDuration: 500,
      });
    },
    [activePlan]
  );

  const onMapReady = useCallback(() => {
    flyToPlan();
  }, [flyToPlan]);

  const handlePinPress = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const feature = e?.features?.[0];
      if (!feature?.properties?.defectId) return;
      const defect = defects.find((d) => d.id === feature.properties.defectId);
      if (defect) setSelectedDefect(defect);
    },
    [defects, setSelectedDefect]
  );

  const handleClusterPress = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (e: any) => {
      const feature = e?.features?.[0];
      if (!feature) return;
      const [lon, lat] = feature.geometry.coordinates;
      const currentZoom = await mapRef.current?.getZoom();
      cameraRef.current?.setCamera({
        centerCoordinate: [lon, lat],
        zoomLevel: Math.min((currentZoom ?? 17) + 2, 22),
        animationDuration: 400,
      });
    },
    []
  );

  // Sheet drill-down: linked detail plans for the current overview
  const linkedSheetPlans = useMemo(() => {
    if (!activePlan?.isOverview || !activePlan.linkedSheets) return [];
    return activePlan.linkedSheets
      .map((id) => planData?.plans.find((p) => p.id === id))
      .filter((p): p is PlanInfo => p != null);
  }, [activePlan, planData]);

  // Overview plan for the current sheet (for Back button)
  const overviewPlan = useMemo(() => {
    if (!activePlan?.group || activePlan.isOverview) return null;
    return planData?.plans.find(
      (p) => p.group === activePlan.group && p.isOverview
    ) ?? null;
  }, [activePlan, planData]);

  // Follow-me: whenever location updates and following is on, re-center camera
  React.useEffect(() => {
    if (following && userLocation) {
      cameraRef.current?.setCamera({
        centerCoordinate: [userLocation.longitude, userLocation.latitude],
        animationDuration: 600,
      });
    }
  }, [following, userLocation]);

  const selectPlan = useCallback(
    (plan: PlanInfo) => {
      setActivePlanId(plan.id);
      setDropdownOpen(false);
      setTimeout(() => flyToPlan(plan), 200);
    },
    [flyToPlan, setActivePlanId]
  );

  const handleSheetPress = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const feature = e?.features?.[0];
      if (!feature?.properties?.planId) return;
      const target = planData?.plans.find(
        (p) => p.id === feature.properties.planId
      );
      if (target) selectPlan(target);
    },
    [planData, selectPlan]
  );

  const handleMapPress = useCallback(
    async (feature: Feature) => {
      if (feature.geometry.type !== "Point") return;
      const [lon, lat] = feature.geometry.coordinates;
      const coord: Coord = [lon, lat];

      // If viewing an overview with area nav enabled, check if tap hit a sheet boundary polygon
      if (areaNavMode && linkedSheetPlans.length > 0 && mapRef.current) {
        try {
          const screenPoint = await mapRef.current.getPointInView([lon, lat]);
          const hits = await mapRef.current.queryRenderedFeaturesAtPoint(
            screenPoint,
            null,
            ["sheet-boundaries-fill"]
          );
          if (hits?.features?.length > 0) {
            const hitPlanId = hits.features[0]?.properties?.planId;
            const target = planData?.plans.find((p) => p.id === hitPlanId);
            if (target) { selectPlan(target); return; }
          }
        } catch (_) { /* ignore query errors */ }
      }

      if (toolMode === "pin") {
        addDefect(lon, lat);
      } else if (toolMode === "polygon") {
        addDrawingPoint(coord);
      } else if (toolMode === "measure") {
        addMeasurement(coord);
      }
    },
    [toolMode, areaNavMode, linkedSheetPlans, planData, selectPlan, addDefect, addDrawingPoint, addMeasurement]
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
      {/* Header with plan dropdown — compact single row on tablet & landscape */}
      <View style={useCompactHeader ? styles.headerLandscape : styles.header}>
        {useCompactHeader ? (
          <View style={styles.headerRowLandscape}>
            <Text style={styles.titleLandscape}>Plan Viewer</Text>
            <View style={styles.planDropdownLandscape}>
              <PlanDropdown
                planData={planData}
                activePlanId={activePlanId}
                activePlan={activePlan}
                dropdownOpen={dropdownOpen}
                setDropdownOpen={setDropdownOpen}
                onSelectPlan={selectPlan}
                compact
              />
            </View>
            <View style={styles.headerActions}>
              <TouchableOpacity style={styles.exportBtn} onPress={exportAnnotations}>
                <Text style={styles.exportBtnText}>📤 Export</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.importBtn} onPress={importAnnotations}>
                <Text style={styles.importBtnText}>📥 Import</Text>
              </TouchableOpacity>
              <Text style={styles.statsBadge}>
                {defects.length}P {polygons.length}A {measurements.length}M
              </Text>
            </View>
          </View>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Plan Viewer</Text>
              <View style={styles.headerActions}>
                <TouchableOpacity style={styles.exportBtn} onPress={exportAnnotations}>
                  <Text style={styles.exportBtnText}>📤 Export</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.importBtn} onPress={importAnnotations}>
                  <Text style={styles.importBtnText}>📥 Import</Text>
                </TouchableOpacity>
                <Text style={styles.statsBadge}>
                  {defects.length}P {polygons.length}A {measurements.length}M
                </Text>
              </View>
            </View>
            <PlanDropdown
              planData={planData}
              activePlanId={activePlanId}
              activePlan={activePlan}
              dropdownOpen={dropdownOpen}
              setDropdownOpen={setDropdownOpen}
              onSelectPlan={selectPlan}
            />
          </>
        )}
      </View>

      {/* Tool mode selector */}
      <ToolBar
        toolMode={toolMode}
        setToolMode={setToolMode}
        selectedSeverity={selectedSeverity}
        setSelectedSeverity={setSelectedSeverity}
        defectsCount={defects.length}
        polygonsCount={polygons.length}
        measurementsCount={measurements.length}
        onClearAll={clearAll}
        cancelDrawing={cancelDrawing}
        isLandscape={useCompactHeader}
      />

      {/* Drawing controls */}
      {toolMode === "polygon" && (
        <DrawingBar
          drawingCoords={drawingCoords}
          onUndo={undoLastPoint}
          onCancel={cancelDrawing}
          onFinish={finishPolygon}
        />
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
          mapStyle={getStyleUrl(mapMode, activePlanId ?? undefined)}
          logoEnabled={false}
          attributionEnabled={false}
          onDidFinishLoadingMap={onMapReady}
          onPress={handleMapPress}
        >
          <MapLibreGL.Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: mapCenter, zoomLevel: 18 }}
            minZoomLevel={2}
            maxZoomLevel={22}
          />

          <MapLayers
            defects={defects}
            polygons={polygons}
            measurements={measurements}
            drawingCoords={drawingCoords}
            measureStart={measureStart}
            detectedAreas={detectedAreas}
            userLocation={userLocation}
            linkedSheetPlans={linkedSheetPlans}
            areaNavMode={areaNavMode}
            onPinPress={handlePinPress}
            onClusterPress={handleClusterPress}
            onSheetPress={handleSheetPress}
          />
        </MapLibreGL.MapView>

        {/* Map mode toggle */}
        <View style={styles.mapToggle}>
          {(["normal", "satellite", "canvas"] as MapMode[]).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.toggleBtn, mapMode === m && styles.toggleBtnActive]}
              onPress={() => setMapMode(m)}
            >
              <Text style={[styles.toggleBtnText, mapMode === m && styles.toggleBtnTextActive]}>
                {m === "normal" ? "Map" : m === "satellite" ? "Satellite" : "Canvas"}
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

        <TouchableOpacity style={isLandscape ? styles.centerBtnLandscape : styles.centerBtn} onPress={() => flyToPlan()}>
          <Text style={styles.centerBtnText}>Center</Text>
        </TouchableOpacity>

        {/* Location button — request permission or toggle follow mode */}
        <TouchableOpacity
          style={[isLandscape ? styles.locationBtnLandscape : styles.locationBtn, following && styles.locationBtnActive]}
          onPress={permissionGranted ? toggleFollowing : requestPermission}
        >
          <Text style={styles.locationBtnIcon}>{permissionGranted ? (following ? "📍" : "🔵") : "📍"}</Text>
          <Text style={[styles.locationBtnLabel, following && styles.locationBtnLabelActive]}>
            {!permissionGranted ? "Enable Location" : following ? "Following" : "My Location"}
          </Text>
        </TouchableOpacity>

        {/* Simulate Location button — places dot at plan center */}
        <TouchableOpacity
          style={[isLandscape ? styles.simBtnLandscape : styles.simBtn, simMode && styles.simBtnActive]}
          onPress={() => {
            if (activePlan) {
              const c = activePlan.center as [number, number];
              startSim(c[0], c[1]);
            }
          }}
        >
          <Text style={styles.simBtnIcon}>🎮</Text>
          <Text style={[styles.simBtnLabel, simMode && styles.simBtnLabelActive]}>
            {simMode ? "Simulating" : "Simulate"}
          </Text>
        </TouchableOpacity>

        {/* D-pad — only visible in sim mode */}
        {simMode && (
          <View style={isLandscape ? styles.dpadLandscape : styles.dpad}>
            <TouchableOpacity style={styles.dpadBtn} onPress={() => moveSimulated("north")}>
              <Text style={styles.dpadText}>▲</Text>
            </TouchableOpacity>
            <View style={styles.dpadMiddleRow}>
              <TouchableOpacity style={styles.dpadBtn} onPress={() => moveSimulated("west")}>
                <Text style={styles.dpadText}>◀</Text>
              </TouchableOpacity>
              <View style={styles.dpadCenter} />
              <TouchableOpacity style={styles.dpadBtn} onPress={() => moveSimulated("east")}>
                <Text style={styles.dpadText}>▶</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.dpadBtn} onPress={() => moveSimulated("south")}>
              <Text style={styles.dpadText}>▼</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Area Navigation toggle — only shown on overview plans */}
        {linkedSheetPlans.length > 0 && (
          <TouchableOpacity
            style={[isLandscape ? styles.areaNavBtnLandscape : styles.areaNavBtn, areaNavMode && styles.areaNavBtnActive]}
            onPress={() => setAreaNavMode((v) => !v)}
          >
            <Text style={styles.areaNavIcon}>🗺️</Text>
            <Text style={[styles.areaNavLabel, areaNavMode && styles.areaNavLabelActive]}>
              {areaNavMode ? "Area Nav ON" : "Area Nav"}
            </Text>
          </TouchableOpacity>
        )}

        {/* Back to Overview — shown when viewing a detail sheet in area nav mode */}
        {areaNavMode && overviewPlan && (
          <TouchableOpacity
            style={isLandscape ? styles.backToOverviewBtnLandscape : styles.backToOverviewBtn}
            onPress={() => selectPlan(overviewPlan)}
          >
            <Text style={styles.backToOverviewText}>⬅ Overview</Text>
          </TouchableOpacity>
        )}

        {/* Detect Areas FAB */}
        <TouchableOpacity
          style={[isLandscape ? styles.detectBtnLandscape : styles.detectBtn, detecting && styles.detectBtnBusy]}
          onPress={async () => {
            await detectAreas();
            setShowDetectedAreas(true);
          }}
          disabled={detecting}
        >
          <Text style={styles.detectBtnText}>{detecting ? "⏳" : "🔍"}</Text>
          <Text style={styles.detectBtnLabel}>{detecting ? "Detecting…" : "Detect Areas"}</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom panels */}
      {selectedDefect && (
        <DefectInfoBar
          defect={selectedDefect}
          onDelete={() => deleteDefect(selectedDefect.id)}
          onClose={() => setSelectedDefect(null)}
        />
      )}
      <PolygonList polygons={polygons} onDelete={deletePolygon} />
      <MeasurementList measurements={measurements} onDelete={deleteMeasurement} />
      {showDetectedAreas && detectedAreas.length > 0 && (
        <DetectedAreasList
          areas={detectedAreas}
          onAccept={() => {
            const newPolygons = acceptDetectedAreas();
            loadImportedAnnotations({
              defects,
              polygons: [...polygons, ...newPolygons],
              measurements,
            });
            clearDetectedAreas();
            setShowDetectedAreas(false);
          }}
          onDiscard={() => {
            clearDetectedAreas();
            setShowDetectedAreas(false);
          }}
        />
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles (only screen-level layout styles remain here)
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 12, fontSize: 14, color: "#666" },

  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 },
  headerLandscape: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 2 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerRowLandscape: { flexDirection: "row", alignItems: "center", gap: 12 },
  title: { fontSize: 18, fontWeight: "700", color: "#1a1a1a" },
  titleLandscape: { fontSize: 14, fontWeight: "700", color: "#1a1a1a" },
  planDropdownLandscape: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  exportBtn: {
    backgroundColor: "#4CAF50", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
  },
  exportBtnText: { fontSize: 11, fontWeight: "600", color: "#fff" },
  importBtn: {
    backgroundColor: "#2196F3", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
  },
  importBtnText: { fontSize: 11, fontWeight: "600", color: "#fff" },
  statsBadge: {
    fontSize: 10, fontWeight: "600", color: "#666",
    backgroundColor: "#f0f0f0", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },

  statusBar: {
    paddingHorizontal: 16, paddingVertical: 4, backgroundColor: "#E3F2FD",
  },
  statusText: { fontSize: 11, color: "#1565C0", fontWeight: "600" },

  mapContainer: { flex: 1 },
  map: { flex: 1 },

  mapToggle: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", borderRadius: 8, overflow: "hidden",
    borderWidth: 1, borderColor: "rgba(0,0,0,0.2)",
  },
  toggleBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "rgba(255,255,255,0.9)" },
  toggleBtnActive: { backgroundColor: "#007AFF" },
  toggleBtnText: { fontSize: 12, fontWeight: "600", color: "#333" },
  toggleBtnTextActive: { color: "#fff" },

  zoomControls: { position: "absolute", right: 12, bottom: 24, gap: 8 },
  zoomBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center",
  },
  zoomBtnText: { color: "#fff", fontSize: 20, fontWeight: "700", lineHeight: 22 },

  centerBtn: {
    position: "absolute", left: 12, bottom: 24,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  centerBtnLandscape: {
    position: "absolute", left: 12, bottom: 12,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  centerBtnText: { color: "#fff", fontSize: 11, fontWeight: "600" },

  areaNavBtn: {
    position: "absolute", left: 12, bottom: 248,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  areaNavBtnLandscape: {
    position: "absolute", left: 292, bottom: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  areaNavBtnActive: { backgroundColor: "#1565C0" },
  areaNavIcon: { fontSize: 14 },
  areaNavLabel: { color: "#fff", fontSize: 11, fontWeight: "600" },
  areaNavLabelActive: { color: "#fff" },

  backToOverviewBtn: {
    position: "absolute", left: 12, bottom: 200,
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
  },
  backToOverviewBtnLandscape: {
    position: "absolute", left: 420, bottom: 12,
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  backToOverviewText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  simBtn: {
    position: "absolute", left: 12, bottom: 156,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  simBtnLandscape: {
    position: "absolute", left: 162, bottom: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  simBtnActive: { backgroundColor: "#6A1B9A" },
  simBtnIcon: { fontSize: 14 },
  simBtnLabel: { color: "#fff", fontSize: 11, fontWeight: "600" },
  simBtnLabelActive: { color: "#E1BEE7" },

  dpad: {
    position: "absolute", right: 12, bottom: 100,
    alignItems: "center", gap: 2,
  },
  dpadLandscape: {
    position: "absolute", right: 60, bottom: 8,
    alignItems: "center", gap: 1,
  },
  dpadMiddleRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  dpadCenter: { width: 44, height: 44 },
  dpadBtn: {
    width: 44, height: 44, borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center",
  },
  dpadText: { color: "#fff", fontSize: 18, lineHeight: 22 },

  locationBtn: {
    position: "absolute", left: 12, bottom: 112,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  locationBtnLandscape: {
    position: "absolute", left: 88, bottom: 12,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  locationBtnActive: { backgroundColor: "#1565C0" },
  locationBtnIcon: { fontSize: 14 },
  locationBtnLabel: { color: "#fff", fontSize: 11, fontWeight: "600" },
  locationBtnLabelActive: { color: "#fff" },

  detectBtn: {
    position: "absolute", left: 12, bottom: 68,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "#006064",
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  detectBtnLandscape: {
    position: "absolute", left: 12, bottom: 42,
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "#006064",
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 4, elevation: 4,
  },
  detectBtnBusy: { backgroundColor: "#455A64" },
  detectBtnText: { fontSize: 14 },
  detectBtnLabel: { color: "#fff", fontSize: 11, fontWeight: "700" },
});