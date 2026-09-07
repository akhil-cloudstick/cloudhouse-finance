import React, { useState } from "react";
import { View, Pressable, FlatList, ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import { ThemedText } from "./ThemedText";
import { BottomSheetModal } from "./BottomSheetModal";
import { colors } from "../theme/colors";
import { useNotifications } from "../notifications/NotificationsContext";
import { Notification } from "../api/notifications";

// The bell modal's real content, replacing every screen's
// <ComingSoon title="Notifications" /> stub. Reads from the shared
// NotificationsContext (mounted once at app root — see app/_layout.tsx) so
// every screen's bell shows the exact same live list, newest first.
//
// A FlatList rather than a ScrollView so history pages in as the customer
// scrolls (onEndReached -> loadMore(), see NotificationsContext.tsx) instead
// of being capped at whatever the first fetch returned. It only actually
// scrolls now that BottomSheetModal.tsx's drag-to-close handle no longer
// captures every touch on the sheet — previously the outer PanResponder
// claimed any vertical drag before this list ever saw it, which is why only
// the first ~4 rows (whatever fit before the eye had to scroll) were ever
// reachable.
//
// Each row shows a gold unread dot for `!n.read` — server-truth state (see
// NotificationsContext's doc comment), not a client-side watermark. Tapping
// a row opens NotificationDetailModal (below) with its full title/body and
// marks it read via markRead(), which optimistically flips the row and fires
// POST /customer/notifications/:id/read in the background.
export function NotificationList() {
  const { items, markRead, loadMore, hasMore, loadingMore } = useNotifications();
  // The hosting BottomSheetModal caps itself at maxHeightPct={60} but has no
  // *definite* height (it hugs its content up to that cap), so flex sizing
  // inside it has nothing concrete to shrink against. Computing the list's
  // height from the window instead guarantees it fits: 60% of the screen
  // minus the sheet's own chrome (drag handle, "Notifications" title, the
  // footer line, and the sheet's vertical padding).
  const { height: windowHeight } = useWindowDimensions();
  const listMaxHeight = Math.max(200, windowHeight * 0.6 - 150);

  const [selected, setSelected] = useState<Notification | null>(null);

  function openNotification(n: Notification) {
    if (!n.read) markRead(n.id);
    setSelected(n);
  }

  function renderItem({ item: n }: { item: Notification }) {
    return (
      <Pressable onPress={() => openNotification(n)} style={styles.row}>
        <View style={styles.titleRow}>
          {!n.read ? <View style={styles.unreadDot} /> : null}
          <ThemedText variant="body" style={{ flex: 1 }}>
            {n.title}
          </ThemedText>
        </View>
        <ThemedText variant="small" color={colors.muted} style={{ marginTop: 2 }} numberOfLines={2}>
          {n.body}
        </ThemedText>
        <ThemedText variant="small" color={colors.muted} style={{ marginTop: 4 }}>
          {new Date(n.createdAt).toLocaleString("en-IN")}
        </ThemedText>
      </Pressable>
    );
  }

  return (
    <View>
      <ThemedText variant="h3" style={{ marginBottom: 12 }}>
        Notifications
      </ThemedText>
      <FlatList
        // Derived from the window rather than a fixed 480 (which could exceed
        // the sheet's own 60% cap on shorter screens, pushing the list's lower
        // half outside the sheet's bounds — where Android stops delivering
        // touches to it at all).
        style={{ maxHeight: listMaxHeight }}
        nestedScrollEnabled
        data={items}
        keyExtractor={(n) => String(n.id)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => loadMore()}
        // Android defaults this to true, and it's a known cause of a
        // FlatList going unresponsive to touch after its content changes
        // dynamically (loadMore appending a page right as onEndReached
        // fires) and the list is then unmounted/remounted (closing and
        // reopening this sheet) — clipped-subview bookkeeping doesn't
        // reliably recover across that combination. Off entirely here since
        // this list is short (paged 20 at a time, capped at ~6 visible
        // rows), so there's no meaningful perf cost to losing the
        // off-screen-view-recycling optimization it provides.
        removeClippedSubviews={false}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.brandDeep} style={{ marginVertical: 12 }} /> : null}
        ListEmptyComponent={
          <ThemedText variant="small" color={colors.muted}>
            No notifications yet.
          </ThemedText>
        }
      />
      {!hasMore && items.length > 0 ? (
        <ThemedText variant="small" color={colors.muted} style={{ textAlign: "center", marginTop: 8 }}>
          No more notifications
        </ThemedText>
      ) : null}

      {/* Stacks on top of the list's own BottomSheetModal (see the tab
          screens' <BottomSheetModal><NotificationList/></BottomSheetModal>)
          — SheetHost keys sheets by their own generated id, so two open at
          once is fine. dragToClose is left on (default) since this one has
          no inner scrollable to fight over touches with. */}
      <BottomSheetModal visible={!!selected} onClose={() => setSelected(null)} maxHeightPct={50}>
        {selected ? (
          <View style={{ paddingBottom: 8 }}>
            <ThemedText variant="h3" style={{ marginBottom: 8 }}>
              {selected.title}
            </ThemedText>
            <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 12 }}>
              {new Date(selected.createdAt).toLocaleString("en-IN")}
            </ThemedText>
            <ThemedText variant="body">{selected.body}</ThemedText>
          </View>
        ) : null}
      </BottomSheetModal>
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
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.brandDeep,
  },
});
