import React, { useCallback, useEffect, useRef, useState } from "react";
import { usePullRefresh } from "@/common/hooks/use-pull-refresh";
import { FlatList, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetFlatList } from "./SheetFlatList";
import { C, pullRefreshControl } from "./base";
import { EmptyText } from "./EmptyText";
import { Buffering, ReloadBuffer } from "./Buffering";
import { AccRowKey, TableRowCtx, type TableHeadCol } from "./rowContext";
import { TableHead } from "./AccRow";
import { AccGroup } from "./AccGroup";
import { PCONTENT_BOTTOM, TABLE_MIN_WIDTH, tabBarLift, useColumnWidth } from "@/common/theme/layout";
import { loadErrorText } from "@/common/services/apiErrors";

type ListState = {
  isLoading: boolean;
  isRefreshing: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  /** Pull-to-refresh (first page only); falls back to refetch. */
  refresh?: () => void;
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
  /** Pin `header` (search / tabs) to the top while the rows scroll beneath it. */
  stickyHeader?: boolean;
  /** A row to scroll to once it is loaded (-1 or omitted: none). */
  focusIndex?: number;
  /** Scroll to this offset on mount (e.g. keep a tab bar in view when the list is swapped). */
  initialOffset?: number;
  /** When this changes (not on mount) the list scrolls back to `initialOffset` — e.g. the active tab of a persistent list. */
  scrollKey?: unknown;
};

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
  stickyHeader,
  focusIndex = -1,
  initialOffset,
  scrollKey,
}: ServerFlatListProps<T>) {
  const listRef = useRef<FlatList>(null);
  const scrolledTo = useRef(-1);
  useEffect(() => {
    if (focusIndex < 0 || scrolledTo.current === focusIndex) return;
    scrolledTo.current = focusIndex;
    const t = setTimeout(() => listRef.current?.scrollToIndex({ index: focusIndex, viewPosition: 0.25, animated: true }), 250);
    return () => clearTimeout(t);
  }, [focusIndex]);
  // Retry at increasing delays until content is tall enough to reach the offset.
  useEffect(() => {
    if (!initialOffset) return;
    const timers = [0, 80, 250, 600].map((ms) => setTimeout(() => listRef.current?.scrollToOffset({ offset: initialOffset, animated: false }), ms));
    return () => timers.forEach(clearTimeout);
  }, [initialOffset, scrollKey]);
  const insets = useSafeAreaInsets();
  // iPad-size and bigger: rows are drawn as a table (AccRow reads TableRowCtx), one row per line. Sheets keep cards.
  const colW = useColumnWidth();
  const table = !inSheet && colW >= TABLE_MIN_WIDTH;
  const cols = 1;
  // The table's column titles come from its first row and stay pinned above the scrolling rows.
  const [tableHead, setTableHead] = useState<TableHeadCol[] | null>(null);
  const publishHead = useCallback((c: TableHeadCol[]) => setTableHead((o) => (o && JSON.stringify(o) === JSON.stringify(c) ? o : c)), []);
  const headEl = table && tableHead ? (
    <View style={{ paddingHorizontal: gutter }}>
      <TableHead cols={tableHead} />
    </View>
  ) : null;
  const { pullRefreshing, onPull } = usePullRefresh(list.isRefreshing, list.refresh ?? list.refetch);
  const reloading = (list.isLoading && items.length > 0) || pullRefreshing;
  const ListComp = (inSheet ? SheetFlatList : FlatList) as typeof FlatList;
  const errorText = loadErrorText(list.error);
  return (
    <AccGroup>
    <ListComp
      ref={listRef}
      key={`cols-${cols}`}
      numColumns={cols}
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0.25, animated: true }), 150);
      }}
      data={list.isLoading && items.length === 0 ? [] : items}
      keyExtractor={(it, i) => keyOf(it as T, i)}
      renderItem={({ item, index }) => (
        <AccRowKey.Provider value={keyOf(item as T, index)}>
          <View style={{ paddingHorizontal: gutter }}>
            <TableRowCtx.Provider value={table ? { first: index === 0, last: index === items.length - 1, publishHead } : null}>{renderItem(item as T, index)}</TableRowCtx.Provider>
            {/* Dims the row while the list reloads. Fading the row itself (view opacity) made Android draw the
                cards' box-shadows as heavy grey slabs; a page-coloured veil over it leaves the shadows alone. */}
            {reloading ? <View pointerEvents="none" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg, opacity: 0.55 }} /> : null}
          </View>
        </AccRowKey.Provider>
      )}
      ListHeaderComponent={
        stickyHeader || table ? (
          <View style={{ backgroundColor: C.bg }}>
            {header}
            <ReloadBuffer active={reloading} />
            {headEl}
          </View>
        ) : (
          <>
            {header}
            <ReloadBuffer active={reloading} />
          </>
        )
      }
      stickyHeaderIndices={stickyHeader || table ? [0] : stickyHeaderIndices}
      ListEmptyComponent={
        list.isLoading || list.isRefreshing ? (
          <Buffering block />
        ) : errorText ? (
          <EmptyText>{errorText}</EmptyText>
        ) : (
          <EmptyText>{emptyText}</EmptyText>
        )
      }
      // The next page is asked for well before the end (threshold below), and its spinner waits a moment,
      // so scrolling down rarely shows a loader at the bottom — a fast page just appears.
      ListFooterComponent={list.isFetchingNextPage ? <Buffering delay={100} /> : undefined}
      onEndReached={list.fetchNextPage}
      onEndReachedThreshold={1.5}
      // Tables: no overscroll stretch / bounce. Reaching the end stretched the list, pinned search and column
      // titles included, so the gap under the page header grew and shrank like elastic.
      overScrollMode={table ? "never" : undefined}
      bounces={table ? false : undefined}
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
