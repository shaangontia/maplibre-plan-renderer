import type { Coord } from "./types";

const DEG2RAD = Math.PI / 180;

export function haversineDistance(a: Coord, b: Coord): number {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;
  const R = 6371000;
  const dLat = (lat2 - lat1) * DEG2RAD;
  const dLon = (lon2 - lon1) * DEG2RAD;
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h =
    sinLat * sinLat +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) * sinLon * sinLon;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function polygonAreaSqM(coords: Coord[]): number {
  if (coords.length < 3) return 0;
  const R = 6371000;
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    const j = (i + 1) % coords.length;
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[j];
    total +=
      (lon2 - lon1) * DEG2RAD * (2 + Math.sin(lat1 * DEG2RAD) + Math.sin(lat2 * DEG2RAD));
  }
  return Math.abs((total * R * R) / 2);
}

export function formatDistance(m: number): string {
  if (m < 1) return `${(m * 100).toFixed(0)} cm`;
  if (m < 1000) return `${m.toFixed(2)} m`;
  return `${(m / 1000).toFixed(3)} km`;
}

export function formatArea(sqm: number): string {
  if (sqm < 1) return `${(sqm * 10000).toFixed(0)} cm\u00B2`;
  if (sqm < 10000) return `${sqm.toFixed(2)} m\u00B2`;
  return `${(sqm / 10000).toFixed(3)} ha`;
}

export function centroid(coords: Coord[]): Coord {
  let lon = 0;
  let lat = 0;
  for (const c of coords) {
    lon += c[0];
    lat += c[1];
  }
  return [lon / coords.length, lat / coords.length];
}

export function midpoint(a: Coord, b: Coord): Coord {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

export function perimeterDistance(coords: Coord[]): number {
  let total = 0;
  for (let i = 0; i < coords.length; i++) {
    total += haversineDistance(coords[i], coords[(i + 1) % coords.length]);
  }
  return total;
}

let _uid = 0;
export function uid(): string {
  return `${Date.now()}-${++_uid}`;
}
