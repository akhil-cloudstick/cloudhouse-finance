import { useState } from "react";
import { View } from "react-native";
import { C, ConfirmSheet, Sheet, SheetListItem, Txt, Avatar } from "@/common/components/ui";
import { useAuth } from "@/common/providers/AuthProvider";
import { useTheme } from "@/common/theme/ThemeProvider";

type ProfileSheetProps = { visible: boolean; onClose: () => void };

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
  return (
    <>
      <Sheet visible={visible} onClose={onClose} title="Profile" maxHeightPct={50}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }}>
          <Avatar name={employee?.name} size={44} radius={13} fontSize={15} />
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: "700", fontSize: 15 }}>{employee?.name}</Txt>
            <Txt style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {[employee?.role, (employee as { branch?: { name: string } } | null)?.branch?.name, businessName].filter(Boolean).join(" · ")}
            </Txt>
          </View>
        </View>
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
        message={`You'll be signed out and need to scan ${businessName}'s QR code (or enter its business code) again to sign in.`}
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
