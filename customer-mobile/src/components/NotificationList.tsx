import React, { useEffect, useRef } from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { ThemedText } from "./ThemedText";
import { colors } from "../theme/colors";
import { useNotifications } from "../notifications/NotificationsContext";

// The bell modal's real content, replacing every screen's
// <ComingSoon title="Notifications" /> stub. Reads from the shared
// NotificationsContext (mounted once at app root — see app/_layout.tsx) so
// every screen's bell shows the exact same live list, newest first.
//
// Renders a "New" tag on any notification newer than lastViewedAt — a
// watermark that only advances when this component unmounts (i.e. the
// BottomSheetModal hosting it closes, since BottomSheetModal.tsx tears its
// children down entirely when `visible` goes false — see its sheetStore
// usage). This is deliberately separate from the bell icon's badge count
// (which clears the instant the bell is opened, in FloatingHeader.tsx): the
// "New" tag stays visible for the whole time a sheet is open, so items you
// haven't actually looked at yet stay distinguishable from ones you saw and
// dismissed in an earlier session, even after the badge itself is gone.
export function NotificationList() {
  const { items, lastViewedAt, markViewed } = useNotifications();
  const viewedAtOpenRef = useRef(lastViewedAt);

  useEffect(() => {
    return () => {
      // Deferred rather than called inline: markViewed() updates
      // NotificationsContext, which is mounted at the app root — every
      // consumer of useNotifications() (every screen's FloatingHeader bell)
      // re-renders when it fires. Doing that synchronously during this
      // component's unmount collided with the BottomSheetModal's own
      // slide-down close animation (still playing at this exact moment),
      // producing a visible flicker right as the sheet closed. Pushing it
      // a beat past the close transition lets the animation finish
      // untouched first.
      setTimeout(markViewed, 300);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cutoff = viewedAtOpenRef.current;

  return (
    <View>
      <ThemedText variant="h3" style={{ marginBottom: 12 }}>
        Notifications
      </ThemedText>
      <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
        {items.length ? (
          items.map((n) => {
            const isNew = !cutoff || new Date(n.createdAt) > cutoff;
            return (
              <View key={n.id} style={styles.row}>
                <View style={styles.titleRow}>
                  <ThemedText variant="body" style={{ flex: 1 }}>
                    {n.title}
                  </ThemedText>
                  {isNew ? (
                    <View style={styles.newTag}>
                      <ThemedText variant="label" color={colors.card} style={styles.newTagText}>
                        NEW
                      </ThemedText>
                    </View>
                  ) : null}
                </View>
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 2 }}>
                  {n.body}
                </ThemedText>
                <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
                  {new Date(n.createdAt).toLocaleString("en-IN")}
                </ThemedText>
              </View>
            );
          })
        ) : (
          <ThemedText variant="small" color={colors.muted}>
            No notifications yet.
          </ThemedText>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  newTag: {
    backgroundColor: colors.goldDeep,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  newTagText: { fontSize: 9, lineHeight: 11 },
});
