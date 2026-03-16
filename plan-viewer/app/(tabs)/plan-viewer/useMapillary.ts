import { useState, useCallback, useRef } from "react";
import type { WebView } from "react-native-webview";
import { TILE_SERVER } from "./constants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface MapillaryImage {
  id: string;
  lng: number;
  lat: number;
  capturedAt?: string;
  compassAngle?: number;
  sequenceId?: string;
  isPano?: boolean;
  thumbUrl?: string;
  distanceM?: number;
}

export interface MapillaryState {
  /** Whether the Mapillary pane is visible */
  paneVisible: boolean;
  /** Currently displayed image id in the viewer */
  currentImageId: string | null;
  /** Position of the currently displayed image */
  currentImagePosition: { lng: number; lat: number } | null;
  /** Compass angle of the current image */
  currentCompassAngle: number | null;
  /** The coordinate the user tapped on the map */
  searchCenter: { lng: number; lat: number } | null;
  /** Whether we're loading imagery */
  loading: boolean;
  /** Error message if any */
  error: string | null;
  /** Nearby candidates returned from API */
  nearbyCandidates: MapillaryImage[];
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useMapillary() {
  const webViewRef = useRef<WebView>(null);

  const [paneVisible, setPaneVisible] = useState(false);
  const [currentImageId, setCurrentImageId] = useState<string | null>(null);
  const [currentImagePosition, setCurrentImagePosition] = useState<{ lng: number; lat: number } | null>(null);
  const [currentCompassAngle, setCurrentCompassAngle] = useState<number | null>(null);
  const [searchCenter, setSearchCenter] = useState<{ lng: number; lat: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nearbyCandidates, setNearbyCandidates] = useState<MapillaryImage[]>([]);

  // Send a message to the WebView
  const sendToWebView = useCallback((type: string, payload: Record<string, any> = {}) => {
    const msg = JSON.stringify({ type, ...payload });
    webViewRef.current?.postMessage(msg);
  }, []);

  // Toggle pane visibility
  const togglePane = useCallback(() => {
    setPaneVisible((v) => !v);
  }, []);

  const showPane = useCallback(() => setPaneVisible(true), []);
  const hidePane = useCallback(() => setPaneVisible(false), []);

  // Query backend for nearest Mapillary image, then tell WebView to display it
  const findNearestImage = useCallback(
    async (lng: number, lat: number, radius = 100) => {
      setLoading(true);
      setError(null);
      setSearchCenter({ lng, lat });

      try {
        const url = `${TILE_SERVER}/mapillary/nearest?lng=${lng}&lat=${lat}&radius=${radius}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (!resp.ok) {
          throw new Error(data.error || `HTTP ${resp.status}`);
        }

        if (!data.found) {
          setError("No Mapillary coverage here");
          setNearbyCandidates([]);
          setCurrentImageId(null);
          setCurrentImagePosition(null);
          sendToWebView("showPlaceholder", { text: "No Mapillary coverage here" });
          setLoading(false);
          return null;
        }

        const nearest: MapillaryImage = data.nearest;
        const nearby: MapillaryImage[] = data.nearby || [];

        setCurrentImageId(nearest.id);
        setCurrentImagePosition({ lng: nearest.lng, lat: nearest.lat });
        setCurrentCompassAngle(nearest.compassAngle ?? null);
        setNearbyCandidates(nearby);

        // Tell WebView to navigate
        sendToWebView("navigateTo", { imageId: nearest.id });
        showPane();

        setLoading(false);
        return nearest;
      } catch (err: any) {
        setError(err.message);
        setLoading(false);
        return null;
      }
    },
    [sendToWebView, showPane],
  );

  // Navigate to a specific image by id (e.g. from nearby candidates list)
  const navigateToImage = useCallback(
    (imageId: string) => {
      setCurrentImageId(imageId);
      sendToWebView("navigateTo", { imageId });
    },
    [sendToWebView],
  );

  // Handle messages coming back from the WebView
  const handleWebViewMessage = useCallback((event: { nativeEvent: { data: string } }) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      switch (data.type) {
        case "imageChanged":
          setCurrentImageId(data.imageId);
          setCurrentImagePosition({ lng: data.lng, lat: data.lat });
          setCurrentCompassAngle(data.compassAngle ?? null);
          break;
        case "viewerReady":
          // Viewer is initialized and ready
          break;
        case "error":
          setError(data.message);
          break;
        case "htmlReady":
          // HTML page loaded, initialize the viewer with token
          // Token is passed from the backend — for now we use env or empty
          break;
      }
    } catch {
      // Ignore non-JSON messages
    }
  }, []);

  // Initialize the WebView viewer (call after WebView loads)
  const initViewer = useCallback(
    (accessToken: string) => {
      sendToWebView("init", { accessToken });
    },
    [sendToWebView],
  );

  return {
    webViewRef,
    // State
    paneVisible,
    currentImageId,
    currentImagePosition,
    currentCompassAngle,
    searchCenter,
    loading,
    error,
    nearbyCandidates,
    // Actions
    togglePane,
    showPane,
    hidePane,
    findNearestImage,
    navigateToImage,
    handleWebViewMessage,
    initViewer,
    sendToWebView,
  };
}
