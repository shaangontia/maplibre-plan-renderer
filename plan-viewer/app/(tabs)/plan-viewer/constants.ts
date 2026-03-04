import { Platform } from "react-native";
import type { Severity, ToolMode, MapMode } from "./types";

export const TILE_SERVER =
  Platform.OS === "android" ? "http://10.0.2.2:8080" : "http://localhost:8080";

export const SEVERITY_COLORS: Record<Severity, string> = {
  low: "#4CAF50",
  medium: "#FF9800",
  high: "#F44336",
  critical: "#9C27B0",
};

export const SEVERITY_ORDER: Severity[] = ["low", "medium", "high", "critical"];

export const TOOL_MODES: { key: ToolMode; label: string; icon: string }[] = [
  { key: "pin", label: "Pin", icon: "\uD83D\uDCCC" },
  { key: "polygon", label: "Area", icon: "\u2B1F" },
  { key: "measure", label: "Measure", icon: "\uD83D\uDCCF" },
];

export const POLYGON_COLORS = [
  "#2196F3",
  "#E91E63",
  "#00BCD4",
  "#FF5722",
  "#8BC34A",
  "#673AB7",
  "#FFC107",
  "#009688",
];

export const DEFAULT_CENTER: [number, number] = [0, 0];

export const getStyleUrl = (mode: MapMode) =>
  `${TILE_SERVER}/style.json?mode=${mode}`;
