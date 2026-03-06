import { useCallback, useState } from "react";
import { Alert } from "react-native";
import { TILE_SERVER } from "./constants";
import { polygonAreaSqM } from "./geoUtils";
import { POLYGON_COLORS } from "./constants";
import type { AreaPolygon, Coord } from "./types";

export interface DetectedArea {
  id: string;
  label: string;
  coords: Coord[];
  areaSqM: number;
  color: string;
}

interface RawArea {
  id: string;
  label: string;
  coords: [number, number][];
}

export function useDetectAreas(planId: string | null) {
  const [detectedAreas, setDetectedAreas] = useState<DetectedArea[]>([]);
  const [detecting, setDetecting] = useState(false);

  const detectAreas = useCallback(async () => {
    if (!planId) {
      Alert.alert("No plan selected", "Please select a plan first.");
      return;
    }

    setDetecting(true);
    try {
      const res = await fetch(`${TILE_SERVER}/api/plans/${planId}/detect-areas`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || "Detection failed");
      }
      const data = await res.json();
      const areas: DetectedArea[] = (data.areas as RawArea[]).map((a, i) => ({
        id: a.id,
        label: a.label,
        coords: a.coords as Coord[],
        areaSqM: polygonAreaSqM(a.coords as Coord[]),
        color: POLYGON_COLORS[i % POLYGON_COLORS.length],
      }));
      setDetectedAreas(areas);
      if (areas.length === 0) {
        Alert.alert("No rooms found", "Could not detect any rooms in this plan image.");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert("Detection failed", msg);
    } finally {
      setDetecting(false);
    }
  }, [planId]);

  const clearDetectedAreas = useCallback(() => {
    setDetectedAreas([]);
  }, []);

  const acceptDetectedAreas = useCallback((): AreaPolygon[] => {
    return detectedAreas.map((a) => ({
      id: a.id,
      label: a.label,
      coords: a.coords,
      areaSqM: a.areaSqM,
      color: a.color,
    }));
  }, [detectedAreas]);

  return {
    detectedAreas,
    detecting,
    detectAreas,
    clearDetectedAreas,
    acceptDetectedAreas,
  };
}
