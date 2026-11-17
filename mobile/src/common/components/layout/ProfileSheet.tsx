import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { View } from "react-native";
import { C, ConfirmSheet, Sheet, SheetListItem, Txt, Avatar } from "@/common/components/ui";
import { ThemeDropdown } from "@/common/components/ui/ThemeDropdown";
import { useAuth } from "@/common/providers/AuthProvider";
import { useTheme } from "@/common/theme/ThemeProvider";
import { SWITCHABLE_BRANCHES_KEY, useBranchSwitch } from "@/common/hooks/use-branch-switch";

type ProfileSheetProps = { visible: boolean; onClose: () => void };

// One row of the branch dropdown: a branch, or null id for "All branches".
type BranchChoice = { id: number | null; name: string };
const ALL_BRANCHES: BranchChoice = { id: null, name: "All branches" };

// ---------------------------------------------------------------------------
// Profile (tap on the dashboard avatar) — sign out lives here.
// ---------------------------------------------------------------------------
export function ProfileSheet({ visible, onClose }: ProfileSheetProps) {
  const { employee, signOut, exitBusiness } = useAuth();
  const { businessName } = useTheme();
  // Unlike Sign out (which keeps the business, so the next sign-in goes
  // straight to its login page), this also forgets the business and sends
  // the app back to the "enter a business" screen (app/(auth)/connect.tsx).
  // Confirmed in the app's own sheet, not a native Alert.
  const [confirmExit, setConfirmExit] = useState(false);
  const branchSwitch = useBranchSwitch();
  // Branches can be added or changed elsewhere (the web app, another device): ask the backend for the current list
  // every time the sheet opens, so the dropdown never shows a stale one.
  const qc = useQueryClient();
  useEffect(() => {
    if (visible) qc.invalidateQueries({ queryKey: SWITCHABLE_BRANCHES_KEY });
  }, [visible, qc]);
  const choices: BranchChoice[] = [ALL_BRANCHES, ...branchSwitch.branches.map((b) => ({ id: b.id, name: b.name }))];
  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Profile" maxHeightPct={branchSwitch.visible ? 65 : 50}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
          <Avatar name={employee?.name} size={44} radius={13} fontSize={15} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: "700", fontSize: 15 }}>{employee?.name}</Txt>
            <Txt style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {[employee?.role, (employee as { branch?: { name: string } } | null)?.branch?.name, businessName].filter(Boolean).join(" · ")}
            </Txt>
          </View>
        </View>
        {/* Administrator / Management on a multi-branch business only: narrows every list in the app. */}
        {branchSwitch.visible ? (
          <View style={{ paddingBottom: 12 }}>
            <Txt style={{ fontSize: 12, fontWeight: "600", color: C.muted, marginBottom: 6 }}>Branch</Txt>
            {/* Opens upward over the sheet like the app's other dropdowns, so the sheet never has to grow. */}
            <ThemeDropdown<BranchChoice>
              openUp
              maxHeight={230}
              value={choices.find((c) => c.id === branchSwitch.selectedBranchId) ?? ALL_BRANCHES}
              options={choices}
              keyOf={(c) => c.id ?? "all"}
              labelOf={(c) => c.name}
              onChange={(c) => {
                // Close first and apply once the sheet's animation is done: the switch re-renders and refetches
                // the screens behind it, which would otherwise make the sheet stutter.
                onClose();
                if (c.id !== branchSwitch.selectedBranchId) setTimeout(() => branchSwitch.select(c.id), 300);
              }}
            />
          </View>
        ) : null}
        <SheetListItem
          icon="logout"
          title="Sign out"
          sub="End this session on this device"
          warn
          onPress={() => {
            onClose();
            signOut();
          }}
        />
        <SheetListItem icon="home" title="Exit business" sub={`Disconnect ${businessName} from this device`} warn onPress={() => setConfirmExit(true)} />
      </Sheet>
      <ConfirmSheet
        visible={visible && confirmExit}
        onClose={() => setConfirmExit(false)}
        title="Exit business?"
        message="Scan QR or enter code to sign in."
        confirmLabel="Exit business"
        danger
        onConfirm={() => {
          setConfirmExit(false);
          onClose();
          exitBusiness();
        }}
      />
    </>
  );
}
