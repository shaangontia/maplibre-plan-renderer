import React from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import type { PlanInfo, PlanInfoResponse } from "./types";

interface PlanDropdownProps {
  planData: PlanInfoResponse | null;
  activePlanId: string | null;
  activePlan: PlanInfo | null;
  dropdownOpen: boolean;
  setDropdownOpen: (open: boolean) => void;
  onSelectPlan: (plan: PlanInfo) => void;
  compact?: boolean;
}

export default function PlanDropdown({
  planData,
  activePlanId,
  activePlan,
  dropdownOpen,
  setDropdownOpen,
  onSelectPlan,
  compact,
}: PlanDropdownProps) {
  return (
    <>
      {/* Plan dropdown trigger */}
      {planData && planData.plans.length > 0 && (
        <TouchableOpacity
          style={styles.dropdownTrigger}
          onPress={() => setDropdownOpen(true)}
        >
          <Text style={styles.dropdownTriggerText} numberOfLines={1}>
            {activePlan ? activePlan.name : "Select plan..."}
          </Text>
          <Text style={styles.dropdownArrow}>{"\u25BC"}</Text>
        </TouchableOpacity>
      )}

      {!compact && activePlan?.site && (
        <Text style={styles.sub}>{activePlan.site}</Text>
      )}

      {/* Plan dropdown modal */}
      <Modal
        visible={dropdownOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setDropdownOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDropdownOpen(false)}
        >
          <View style={styles.dropdownMenu}>
            <Text style={styles.dropdownTitle}>Select Plan</Text>
            <ScrollView style={styles.dropdownScroll}>
              {planData?.plans.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  style={[
                    styles.dropdownItem,
                    activePlanId === plan.id && styles.dropdownItemActive,
                  ]}
                  onPress={() => onSelectPlan(plan)}
                >
                  <View style={styles.dropdownItemContent}>
                    <Text
                      style={[
                        styles.dropdownItemName,
                        activePlanId === plan.id && styles.dropdownItemNameActive,
                      ]}
                      numberOfLines={1}
                    >
                      {plan.name}
                    </Text>
                    {plan.site && (
                      <Text style={styles.dropdownItemSite} numberOfLines={1}>
                        {plan.site}
                      </Text>
                    )}
                  </View>
                  {activePlanId === plan.id && (
                    <Text style={styles.dropdownCheck}>{"\u2713"}</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  sub: { fontSize: 11, color: "#888", marginTop: 2 },

  dropdownTrigger: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "#f5f5f5", borderRadius: 8, borderWidth: 1, borderColor: "#ddd",
    paddingHorizontal: 12, paddingVertical: 8, marginTop: 6,
  },
  dropdownTriggerText: { fontSize: 13, fontWeight: "600", color: "#333", flex: 1 },
  dropdownArrow: { fontSize: 10, color: "#888", marginLeft: 8 },

  modalOverlay: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-start", paddingTop: 120,
  },
  dropdownMenu: {
    marginHorizontal: 20, backgroundColor: "#fff",
    borderRadius: 12, maxHeight: 360,
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25, shadowRadius: 12, elevation: 8,
  },
  dropdownTitle: {
    fontSize: 14, fontWeight: "700", color: "#333",
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: "#eee",
  },
  dropdownScroll: { maxHeight: 300 },
  dropdownItem: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "#f5f5f5",
  },
  dropdownItemActive: { backgroundColor: "#EBF5FF" },
  dropdownItemContent: { flex: 1 },
  dropdownItemName: { fontSize: 14, fontWeight: "600", color: "#333" },
  dropdownItemNameActive: { color: "#007AFF" },
  dropdownItemSite: { fontSize: 11, color: "#888", marginTop: 2 },
  dropdownCheck: { fontSize: 16, color: "#007AFF", fontWeight: "700" },
});
