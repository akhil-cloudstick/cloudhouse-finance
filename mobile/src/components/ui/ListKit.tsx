import React, { useState } from "react";
import { FlatList, RefreshControl, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SheetFlatList } from "../BottomSheetModal";
import { Buffering, C, EmptyText, Txt } from "./base";
import { PCONTENT_BOTTOM } from "../../theme/layout";

/** .local-search-input — every page's search box (server `q`). */
export function SearchInput({
  value,
  onChangeText,
  placeholder,
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.searchWrap, style]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.muted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        allowFontScaling={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[s.search, focused && { borderColor: C.brand }]}
      />
    </View>
  );
}

type ListState = {
  isLoading: boolean;
  isRefreshing: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage: () => void;
  refetch: () => void;
  error?: unknown;
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
}: {
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
}) {
  const insets = useSafeAreaInsets();
  const reloading = list.isLoading && items.length > 0;
  const ListComp = (inSheet ? SheetFlatList : FlatList) as typeof FlatList;
  return (
    <ListComp
      data={list.isLoading && items.length === 0 ? [] : items}
      keyExtractor={(it, i) => keyOf(it as T, i)}
      renderItem={({ item, index }) => <View style={{ paddingHorizontal: gutter, opacity: reloading ? 0.45 : 1 }}>{renderItem(item as T, index)}</View>}
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
        ) : list.error ? (
          <EmptyText>Couldn't load. Pull down to retry.</EmptyText>
        ) : (
          <EmptyText>{emptyText}</EmptyText>
        )
      }
      ListFooterComponent={list.isFetchingNextPage ? <Buffering /> : null}
      onEndReached={list.fetchNextPage}
      onEndReachedThreshold={0.4}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        inSheet ? undefined : <RefreshControl refreshing={list.isRefreshing} onRefresh={list.refetch} tintColor={C.brandDeep} colors={[C.brandDeep]} />
      }
      contentContainerStyle={[inSheet ? { paddingBottom: 24 } : { paddingBottom: PCONTENT_BOTTOM + insets.bottom }, contentStyle]}
    />
  );
}

/** Muted count line ("312 customers") used above some lists. */
export function CountLine({ children }: { children: React.ReactNode }) {
  return <Txt style={s.count}>{children}</Txt>;
}

const s = StyleSheet.create({
  searchWrap: { paddingHorizontal: 18, paddingBottom: 10 },
  search: {
    width: "100%",
    paddingVertical: 10,
    paddingHorizontal: 13,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    backgroundColor: C.card,
    fontSize: 13,
    color: C.ink,
  },
  count: { paddingTop: 12, paddingHorizontal: 18, paddingBottom: 10, fontSize: 11.5, color: C.muted, fontWeight: "600" },
});
