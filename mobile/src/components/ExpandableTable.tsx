import React, { useState, ReactElement } from "react";
import { View, Pressable, StyleSheet, ViewStyle, FlatList, RefreshControlProps, ScrollView, ActivityIndicator } from "react-native";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

// `.Context` exists at runtime — VirtualizedList.js reads it via
// `ScrollView.Context.Consumer` to decide whether to fire "VirtualizedLists
// should never be nested inside plain ScrollViews" — but it isn't in RN's
// public types, hence the cast. Resetting it to null around our own FlatList
// (below) tells that check this FlatList is its own independent scroller,
// regardless of whatever ScrollView-like ancestor might sit above it on a
// given screen — every caller already gives this table a dedicated flex:1
// slot (see ExpandableTable's own doc comment) rather than nesting it inside
// another scroller, so the warning doesn't apply here.
const ScrollViewContextReset = (ScrollView as unknown as { Context: React.Context<unknown> }).Context.Provider;

// React Native has no <table> — this recreates one with flex rows instead:
// a header row of column labels, body rows matching the same flex weights
// (so everything lines up without ever needing horizontal scroll), a tap
// per row to expand a detail strip of whatever columns didn't fit plus any
// extra fields, and a "View Description" button that's the only thing that
// navigates. Mirrors the approved design mockup (mobile-table-preview
// artifact) — same 3-columns-for-a-"large"-table / 4-otherwise rule, same
// expand-strip-then-button interaction, same color tokens.
//
// Exported as two pieces (TableHeader/TableRow) rather than one component
// that owns its own list rendering: most of this app's list screens are
// already `FlatList`-driven infinite-scroll (useInfiniteQuery/onEndReached —
// see loans/index.tsx), so the table header goes in as `ListHeaderComponent`
// and TableRow as `renderItem`. Apply `tableCardStyle` to the FlatList's own
// `contentContainerStyle` — it wraps ListHeaderComponent + every item +
// ListFooterComponent in one View, so the border/shadow/rounded-corners
// read as a single card without TableHeader/TableRow needing to fake it
// piecemeal. `ExpandableTable` at the bottom is a small convenience wrapper
// for the handful of screens with an already-fully-loaded, non-paginated
// list, where there's no FlatList to hang that style on.
//
// Row expand/collapse below is a plain state toggle, deliberately NOT
// animated via LayoutAnimation.configureNext(): that API arms the *next*
// native layout pass for the ENTIRE screen, not just this row — tapping a
// row then scrolling the table (which triggers its own layout pass as new
// pages of items render in) could catch unrelated siblings, like the
// status-filter chip row above the table, in that same animated transition
// and briefly render them at an interpolated size (looked like a chip
// "shrinking" while scrolling). No per-component way to scope it, so it's
// not used here at all.

export type TableColumn<T> = {
  key: string;
  label: string;
  render: (row: T) => React.ReactNode;
  /** Relative width — matches table-layout:fixed's equal-share default
   * (weight 1) unless a column needs more room (e.g. a name column vs. a
   * short status pill). */
  weight?: number;
};

export type ExtraField = { label: string; value: React.ReactNode };

// Rough "is this table dense enough that 4 columns would crowd it" rule —
// callers pass their total field count (columns.length + however many
// extraFields each row carries) straight through: 3 visible past 6 total
// fields, 4 otherwise. Exported so every screen applies the same threshold
// instead of guessing per-screen.
export function defaultVisibleCount(totalFieldCount: number): number {
  return totalFieldCount > 6 ? 3 : 4;
}

const RADIUS = 16;

