import { useState, useEffect } from "react";
import { Dimensions, ScaledSize } from "react-native";

export type Orientation = "portrait" | "landscape";

function getOrientation(screen: ScaledSize): Orientation {
  return screen.width > screen.height ? "landscape" : "portrait";
}

function getIsTablet(screen: ScaledSize): boolean {
  const shortest = Math.min(screen.width, screen.height);
  return shortest >= 600;
}

interface OrientationInfo {
  orientation: Orientation;
  isTablet: boolean;
}

export function useOrientation(): OrientationInfo {
  const [info, setInfo] = useState<OrientationInfo>(() => {
    const win = Dimensions.get("window");
    return { orientation: getOrientation(win), isTablet: getIsTablet(win) };
  });

  useEffect(() => {
    const sub = Dimensions.addEventListener("change", ({ window }) => {
      setInfo({ orientation: getOrientation(window), isTablet: getIsTablet(window) });
    });
    return () => sub.remove();
  }, []);

  return info;
}
