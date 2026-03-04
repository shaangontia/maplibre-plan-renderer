import { Alert, Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import type { ExportData, PlanAnnotations } from "./types";

export function useExportImport(
  activePlanId: string | null,
  activePlanName: string,
  annotations: PlanAnnotations,
  loadAnnotations: (data: PlanAnnotations) => void
) {
  const exportAnnotations = async () => {
    if (!activePlanId) {
      Alert.alert("Error", "No plan selected");
      return;
    }

    const exportData: ExportData = {
      version: "1.0",
      exportedAt: new Date().toISOString(),
      planId: activePlanId,
      planName: activePlanName,
      annotations,
    };

    const json = JSON.stringify(exportData, null, 2);
    const filename = `${activePlanName.replace(/[^a-z0-9]/gi, "_")}_annotations_${Date.now()}.json`;

    try {
      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        Alert.alert("Success", `Exported ${annotations.defects.length} pins, ${annotations.polygons.length} areas, ${annotations.measurements.length} measurements`);
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const fileUri = `${FileSystem.cacheDirectory}${filename}`;
        await FileSystem.writeAsStringAsync(fileUri, json);

        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            mimeType: "application/json",
            dialogTitle: "Export Annotations",
          });
        } else {
          Alert.alert("Success", `Exported to ${fileUri}`);
        }
      }
    } catch (error) {
      console.error("Export error:", error);
      Alert.alert("Error", "Failed to export annotations");
    }
  };

  const importAnnotations = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "application/json",
        copyToCacheDirectory: true,
      });

      if (result.canceled) return;

      const file = result.assets[0];
      let json: string;

      if (Platform.OS === "web") {
        const response = await fetch(file.uri);
        json = await response.text();
      } else {
        const FileSystem = await import("expo-file-system/legacy");
        json = await FileSystem.readAsStringAsync(file.uri);
      }

      const data: ExportData = JSON.parse(json);

      if (!data.version || !data.annotations) {
        Alert.alert("Error", "Invalid export file format");
        return;
      }

      Alert.alert(
        "Import Annotations",
        `Import ${data.annotations.defects.length} pins, ${data.annotations.polygons.length} areas, and ${data.annotations.measurements.length} measurements?\n\nFrom: ${data.planName}\nExported: ${new Date(data.exportedAt).toLocaleString()}\n\nThis will replace current annotations.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Import",
            onPress: () => {
              loadAnnotations(data.annotations);
              Alert.alert("Success", "Annotations imported successfully");
            },
          },
        ]
      );
    } catch (error) {
      console.error("Import error:", error);
      Alert.alert("Error", "Failed to import annotations");
    }
  };

  return { exportAnnotations, importAnnotations };
}
