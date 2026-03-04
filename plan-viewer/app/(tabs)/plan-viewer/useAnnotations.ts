import { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Defect, AreaPolygon, Measurement, Coord, PlanAnnotations, Severity } from "./types";
import { haversineDistance, polygonAreaSqM, uid } from "./geoUtils";
import { POLYGON_COLORS } from "./constants";

const STORAGE_PREFIX = "plan_annotations_";

async function loadAnnotations(planId: string): Promise<PlanAnnotations> {
  try {
    const raw = await AsyncStorage.getItem(`${STORAGE_PREFIX}${planId}`);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to load annotations:", e);
  }
  return { defects: [], polygons: [], measurements: [] };
}

async function saveAnnotations(planId: string, data: PlanAnnotations): Promise<void> {
  try {
    await AsyncStorage.setItem(`${STORAGE_PREFIX}${planId}`, JSON.stringify(data));
  } catch (e) {
    console.warn("Failed to save annotations:", e);
  }
}

export function useAnnotations(activePlanId: string | null) {
  const [defects, setDefects] = useState<Defect[]>([]);
  const [polygons, setPolygons] = useState<AreaPolygon[]>([]);
  const [measurements, setMeasurements] = useState<Measurement[]>([]);
  const [drawingCoords, setDrawingCoords] = useState<Coord[]>([]);
  const [measureStart, setMeasureStart] = useState<Coord | null>(null);
  const [selectedDefect, setSelectedDefect] = useState<Defect | null>(null);
  const [selectedSeverity, setSelectedSeverity] = useState<Severity>("medium");

  const loadedPlanRef = useRef<string | null>(null);
  const skipSaveRef = useRef(false);

  // Load annotations when activePlanId changes
  useEffect(() => {
    if (!activePlanId) return;
    skipSaveRef.current = true;
    (async () => {
      const annotations = await loadAnnotations(activePlanId);
      setDefects(annotations.defects);
      setPolygons(annotations.polygons);
      setMeasurements(annotations.measurements);
      setDrawingCoords([]);
      setMeasureStart(null);
      setSelectedDefect(null);
      loadedPlanRef.current = activePlanId;
      // Allow saves after state is loaded
      setTimeout(() => { skipSaveRef.current = false; }, 100);
    })();
  }, [activePlanId]);

  // Auto-save annotations whenever defects/polygons/measurements change
  useEffect(() => {
    if (!activePlanId || skipSaveRef.current) return;
    if (loadedPlanRef.current !== activePlanId) return;
    saveAnnotations(activePlanId, { defects, polygons, measurements });
  }, [defects, polygons, measurements, activePlanId]);

  const addDefect = useCallback(
    (lon: number, lat: number) => {
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
    },
    [defects.length, selectedSeverity]
  );

  const deleteDefect = useCallback((id: string) => {
    setDefects((prev) => prev.filter((d) => d.id !== id));
    setSelectedDefect(null);
  }, []);

  const addDrawingPoint = useCallback((coord: Coord) => {
    setDrawingCoords((prev) => [...prev, coord]);
  }, []);

  const finishPolygon = useCallback(() => {
    if (drawingCoords.length < 3) return false;
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
    return true;
  }, [drawingCoords, polygons.length]);

  const deletePolygon = useCallback((id: string) => {
    setPolygons((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const addMeasurement = useCallback(
    (coord: Coord) => {
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
    },
    [measureStart]
  );

  const deleteMeasurement = useCallback((id: string) => {
    setMeasurements((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const cancelDrawing = useCallback(() => {
    setDrawingCoords([]);
    setMeasureStart(null);
  }, []);

  const undoLastPoint = useCallback(() => {
    setDrawingCoords((prev) => prev.slice(0, -1));
  }, []);

  const clearAll = useCallback(() => {
    setDefects([]);
    setPolygons([]);
    setMeasurements([]);
    setDrawingCoords([]);
    setMeasureStart(null);
    setSelectedDefect(null);
  }, []);

  const loadImportedAnnotations = useCallback((data: PlanAnnotations) => {
    skipSaveRef.current = true;
    setDefects(data.defects);
    setPolygons(data.polygons);
    setMeasurements(data.measurements);
    setDrawingCoords([]);
    setMeasureStart(null);
    setSelectedDefect(null);
    skipSaveRef.current = false;
  }, []);

  return {
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
  };
}
