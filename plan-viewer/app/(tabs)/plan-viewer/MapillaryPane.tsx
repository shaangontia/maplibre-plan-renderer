import React from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import type { MapillaryImage } from "./useMapillary";
import { TILE_SERVER } from "./constants";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface MapillaryPaneProps {
  visible: boolean;
  loading: boolean;
  error: string | null;
  currentImageId: string | null;
  currentImagePosition: { lng: number; lat: number } | null;
  currentCompassAngle: number | null;
  nearbyCandidates: MapillaryImage[];
  onNavigateToImage: (imageId: string) => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Open the server-hosted MapillaryJS viewer in an in-app browser sheet
// ---------------------------------------------------------------------------
async function openViewer(imageId: string) {
  const url = `${TILE_SERVER}/mapillary/viewer?imageId=${encodeURIComponent(imageId)}`;
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.FORM_SHEET,
    controlsColor: "#4CAF50",
    toolbarColor: "#212121",
  });
}

// ---------------------------------------------------------------------------
// Component — native info pane with "Open Viewer" button (no native WebView)
// ---------------------------------------------------------------------------
export default function MapillaryPane({
  visible,
  loading,
  error,
  currentImageId,
  currentImagePosition,
  currentCompassAngle,
  nearbyCandidates,
  onNavigateToImage,
  onClose,
}: MapillaryPaneProps) {
  if (!visible) return null;

  const nearestCandidate = nearbyCandidates[0];

  return (
    <View style={styles.container}>
      {/* Header bar */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Street View</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {/* Loading state */}
      {loading && (
        <View style={styles.centerContent}>
          <ActivityIndicator size="small" color="#4CAF50" />
          <Text style={styles.loadingText}>Finding imagery…</Text>
        </View>
      )}

      {/* Error state */}
      {error && !loading && (
        <View style={styles.centerContent}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Image found — show info + open viewer button */}
      {!loading && !error && currentImageId && (
        <View style={styles.content}>
          {/* Coordinates */}
          {currentImagePosition && (
            <Text style={styles.coordText}>
              {currentImagePosition.lat.toFixed(5)}, {currentImagePosition.lng.toFixed(5)}
              {currentCompassAngle != null && ` | ${Math.round(currentCompassAngle)}°`}
            </Text>
          )}

          {/* Open full viewer button */}
          <TouchableOpacity
            style={styles.openViewerBtn}
            onPress={() => openViewer(currentImageId)}
          >
            <Text style={styles.openViewerIcon}>🔭</Text>
            <Text style={styles.openViewerText}>Open Street View</Text>
          </TouchableOpacity>

          {/* Thumbnail if available */}
          {nearestCandidate?.thumbUrl && (
            <TouchableOpacity onPress={() => openViewer(currentImageId)}>
              <Image
                source={{ uri: nearestCandidate.thumbUrl }}
                style={styles.thumbnail}
                resizeMode="cover"
              />
            </TouchableOpacity>
          )}

          {/* Nearby candidates */}
          {nearbyCandidates.length > 0 && (
            <View style={styles.candidatesSection}>
              <Text style={styles.candidatesTitle}>Nearby images</Text>
              <View style={styles.candidatesStrip}>
                {nearbyCandidates.map((img) => (
                  <TouchableOpacity
                    key={img.id}
                    style={[
                      styles.candidateChip,
                      img.id === currentImageId && styles.candidateChipActive,
                    ]}
                    onPress={() => onNavigateToImage(img.id)}
                  >
                    <Text style={styles.candidateText}>
                      {img.distanceM != null ? `${Math.round(img.distanceM)}m` : img.id.slice(0, 6)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {/* No image state */}
      {!loading && !error && !currentImageId && (
        <View style={styles.centerContent}>
          <Text style={styles.placeholderText}>Tap a point on the map</Text>
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: "#333",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#212121",
  },
  headerTitle: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  content: {
    flex: 1,
    padding: 12,
    gap: 12,
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
  },
  coordText: {
    color: "#aaa",
    fontSize: 11,
    fontFamily: "monospace",
    textAlign: "center",
  },
  openViewerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2E7D32",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
  },
  openViewerIcon: {
    fontSize: 18,
  },
  openViewerText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  thumbnail: {
    width: "100%",
    height: 160,
    borderRadius: 8,
    backgroundColor: "#333",
  },
  placeholderText: {
    color: "#666",
    fontSize: 13,
  },
  loadingText: {
    color: "#aaa",
    fontSize: 12,
  },
  errorText: {
    color: "#ef5350",
    fontSize: 12,
    textAlign: "center",
  },
  candidatesSection: {
    gap: 6,
  },
  candidatesTitle: {
    color: "#888",
    fontSize: 10,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  candidatesStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  candidateChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  candidateChipActive: {
    backgroundColor: "#1565C0",
  },
  candidateText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
  },
});
