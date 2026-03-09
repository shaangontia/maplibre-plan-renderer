import { useState, useEffect, useCallback, useRef } from "react";
import * as Location from "expo-location";

export interface UserLocation {
  longitude: number;
  latitude: number;
  accuracy: number | null;
  heading: number | null;
}

// One degree of latitude  ≈ 111,320 m  → 5 m step ≈ 0.0000449°
// One degree of longitude ≈ 111,320 * cos(lat) m
const STEP_METERS = 5;
const LAT_PER_METER = 1 / 111320;

interface UseUserLocationResult {
  location: UserLocation | null;
  permissionGranted: boolean;
  simMode: boolean;
  following: boolean;
  toggleFollowing: () => void;
  requestPermission: () => Promise<void>;
  // Simulated movement — only active when simMode is true
  startSim: (initialLon: number, initialLat: number) => void;
  moveSimulated: (dir: "north" | "south" | "east" | "west") => void;
}

export function useUserLocation(): UseUserLocationResult {
  const [location, setLocation] = useState<UserLocation | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [simMode, setSimMode] = useState(false);
  const [following, setFollowing] = useState(false);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  // Keep a ref so moveSimulated always has the latest position
  const locationRef = useRef<UserLocation | null>(null);

  const setLoc = useCallback((loc: UserLocation) => {
    locationRef.current = loc;
    setLocation(loc);
  }, []);

  const startWatching = useCallback(async () => {
    if (subscriptionRef.current) return;
    subscriptionRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1000,
        distanceInterval: 0.5,
      },
      (loc) => {
        setLoc({
          longitude: loc.coords.longitude,
          latitude: loc.coords.latitude,
          accuracy: loc.coords.accuracy,
          heading: loc.coords.heading ?? null,
        });
      }
    );
  }, [setLoc]);

  const requestPermission = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === "granted") {
      setPermissionGranted(true);
      setFollowing(true);
      await startWatching();
    }
  }, [startWatching]);

  // Check existing permission on mount
  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === "granted") {
        setPermissionGranted(true);
        await startWatching();
      }
    })();
    return () => {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [startWatching]);

  const toggleFollowing = useCallback(() => {
    setFollowing((f) => !f);
  }, []);

  // ── Simulated movement ────────────────────────────────────────────────────
  const startSim = useCallback((initialLon: number, initialLat: number) => {
    setSimMode(true);
    setFollowing(true);
    setLoc({ longitude: initialLon, latitude: initialLat, accuracy: 3, heading: null });
  }, [setLoc]);

  const moveSimulated = useCallback((dir: "north" | "south" | "east" | "west") => {
    const cur = locationRef.current;
    if (!cur) return;
    const lonPerMeter = LAT_PER_METER / Math.cos((cur.latitude * Math.PI) / 180);
    const step = STEP_METERS;
    let { longitude, latitude } = cur;
    if (dir === "north")  latitude  += step * LAT_PER_METER;
    if (dir === "south")  latitude  -= step * LAT_PER_METER;
    if (dir === "east")   longitude += step * lonPerMeter;
    if (dir === "west")   longitude -= step * lonPerMeter;
    const newLocation = { longitude, latitude, accuracy: 3, heading: null };
    console.log(`📍 Simulated move ${dir}: [${longitude.toFixed(6)}, ${latitude.toFixed(6)}]`);
    setLoc(newLocation);
  }, [setLoc]);

  return {
    location,
    permissionGranted,
    simMode,
    following,
    toggleFollowing,
    requestPermission,
    startSim,
    moveSimulated,
  };
}
