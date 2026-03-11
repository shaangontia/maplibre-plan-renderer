import type { Plan, Bounds } from "../types";
export declare function readDb(): Plan[];
export declare function writeDb(plans: Plan[]): void;
export declare function getBounds(plan: Plan): Bounds;
export declare function getCenter(plan: Plan): [number, number];
export declare function findPlanById(id: string): Plan | undefined;
export declare function findPlanIndex(id: string): {
    plans: Plan[];
    idx: number;
};
//# sourceMappingURL=plans.d.ts.map