import React, { useEffect, useRef } from "react";
import { View, FlatList, ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import { ThemedText } from "./ThemedText";
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
  const { items, lastViewedAt, viewedWatermarkReady, markViewed, persistViewedNow, loadMore, hasMore, loadingMore } =
    useNotifications();
  // The hosting BottomSheetModal caps itself at maxHeightPct={60} but has no
  // *definite* height (it hugs its content up to that cap), so flex sizing
  // inside it has nothing concrete to shrink against. Computing the list's
  // height from the window instead guarantees it fits: 60% of the screen
  // minus the sheet's own chrome (drag handle, "Notifications" title, the
  // footer line, and the sheet's vertical padding).
  const { height: windowHeight } = useWindowDimensions();
  const listMaxHeight = Math.max(200, windowHeight * 0.6 - 150);
  // Captured lazily rather than via useRef(lastViewedAt) — that would freeze
  // at whatever lastViewedAt happened to be on this component's very first
  // render, which is `null` if the sheet is opened before
  // NotificationsContext's async SecureStore read resolves (e.g. right
  // after an app reload). That null looks identical to "never viewed
  // anything," so every notification rendered as "NEW" every time,
  // regardless of what was actually persisted last close. Waiting for
  // viewedWatermarkReady before locking in the cutoff fixes that.
  const viewedAtOpenRef = useRef<Date | null>(null);
  const capturedRef = useRef(false);
  if (viewedWatermarkReady && !capturedRef.current) {
    viewedAtOpenRef.current = lastViewedAt;
    capturedRef.current = true;
  }

  useEffect(() => {
    return () => {
      // The disk write happens right here, synchronously at unmount — so it
      // survives even if the app is backgrounded/killed a moment later
      // (e.g. the user closes the sheet and immediately swipes the app
      // away). Only the React state update is deferred: markViewed()
      // updates NotificationsContext, which is mounted at the app root —
      // every consumer of useNotifications() (every screen's FloatingHeader
      // bell) re-renders when it fires. Doing that synchronously during
      // this component's unmount collided with the BottomSheetModal's own
      // slide-down close animation (still playing at this exact moment),
      // producing a visible flicker right as the sheet closed. Pushing it
      // a beat past the close transition lets the animation finish
      // untouched first — and since the write already landed, losing this
      // deferred call to a backgrounded JS thread just means a slightly
      // stale badge, not a lost "seen" state.
      persistViewedNow();
      setTimeout(markViewed, 300);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cutoff = viewedAtOpenRef.current;

  function renderItem({ item: n }: { item: Notification }) {
    // While the watermark hasn't loaded yet, don't guess — showing nothing
    // as "NEW" for a beat is better than flashing every row as new and
    // then having most of them un-flag once the real cutoff lands.
    const isNew = capturedRef.current && (!cutoff || new Date(n.createdAt) > cutoff);
    return (
      <View style={styles.row}>
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
        // Diagnostic hooks for the "scroll dies after reopening" report —
        // these log the list's real geometry so we can see whether the
        // viewport/content sizes on the second open differ from the first.
        onLayout={(e) => console.log("[notif] list viewport h=", e.nativeEvent.layout.height)}
        onContentSizeChange={(w, h) => console.log("[notif] content h=", h)}
        onScroll={(e) => console.log("[notif] offsetY=", e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={100}
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
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.goldDeep} style={{ marginVertical: 12 }} /> : null}
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
