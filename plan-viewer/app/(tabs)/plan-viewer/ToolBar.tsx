import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Severity, ToolMode } from "./types";
import { SEVERITY_COLORS, SEVERITY_ORDER, TOOL_MODES } from "./constants";
import { formatDistance, haversineDistance } from "./geoUtils";
import type { Coord } from "./types";

interface ToolBarProps {
  toolMode: ToolMode;
  setToolMode: (m: ToolMode) => void;
  selectedSeverity: Severity;
  setSelectedSeverity: (s: Severity) => void;
  defectsCount: number;
  polygonsCount: number;
  measurementsCount: number;
  onClearAll: () => void;
  cancelDrawing: () => void;
  isLandscape?: boolean;
}

export function ToolBar({
  toolMode,
  setToolMode,
  selectedSeverity,
  setSelectedSeverity,
  defectsCount,
  polygonsCount,
  measurementsCount,
  onClearAll,
  cancelDrawing,
  isLandscape,
}: ToolBarProps) {
  const content = (
    <>
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
      {(defectsCount > 0 || polygonsCount > 0 || measurementsCount > 0) && (
        <TouchableOpacity
          style={styles.clearBtn}
          onPress={() => {
            Alert.alert("Clear All", "Remove all pins, polygons & measurements?", [
              { text: "Cancel", style: "cancel" },
              { text: "Clear", style: "destructive", onPress: onClearAll },
            ]);
          }}
        >
          <Text style={styles.clearBtnText}>Clear</Text>
        </TouchableOpacity>
      )}
    </>
  );

  if (isLandscape) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolBarLandscape}
        style={styles.toolBarScrollContainer}
      >
        {content}
      </ScrollView>
    );
  }

  return <View style={styles.toolBar}>{content}</View>;
}

interface DrawingBarProps {
  drawingCoords: Coord[];
  onUndo: () => void;
  onCancel: () => void;
  onFinish: () => void;
}

export function DrawingBar({ drawingCoords, onUndo, onCancel, onFinish }: DrawingBarProps) {
  if (drawingCoords.length === 0) return null;

  return (
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
      <TouchableOpacity style={styles.drawingAction} onPress={onUndo}>
        <Text style={styles.drawingActionText}>Undo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.drawingAction} onPress={onCancel}>
        <Text style={[styles.drawingActionText, { color: "#F44336" }]}>Cancel</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.drawingAction, styles.finishBtn]}
        onPress={() => {
          if (drawingCoords.length < 3) {
            Alert.alert("Need at least 3 points", "Tap more points on the map first.");
            return;
          }
          onFinish();
        }}
      >
        <Text style={[styles.drawingActionText, { color: "#fff" }]}>Finish</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  toolBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6, gap: 4,
    borderBottomWidth: 1, borderBottomColor: "#eee",
  },
  toolBarScrollContainer: {
    flexGrow: 0,
    borderBottomWidth: 1, borderBottomColor: "#eee",
  },
  toolBarLandscape: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 3, gap: 4,
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

  drawingBar: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: "#FFF3E0", gap: 8,
  },
  drawingText: { fontSize: 12, fontWeight: "600", color: "#E65100", flex: 1 },
  drawingAction: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6 },
  drawingActionText: { fontSize: 12, fontWeight: "700", color: "#333" },
  finishBtn: { backgroundColor: "#4CAF50" },
});
