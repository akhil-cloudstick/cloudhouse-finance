import React from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { C, Card, FlatHeader, PIcon, PScroll, PrimaryButton, Screen, Txt, toast } from "@/common/components/ui";

// Edit these two to change what Support shows. An empty SUPPORT_PHONE shows a "not added yet"
// placeholder and hides the Call button.
export const SUPPORT_EMAIL = "support@cloudhousetechnologies.com";
export const SUPPORT_PHONE: string = "";

function open(url: string) {
  Linking.openURL(url).catch(() => toast.error("Couldn't open that on this device"));
}

// Support — reached from More; open to every signed-in user.
export default function SupportScreen() {
  const header = <FlatHeader title="Support" subtitle="We're here to help" />;
  return (
    <Screen header={header}>
      <PScroll contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 14, gap: 12 }}>
        <Card>
          <Txt style={s.body}>Need help? Contact our support team for any questions or issues.</Txt>
          <Pressable
            style={s.row}
            accessibilityRole="link"
            onPress={() => open(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Support request")}`)}
          >
            <PIcon name="mail" color={C.brandDeep} size={18} />
            <Txt style={s.val}>{SUPPORT_EMAIL}</Txt>
          </Pressable>
          <View style={s.row}>
            <PIcon name="phone" color={C.brandDeep} size={18} />
            <Txt style={[s.val, !SUPPORT_PHONE && { opacity: 0.6 }]}>{SUPPORT_PHONE || "Not added yet"}</Txt>
          </View>
          {SUPPORT_PHONE ? (
            <View style={{ marginTop: 16 }}>
              <PrimaryButton variant="outline" label="Call" onPress={() => open(`tel:${SUPPORT_PHONE.replace(/[^\d+]/g, "")}`)} />
            </View>
          ) : null}
        </Card>
      </PScroll>
    </Screen>
  );
}

const s = StyleSheet.create({
  body: { fontSize: 14, lineHeight: 20 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14 },
  val: { fontSize: 14, flex: 1 },
});
