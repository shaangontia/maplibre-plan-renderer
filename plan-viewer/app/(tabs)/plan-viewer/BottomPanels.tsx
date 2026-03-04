import React from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Defect, AreaPolygon, Measurement } from "./types";
import { SEVERITY_COLORS } from "./constants";
import { formatArea, formatDistance } from "./geoUtils";

interface DefectInfoBarProps {
  defect: Defect;
  onDelete: () => void;
  onClose: () => void;
}

export function DefectInfoBar({ defect, onDelete, onClose }: DefectInfoBarProps) {
  return (
    <View style={styles.infoBar}>
      <View style={[styles.infoDot, { backgroundColor: SEVERITY_COLORS[defect.severity] }]} />
      <View style={styles.infoText}>
        <Text style={styles.infoTitle}>{defect.label}</Text>
        <Text style={styles.infoDetail}>
          {defect.severity.toUpperCase()} | {defect.longitude.toFixed(6)}, {defect.latitude.toFixed(6)}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={() => {
          Alert.alert("Delete Defect", `Remove "${defect.label}"?`, [
            { text: "Cancel", style: "cancel" },
            { text: "Delete", style: "destructive", onPress: onDelete },
          ]);
        }}
      >
        <Text style={styles.deleteBtnText}>Delete</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeBtnText}>X</Text>
      </TouchableOpacity>
    </View>
  );
}

interface PolygonListProps {
  polygons: AreaPolygon[];
  onDelete: (id: string) => void;
}

export function PolygonList({ polygons, onDelete }: PolygonListProps) {
  if (polygons.length === 0) return null;
  return (
    <ScrollView style={styles.itemList} horizontal showsHorizontalScrollIndicator={false}>
      {polygons.map((p) => (
        <View key={p.id} style={[styles.itemChip, { borderColor: p.color }]}>
          <View style={[styles.itemDot, { backgroundColor: p.color }]} />
          <Text style={styles.itemLabel} numberOfLines={1}>
            {p.label}: {formatArea(p.areaSqM)}
          </Text>
          <TouchableOpacity onPress={() => onDelete(p.id)}>
            <Text style={styles.itemDelete}>X</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

interface MeasurementListProps {
  measurements: Measurement[];
  onDelete: (id: string) => void;
}

export function MeasurementList({ measurements, onDelete }: MeasurementListProps) {
  if (measurements.length === 0) return null;
  return (
    <ScrollView style={styles.itemList} horizontal showsHorizontalScrollIndicator={false}>
      {measurements.map((m, i) => (
        <View key={m.id} style={[styles.itemChip, { borderColor: "#E91E63" }]}>
          <Text style={styles.itemLabel}>
            M{i + 1}: {formatDistance(m.distanceM)}
          </Text>
          <TouchableOpacity onPress={() => onDelete(m.id)}>
            <Text style={styles.itemDelete}>X</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