// Apply to a FlatList's `contentContainerStyle` (or wrap ExpandableTable's
// static case) — the border/shadow/rounded-corner card every table sits in.
//
// Deliberately NOT `overflow: "hidden"`: that's the usual way to clip square
// child corners to a rounded parent, but on iOS it also clips the shadow
// itself — a View can't crop its children's overflow while still painting a
// shadow that extends past its own bounds, since the shadow computation
// physically happens outside the box overflow:hidden is cutting at. So the
// header (styles.headRow) and whichever row/detail-strip ends up visually
// last (`isLast` below) carry their own top/bottom corner radius instead —
// nothing here needs clipping once the pieces already have the right shape.
// Bottom corners/border deliberately omitted — the card is left open at the
// bottom (no bottom border, no bottom rounding) so the last row just ends
// flush rather than closing into a rounded box.
export const tableCardStyle: ViewStyle = {
  borderWidth: 1,
  borderBottomWidth: 0,
  borderColor: colors.line,
  borderTopLeftRadius: RADIUS,
  borderTopRightRadius: RADIUS,
  backgroundColor: colors.card,
  // Flatter, quieter shadow — matches Card/GlassCard's own toned-down lift
  // from the approved modern/minimal mockups.
  shadowColor: colors.nav,
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

/** Column-label row — pass as a FlatList's `ListHeaderComponent`.
 *
 * `cardRows` switches to the "each row is its own floating card" layout
 * (see the mobile-table-preview artifact's "rows as cards" revision) — the
 * header no longer caps a single shared card, so it drops the filled
 * gold-pale bar/rounded-top corners for a plain label row sitting above the
 * separated cards, matching TableRow's own `cardRows` branch below. */
export function TableHeader<T>({
  columns,
  visibleCount,
  cardRows,
}: {
  columns: TableColumn<T>[];
  visibleCount: number;
  cardRows?: boolean;
}) {
  const visibleCols = columns.slice(0, visibleCount);
  return (
    <View style={cardRows ? styles.headRowPlain : [styles.headRow, styles.firstRowRadius]}>
      {visibleCols.map((c) => (
        <ThemedText
          key={c.key}
          variant="small"
          color={colors.muted}
          style={[cardRows ? styles.headCellPlain : styles.headCell, { flex: c.weight ?? 1 }]}
          numberOfLines={1}
        >
          {c.label.toUpperCase()}
        </ThemedText>
      ))}
      <View style={styles.chevCol} />
    </View>
  );
}

export function TableRow<T>({
  row,
  columns,
  visibleCount,
  extraFields,
  onViewDescription,
  isFirst,
  isLast,
  cardRows,
}: {
  row: T;
  columns: TableColumn<T>[];
  visibleCount: number;
  extraFields?: (row: T) => ExtraField[];
  /** Omit for a table with nowhere to navigate to (e.g. Cash Movements/
   * Expenses have no per-entry detail screen) — the button just doesn't
   * render, rather than navigating nowhere. */
  onViewDescription?: (row: T) => void;
  isFirst?: boolean;
  /** Rounds this row's bottom corners to match tableCardStyle's — see that
   * style's comment on why the card doesn't just clip its children instead.
   * Ignored when `cardRows` is set — every row is already fully rounded. */
  isLast?: boolean;
  /** Renders this row as its own separated, shadowed card (margin below it,
   * rounded on all 4 corners) instead of a divider-separated strip inside
   * one shared card — see ExpandableTable's own `cardRows` doc comment. */
  cardRows?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleCols = columns.slice(0, visibleCount);
  const hiddenCols = columns.slice(visibleCount);
  const extra: ExtraField[] = [...hiddenCols.map((c) => ({ label: c.label, value: c.render(row) })), ...(extraFields?.(row) ?? [])];

  const body = (
    <>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={[styles.dataRow, !cardRows && isLast && !expanded && styles.lastRowRadius]}
      >
        {visibleCols.map((c, i) => {
          const content = c.render(row);
          return (
            <View key={c.key} style={{ flex: c.weight ?? 1 }}>
              {typeof content === "string" || typeof content === "number" ? (
                <ThemedText variant="small" numberOfLines={1} style={[styles.cellText, i === 0 && styles.firstCell]}>
                  {content}
                </ThemedText>
              ) : (
                content
              )}
            </View>
          );
        })}
        <View style={styles.chevCol}>
          {/* Icon.tsx only has a left-pointing chevron and no `style` prop
           * to rotate directly — wrap it instead: down at rest, up when
           * expanded. */}
          <View style={{ transform: [{ rotate: expanded ? "90deg" : "-90deg" }] }}>
            <Icon name="chevronLeft" size={11} color={colors.muted} />
          </View>
        </View>
      </Pressable>

      {expanded ? (
        <View style={[styles.detailWrap, !cardRows && isLast && styles.lastRowRadius, cardRows && styles.detailWrapCard]}>
          <View style={styles.detailGrid}>
            {extra.map((f, i) => (
              <View key={i} style={styles.detailField}>
                <ThemedText variant="small" color={colors.muted} style={styles.detailK}>
                  {f.label.toUpperCase()}
                </ThemedText>
                {typeof f.value === "string" || typeof f.value === "number" ? (
                  <ThemedText variant="small" style={styles.cellText}>
                    {f.value}
                  </ThemedText>
                ) : (
                  f.value
                )}
              </View>
            ))}
          </View>
          {onViewDescription ? (
            <Pressable onPress={() => onViewDescription(row)} style={styles.viewBtn}>
              <ThemedText variant="label" color={colors.card}>
                View Description
              </ThemedText>
              <View style={{ transform: [{ rotate: "180deg" }] }}>
                <Icon name="chevronLeft" size={12} color={colors.card} />
              </View>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </>
  );

  if (cardRows) {
    // Two nested Views rather than one: shadowColor/shadowOpacity on a View
    // that ALSO clips via overflow:hidden loses the shadow on iOS (the
    // shadow is computed outside the box overflow:hidden is cutting at —
    // same reasoning as tableCardStyle's own doc comment above). The outer
    // View carries the shadow + spacing between cards, the inner one
    // carries the rounded border and clips the row/detail strip to it.
    return (
      <View style={styles.cardOuter}>
        <View style={styles.cardInner}>{body}</View>
      </View>
    );
  }

  return <View style={!isFirst && styles.rowDivider}>{body}</View>;
}

/** Convenience wrapper for a screen whose whole list is already loaded (no
 * infinite-scroll needed) — e.g. a short, non-paginated list.
 *
 * The column-label row is a plain sibling ABOVE the `FlatList`, not a
 * `stickyHeaderIndices` header inside it — we want it permanently fixed
 * (never even briefly scrolling before it "sticks"), and `stickyHeaderIndices`
 * implements stickiness via ScrollView's own internal machinery, which can
 * itself trip RN's "VirtualizedLists should never be nested inside plain
 * ScrollViews" warning. A plain sibling avoids that entirely. Every list
 * screen wraps this in a `flex: 1` region with its search/filter controls
 * and `Pager` OUTSIDE that region, so only the rows scroll. */
export function ExpandableTable<T>({
  columns,
  visibleCount,
  data,
  keyExtractor,
  extraFields,
  onViewDescription,
  emptyText = "No records found.",
  refreshControl,
  style,
  onEndReached,
  isFetchingNextPage,
  // Default on — every table in the app now renders rows as their own
  // separated, shadowed cards (see TableRow's own `cardRows` doc comment)
  // rather than one shared bordered list. Pass `cardRows={false}` to opt a
  // screen back into the original single-card-with-dividers look.
  cardRows = true,
  headerContent,
}: {
  columns: TableColumn<T>[];
  visibleCount: number;
  data: T[];
  keyExtractor: (row: T) => string;
  extraFields?: (row: T) => ExtraField[];
  onViewDescription?: (row: T) => void;
  emptyText?: string;
  refreshControl?: ReactElement<RefreshControlProps>;
  style?: ViewStyle;
  /** Infinite-scroll hook — pass useInfiniteQuery's fetchNextPage (guarded by
   * hasNextPage), called once the list gets within a screen's height of the
   * bottom. Omit for an already-fully-loaded, non-paginated list. */
  onEndReached?: () => void;
  /** Shows the trailing spinner row while the next page is in flight. */
  isFetchingNextPage?: boolean;
  /** Renders every row as its own separated, shadowed card instead of one
   * shared bordered card with divider lines between rows — see TableRow's
   * own `cardRows` doc comment. Defaults on for every table in the app;
   * pass `false` to opt a screen back into the original shared-card look. */
  cardRows?: boolean;
  /** Extra content (info cards, etc.) to scroll away WITH the table instead
   * of sitting in a fixed block above it — see CustomerDetailScreen's own
   * fix comment for why this exists: a screen that puts its own tall fixed
   * content above this table (a customer's profile card + nominee card, on
   * a small screen or with every optional field filled in) was squeezing
   * the table into a near-zero-height flex slot, which read as "scrolling
   * doesn't work" even though the FlatList itself was fine. When set, this
   * renders inside the FlatList as part of `ListHeaderComponent` — ABOVE
   * TableHeader, which moves in here too so both scroll together — instead
   * of TableHeader's normal fixed-sibling placement below. */
  headerContent?: React.ReactNode;
}) {
  return (
    <View style={[!cardRows && tableCardStyle, styles.flatList, style]}>
      {headerContent ? null : <TableHeader columns={columns} visibleCount={visibleCount} cardRows={cardRows} />}
      {/* Resets ScrollView.Context to null around this FlatList — RN's
       * "VirtualizedLists should never be nested inside plain ScrollViews"
       * check reads that context and fires whenever ANY ancestor ScrollView
       * exists, vertical-oriented, anywhere above this point in the tree
       * (a screen's own top-level KeyboardAvoidingView, some other library's
       * wrapper, etc.) — regardless of whether that ancestor actually
       * competes for the same scroll gesture. This table is always meant to
       * be its own independent scroller (every caller gives it a dedicated
       * flex:1 slot — see this component's own doc comment above), so that
       * warning doesn't apply here; resetting the context is the
       * RN-sanctioned way to say so without disabling the check globally. */}
      <ScrollViewContextReset value={null}>
        <FlatList
          data={data}
          keyExtractor={keyExtractor}
          style={styles.rowsList}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            headerContent ? (
              <>
                {headerContent}
                <TableHeader columns={columns} visibleCount={visibleCount} cardRows={cardRows} />
              </>
            ) : undefined
          }
          ListEmptyComponent={
            <ThemedText color={colors.muted} style={{ padding: 16 }}>
              {emptyText}
            </ThemedText>
          }
          renderItem={({ item, index }) => (
            <TableRow
              row={item}
              columns={columns}
              visibleCount={visibleCount}
              extraFields={extraFields}
              onViewDescription={onViewDescription}
              isFirst={index === 0}
              cardRows={cardRows}
            />
          )}
          refreshControl={refreshControl}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={colors.brand} />
              </View>
            ) : null
          }
        />
      </ScrollViewContextReset>
    </View>
  );
}

const styles = StyleSheet.create({
  // flex: 1 (not intrinsic height) — this fills whatever flex:1 slot the
  // caller wraps it in, so it's the region that actually scrolls, not the
  // whole screen. rowsList needs its own flex:1 too, since it's the actual
  // FlatList sitting below the fixed TableHeader inside this card.
  flatList: { flex: 1 },
  rowsList: { flex: 1 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandPale,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 10,
  },
  headCell: { fontSize: 11, letterSpacing: 0.6 },
  // cardRows variant — a plain label row above the separated cards, no
  // filled bar/rounded corners of its own (there's no longer one shared
  // card for it to cap).
  headRowPlain: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingBottom: 8,
    gap: 10,
  },
  headCellPlain: { fontSize: 10.5, letterSpacing: 0.6 },
  firstRowRadius: { borderTopLeftRadius: RADIUS, borderTopRightRadius: RADIUS },
  lastRowRadius: { borderBottomLeftRadius: RADIUS, borderBottomRightRadius: RADIUS },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  // gap: 10 — data cells previously sat flush against each other with no
  // spacing at all (only the header row's cells had a paddingRight, which
  // this replaces): on rows with several short columns (e.g. Customers'
  // Phone next to its KYC status pill) that read as two unrelated values
  // crowded together instead of two separate columns.
  dataRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 10, backgroundColor: colors.card, gap: 10 },
  cellText: { fontSize: 14.5 },
  firstCell: { fontWeight: "600" as const },
  chevCol: { width: 24, alignItems: "center", justifyContent: "center" },
  detailWrap: {
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    borderStyle: "dashed",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
  },
  // cardRows variant of detailWrap — same content, just card-tinted rather
  // than ivory, since the surrounding card is already visually separated
  // from the page background (ivory existed to read as "inset" against the
  // single shared card's own colors.card fill).
  detailWrapCard: { backgroundColor: colors.card },
  // cardRows variant of a table row — see TableRow's own `cardRows` branch.
  cardOuter: {
    marginBottom: 10,
    shadowColor: colors.nav,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardInner: {
    borderRadius: RADIUS - 2,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    backgroundColor: colors.card,
  },
  detailGrid: { flexDirection: "row", flexWrap: "wrap" },
  detailField: { width: "50%", paddingRight: 10, marginBottom: 9 },
  detailK: { fontSize: 10.5, letterSpacing: 0.6, marginBottom: 2 },
  viewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.brandDeep,
    borderRadius: 10,
    paddingVertical: 11,
    marginTop: 2,
  },
  footerLoader: { paddingVertical: 16, alignItems: "center" },
});
