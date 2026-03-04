import { useEffect, useMemo, useState } from "react";
import type { PlanInfo, PlanInfoResponse } from "./types";
import { TILE_SERVER, DEFAULT_CENTER } from "./constants";

export function usePlanData() {
  const [planData, setPlanData] = useState<PlanInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activePlanId, setActivePlanId] = useState<string | null>(null);

  // Fetch plan info from server
  useEffect(() => {
    (async () => {
      try {
        const resp = await fetch(`${TILE_SERVER}/plan-info`);
        const data: PlanInfoResponse = await resp.json();
        setPlanData(data);
        if (data.plans.length > 0) {
          const firstId = data.plans[0].id;
          setActivePlanId(firstId);
        }
      } catch (err) {
        console.warn("Failed to fetch plan info:", err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const activePlan = useMemo(
    () => planData?.plans.find((p) => p.id === activePlanId) ?? null,
    [planData, activePlanId]
  );

  const mapCenter = useMemo<[number, number]>(
    () => activePlan?.center ?? planData?.center ?? DEFAULT_CENTER,
    [activePlan, planData]
  );

  return {
    planData,
    loading,
    activePlanId,
    setActivePlanId,
    activePlan,
    mapCenter,
  };
}
