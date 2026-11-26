import React, { useState } from "react";
import { View, Pressable, FlatList, ActivityIndicator, StyleSheet, useWindowDimensions } from "react-native";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { colors } from "@/common/theme/colors";
import { useNotifications } from "@/common/providers/NotificationsProvider";
import { Notification } from "@/common/services/notificationService";

export function NotificationList() {
  const { items, markRead, loadMore, hasMore, loadingMore } = useNotifications();
  // BottomSheetModal has no definite height (hugs content up to maxHeightPct), so compute the list cap from the window.
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
        style={{ maxHeight: listMaxHeight }}
        nestedScrollEnabled
        data={items}
        keyExtractor={(n) => String(n.id)}
        renderItem={renderItem}
        showsVerticalScrollIndicator={false}
        onEndReachedThreshold={0.4}
        onEndReached={() => loadMore()}
        // Android's default true causes the list to go unresponsive after content changes + remount.
        removeClippedSubviews={false}
        ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.brandDeep} style={{ marginVertical: 12 }} /> : undefined}
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
