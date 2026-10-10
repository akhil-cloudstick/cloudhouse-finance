import React from "react";
import { usePullRefresh } from "@/common/hooks/use-pull-refresh";
import { FlatList, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetFlatList } from "./SheetFlatList";
import { pullRefreshControl } from "./base";
import { EmptyText } from "./EmptyText";
import { Buffering } from "./Buffering";
import { AccRowKey } from "./rowContext";
import { AccGroup } from "./AccGroup";
import { PCONTENT_BOTTOM, tabBarLift } from "@/common/theme/layout";
import { loadErrorText } from "@/common/services/apiErrors";

type ListState = {
  isLoading: boolean;
  isRefreshing: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  error?: unknown;
};
type ServerFlatListProps<T> = {
  list: ListState;
  items: T[];
  renderItem: (item: T, index: number) => React.ReactElement | null;
  keyOf: (item: T, index: number) => string;
  header?: React.ReactElement | null;
  emptyText: string;
  /** Horizontal gutter around rows (.table-container). */
  gutter?: number;
  /** Render inside a bottom sheet (cooperates with drag-to-close). */
  inSheet?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  stickyHeaderIndices?: number[];
};

/**
 * Server-paged list for a page body: renders `header` (search, filters,
 * tabs…) scrolling with the rows, the rows themselves inside the table
 * gutter, a centred buffering spinner while loading / re-querying, a footer
 * spinner while the next page loads, and the prototype's empty text.
 */
export function ServerFlatList<T>({
  list,
  items,
  renderItem,
  keyOf,
  header,
  emptyText,
  gutter = 18,
  inSheet,
  contentStyle,
  stickyHeaderIndices,
}: ServerFlatListProps<T>) {
  const insets = useSafeAreaInsets();
  const { pullRefreshing, onPull } = usePullRefresh(list.isRefreshing, list.refetch);
  const reloading = (list.isLoading && items.length > 0) || pullRefreshing;
  const ListComp = (inSheet ? SheetFlatList : FlatList) as typeof FlatList;
  const errorText = loadErrorText(list.error);
  return (
    // One row open at a time across the whole list.
    <AccGroup>
    <ListComp
      data={list.isLoading && items.length === 0 ? [] : items}
      keyExtractor={(it, i) => keyOf(it as T, i)}
      renderItem={({ item, index }) => (
        <AccRowKey.Provider value={keyOf(item as T, index)}>
          <View style={{ paddingHorizontal: gutter, opacity: reloading ? 0.45 : 1 }}>{renderItem(item as T, index)}</View>
        </AccRowKey.Provider>
      )}
      ListHeaderComponent={
        <>
          {header}
          {reloading ? <Buffering style={{ paddingVertical: 10 }} /> : null}
        </>
      }
      stickyHeaderIndices={stickyHeaderIndices}
      ListEmptyComponent={
        list.isLoading ? (
          <Buffering block />
        ) : errorText ? (
          <EmptyText>{errorText}</EmptyText>
        ) : (
          <EmptyText>{emptyText}</EmptyText>
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <Buffering /> : null}
      onEndReached={list.fetchNextPage}
      onEndReachedThreshold={0.4}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        inSheet || !onPull ? undefined : pullRefreshControl(pullRefreshing, onPull)
      }
      contentContainerStyle={[inSheet ? { paddingBottom: 24 } : { paddingBottom: PCONTENT_BOTTOM + tabBarLift(insets.bottom) }, contentStyle]}
    />
    </AccGroup>
  );
}
