export type Severity = "low" | "medium" | "high" | "critical";
export type MapMode = "normal" | "satellite" | "canvas";
export type ToolMode = "pin" | "polygon" | "measure";

export interface PlanInfo {
  id: string;
  name: string;
  center: [number, number];
  corners: {
    topLeft: [number, number];
    topRight: [number, number];
    bottomRight: [number, number];
    bottomLeft: [number, number];
  };
  bounds: { sw: [number, number]; ne: [number, number] };
  opacity: number;
  floor?: string;
  building?: string;
  site?: string;
  calibrationMethod?: string;
  // Sheet drill-down
  group?: string;
  isOverview?: boolean;
  linkedSheets?: string[];   // plan IDs of detail sheets
  sheetNumber?: number;
}

export interface PlanInfoResponse {
  plans: PlanInfo[];
  center: [number, number];
  bounds: { sw: [number, number]; ne: [number, number] };
  zoom: number;
}

export interface Defect {
  id: string;
  longitude: number;
  latitude: number;
  label: string;
  severity: Severity;
  createdAt: number;
}

export type Coord = [number, number]; // [lon, lat]

export interface AreaPolygon {
  id: string;
  coords: Coord[];
  label: string;
  areaSqM: number;
  color: string;
}

export interface Measurement {
  id: string;
  from: Coord;
  to: Coord;
  distanceM: number;
}

export interface PlanAnnotations {
  defects: Defect[];
  polygons: AreaPolygon[];
  measurements: Measurement[];
}

export interface ExportData {
  version: string;
  exportedAt: string;
  planId: string;
  planName: string;
  annotations: PlanAnnotations;
}
