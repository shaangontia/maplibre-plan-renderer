import fs from "fs";
import { DB_PATH } from "../config";
import type { Plan, Bounds, Corners } from "../types";

export function readDb(): Plan[] {
  if (!fs.existsSync(DB_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function writeDb(plans: Plan[]): void {
  fs.writeFileSync(DB_PATH, JSON.stringify(plans, null, 2));
}

export function getBounds(plan: Plan): Bounds {
  const c = plan.corners;
  const lons = [c.topLeft[0], c.topRight[0], c.bottomRight[0], c.bottomLeft[0]];
  const lats = [c.topLeft[1], c.topRight[1], c.bottomRight[1], c.bottomLeft[1]];
  return {
    sw: [Math.min(...lons), Math.min(...lats)],
    ne: [Math.max(...lons), Math.max(...lats)],
  };
}

export function getCenter(plan: Plan): [number, number] {
  const c = plan.corners;
  return [
    (c.topLeft[0] + c.topRight[0] + c.bottomRight[0] + c.bottomLeft[0]) / 4,
    (c.topLeft[1] + c.topRight[1] + c.bottomRight[1] + c.bottomLeft[1]) / 4,
  ];
}

export function findPlanById(id: string): Plan | undefined {
  return readDb().find((p) => p.id === id);
}

export function findPlanIndex(id: string): { plans: Plan[]; idx: number } {
  const plans = readDb();
  const idx = plans.findIndex((p) => p.id === id);
  return { plans, idx };
}
