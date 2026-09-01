import React, { useState } from "react";
import { View, Pressable, StyleSheet, ViewStyle } from "react-native";
import { ThemedText } from "./ThemedText";
import { Icon } from "./Icon";
import { colors } from "../theme/colors";

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

const RADIUS = 14;

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
export const tableCardStyle: ViewStyle = {
  borderWidth: 1,
  borderColor: colors.line,
  borderRadius: RADIUS,
  backgroundColor: colors.card,
  shadowColor: colors.charcoal,
  shadowOpacity: 0.14,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
};

/** Column-label row — pass as a FlatList's `ListHeaderComponent`. */
export function TableHeader<T>({ columns, visibleCount }: { columns: TableColumn<T>[]; visibleCount: number }) {
  const visibleCols = columns.slice(0, visibleCount);
  return (
    <View style={[styles.headRow, styles.firstRowRadius]}>
      {visibleCols.map((c) => (
        <ThemedText key={c.key} variant="small" color={colors.muted} style={[styles.headCell, { flex: c.weight ?? 1 }]} numberOfLines={1}>
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
   * style's comment on why the card doesn't just clip its children instead. */
  isLast?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const visibleCols = columns.slice(0, visibleCount);
  const hiddenCols = columns.slice(visibleCount);
  const extra: ExtraField[] = [...hiddenCols.map((c) => ({ label: c.label, value: c.render(row) })), ...(extraFields?.(row) ?? [])];

  return (
    <View style={!isFirst && styles.rowDivider}>
      <Pressable onPress={() => setExpanded((v) => !v)} style={[styles.dataRow, isLast && !expanded && styles.lastRowRadius]}>
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
        <View style={[styles.detailWrap, isLast && styles.lastRowRadius]}>
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
    </View>
  );
}

/** Convenience wrapper for a screen whose whole list is already loaded (no
 * FlatList/infinite-scroll needed) — e.g. a short, non-paginated list. */
export function ExpandableTable<T>({
  columns,
  visibleCount,
  data,
  keyExtractor,
  extraFields,
  onViewDescription,
  emptyText = "No records found.",
}: {
  columns: TableColumn<T>[];
  visibleCount: number;
  data: T[];
  keyExtractor: (row: T) => string;
  extraFields?: (row: T) => ExtraField[];
  onViewDescription?: (row: T) => void;
  emptyText?: string;
}) {
  if (data.length === 0) {
    return (
      <View style={tableCardStyle}>
        <ThemedText color={colors.muted} style={{ padding: 16 }}>
          {emptyText}
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={tableCardStyle}>
      <TableHeader columns={columns} visibleCount={visibleCount} />
      {data.map((row, i) => (
        <TableRow
          key={keyExtractor(row)}
          row={row}
          columns={columns}
          visibleCount={visibleCount}
          extraFields={extraFields}
          onViewDescription={onViewDescription}
          isFirst={i === 0}
          isLast={i === data.length - 1}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.goldPale,
    paddingVertical: 9,
    paddingHorizontal: 10,
  },
  headCell: { fontSize: 11, letterSpacing: 0.6, paddingRight: 6 },
  firstRowRadius: { borderTopLeftRadius: RADIUS, borderTopRightRadius: RADIUS },
  lastRowRadius: { borderBottomLeftRadius: RADIUS, borderBottomRightRadius: RADIUS },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  dataRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 10, backgroundColor: colors.card },
  cellText: { fontSize: 14.5 },
  firstCell: { fontWeight: "600" as const },
  chevCol: { width: 24, alignItems: "center", justifyContent: "center" },
  detailWrap: {
    backgroundColor: colors.ivory,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    borderStyle: "dashed",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 12,
  },
  detailGrid: { flexDirection: "row", flexWrap: "wrap" },
  detailField: { width: "50%", paddingRight: 10, marginBottom: 9 },
  detailK: { fontSize: 10.5, letterSpacing: 0.6, marginBottom: 2 },
  viewBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: colors.goldDeep,
    borderRadius: 9,
    paddingVertical: 10,
    marginTop: 2,
  },
});
