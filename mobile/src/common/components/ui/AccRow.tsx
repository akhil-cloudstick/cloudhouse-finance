import React, { useContext, useId, useLayoutEffect, useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useColumnWidth } from "@/common/theme/layout";
import { C } from "./base";
import { Txt } from "./Txt";
import { TruncText } from "./TruncText";
import { PIcon } from "./PIcon";
import { type ChipTone } from "./chipTones";
import { StatusChip } from "./StatusChip";
import { AccCell, AccDetail, AccAction, AccGroupContext, AccRowKey, TableRowCtx, type TableHeadCol, s } from "./rowContext";
import { AccBtn } from "./AccBtn";

/** The pinned column-title row of the table (iPad and bigger). */
export function TableHead({ cols }: { cols: TableHeadCol[] }) {
  return (
    <View style={[t.row, t.headRow]}>
      {cols.map((c) => (
        <Txt key={c.h} style={[t.th, c.width ? { width: c.width } : { flex: c.flex ?? 1, minWidth: c.min ?? 0 }]} numberOfLines={1}>
          {c.h}
        </Txt>
      ))}
      <View style={t.chevCol} />
    </View>
  );
}

/** Narrowest a table column stays readable at (see AccCell.min). */
const cellMin = (c: AccCell) => c.min ?? (c.chip ? 112 : c.num ? 92 : (c.flex ?? 1) > 1 ? 150 : 100);
const expandAnim = () => LayoutAnimation.configureNext(LayoutAnimation.create(250, "easeInEaseOut", "opacity"));
type AccRowProps = {
  id?: string;
  idColor?: string;
  name: React.ReactNode;
  sub?: React.ReactNode;
  amount?: string;
  amountColor?: string;
  status?: string;
  statusTone?: ChipTone;
  details?: AccDetail[];
  actions?: AccAction[];
  /** Table columns for iPad and bigger, in the web table's order. Without it the row shows id / name / amount / status + a few details. */
  cells?: AccCell[];
  defaultOpen?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** .acc-row — the accordion table row every list in the prototype uses:
 * id | name + sub | amount + status chip | chevron, expanding to a 2-col
 * detail grid with action buttons. Pass `onPress` for rows that open a
 * detail sheet instead of expanding (lockers). */
export function AccRow({
  id,
  idColor,
  name,
  sub,
  amount,
  amountColor,
  status,
  statusTone,
  details,
  actions,
  cells: tableCells,
  defaultOpen,
  onPress,
  style,
}: AccRowProps) {
  const group = useContext(AccGroupContext);
  const itemKey = useContext(AccRowKey);
  const autoId = useId();
  const rowKey = itemKey ?? autoId;
  const [ownOpen, setOwnOpen] = useState(!!defaultOpen);
  const open = group ? (group.open === undefined ? !!defaultOpen : group.open === rowKey) : ownOpen;
  const setOpen = (next: boolean) => (group ? group.setOpen(next ? rowKey : null) : setOwnOpen(next));
  const table = useContext(TableRowCtx);
  const colW = useColumnWidth();
  const expandable = !onPress && ((details && details.length > 0) || (actions && actions.length > 0));
  // Table mode (iPad and bigger): one line per row; as many detail columns as fit, the rest stay in the expanded panel.
  const cellCount = table ? Math.max(0, Math.min(6, Math.floor((colW - 36 - 540) / 120))) : 0;
  const cells = details?.slice(0, cellCount) ?? [];
  const toggle = () => {
    if (onPress) return onPress();
    if (!expandable) return;
    expandAnim();
    setOpen(!open);
  };
  // Table mode: the expanded panel leaves out what a column already shows (matched by label, or listed in a cell's `covers`).
  // Responsive columns: when the row is too narrow for every column, drop the least important
  // (never the first or last) until the rest fit; their values go to the expanded panel instead.
  const allCells = tableCells ?? [];
  const droppedCells = new Set<AccCell>();
  if (table && allCells.length) {
    const minOf = cellMin;
    const avail = colW - 36 - 28;
    const need = () => allCells.reduce((a, c) => a + (droppedCells.has(c) ? 0 : minOf(c) + 12), 0) + 18;
    const order = allCells
      .map((c, i) => ({ c, i }))
      .filter(({ i }) => i !== 0 && i !== allCells.length - 1)
      .sort((a, b) => (a.c.drop ?? 100 - a.i) - (b.c.drop ?? 100 - b.i));
    for (const { c } of order) {
      if (need() <= avail) break;
      droppedCells.add(c);
    }
  }
  const visCells = allCells.filter((c) => !droppedCells.has(c));
  const shownKeys = new Set<string>();
  if (table) {
    const src = visCells.length ? visCells : cells;
    for (const c of src) {
      shownKeys.add(("h" in c ? c.h : c.k).toLowerCase());
      if ("covers" in c) c.covers?.forEach((k) => shownKeys.add(k.toLowerCase()));
    }
  }
  const keptDetails = table ? (details?.filter((d) => !shownKeys.has(d.k.toLowerCase())) ?? []) : [];
  const haveKeys = new Set(keptDetails.map((d) => d.k.toLowerCase()));
  const droppedExtras: AccDetail[] = [...droppedCells]
    .filter((c) => !haveKeys.has(c.h.toLowerCase()) && !c.covers?.length && (typeof c.v === "string" || typeof c.v === "number") && c.v !== "—")
    .map((c) => ({ k: c.h, v: c.sub != null && typeof c.sub === "string" ? `${c.v} · ${c.sub}` : c.v }));
  const panelDetails = table ? [...keptDetails, ...droppedExtras] : details;
  const body =
    open && expandable ? (
      <View style={table ? [s.body, t.bodyFlat] : s.body}>
        <View style={s.detail}>
          {panelDetails?.map((d) => (
            <View key={d.k} style={s.detailCell}>
              <Txt style={s.k}>{d.k}</Txt>
              {typeof d.v === "string" || typeof d.v === "number" ? (
                <TruncText lines={3} style={[s.v, d.color ? { color: d.color } : null]}>{d.v}</TruncText>
              ) : (
                d.v
              )}
            </View>
          ))}
          {actions && actions.length ? (
            <View style={s.actions}>
              {actions.map((a) => (
                <AccBtn key={a.label} {...a} />
              ))}
            </View>
          ) : null}
        </View>
      </View>
    ) : null;
  // The first row hands its column titles to the list, which pins them above the scrolling rows.
  const headCols: TableHeadCol[] | null = !table
    ? null
    : visCells.length
      ? visCells.map((c) => ({ h: c.h, flex: c.flex ?? 1, min: cellMin(c), num: c.num }))
      : [
          ...(id ? [{ h: "ID", width: 100 }] : []),
          { h: "Name", flex: 2 },
          ...cells.map((d) => ({ h: d.k, flex: 1 })),
          ...(amount ? [{ h: "Amount", width: 110, num: true }] : []),
          ...(status ? [{ h: "Status", width: 120 }] : []),
        ];
  useLayoutEffect(() => {
    if (table?.first && headCols) table.publishHead(headCols);
  });
  if (table && visCells.length) {
    return (
      <View style={style}>
        <View style={[t.rowWrap, table.last && t.rowWrapLast]}>
          <Pressable style={t.row} onPress={toggle}>
            {visCells.map((c) => (
              <View key={c.h} style={{ flex: c.flex ?? 1, minWidth: cellMin(c), alignItems: "center" }}>
                {c.chip && typeof c.v === "string" && c.v ? (
                  <View style={{ maxWidth: "100%" }}><StatusChip label={c.v} tone={c.tone} /></View>
                ) : typeof c.v === "string" || typeof c.v === "number" ? (
                  <Txt style={[c.sub != null ? s.name : t.cellTxt, t.center, c.color ? { color: c.color } : null]} numberOfLines={1}>
                    {c.v}
                  </Txt>
                ) : (
                  c.v ?? <Txt style={[t.cellTxt, t.center]}>—</Txt>
                )}
                {c.sub != null ? (typeof c.sub === "string" ? <Txt style={[s.nameSub, t.center]} numberOfLines={1}>{c.sub}</Txt> : c.sub) : null}
              </View>
            ))}
            <View style={[t.chevCol, open && { transform: [{ rotate: "90deg" }] }]}>
              <PIcon name="chevright" color={C.muted} />
            </View>
          </Pressable>
          {body}
        </View>
      </View>
    );
  }
  if (table) {
    return (
      <View style={style}>
        <View style={[t.rowWrap, table.last && t.rowWrapLast]}>
          <Pressable style={t.row} onPress={toggle}>
            {id ? (
              <Txt style={[t.idCol, s.lidTxt, t.center, idColor ? { color: idColor } : null]} numberOfLines={1}>
                {id}
              </Txt>
            ) : null}
            <View style={[t.nameCol, { alignItems: "center" }]}>
              {typeof name === "string" ? (
                <Txt style={[s.name, t.center]} numberOfLines={1}>
                  {name}
                </Txt>
              ) : (
                name
              )}
              {sub ? typeof sub === "string" ? <Txt style={[s.nameSub, t.center]} numberOfLines={1}>{sub}</Txt> : sub : null}
            </View>
            {cells.map((d) => (
              <View key={d.k} style={[t.cell, { alignItems: "center" }]}>
                {typeof d.v === "string" || typeof d.v === "number" ? (
                  <Txt style={[t.cellTxt, t.center, d.color ? { color: d.color } : null]} numberOfLines={1}>
                    {d.v}
                  </Txt>
                ) : (
                  d.v
                )}
              </View>
            ))}
            {amount ? <Txt style={[t.amtCol, s.amt, t.center, amountColor ? { color: amountColor } : null]}>{amount}</Txt> : null}
            {status ? (
              <View style={[t.statusCol, { alignItems: "center" }]}>
                <StatusChip label={status} tone={statusTone} />
              </View>
            ) : null}
            <View style={[t.chevCol, open && { transform: [{ rotate: "90deg" }] }]}>
              <PIcon name="chevright" color={C.muted} />
            </View>
          </Pressable>
          {body}
        </View>
      </View>
    );
  }
  return (
    <View style={[s.row, style]}>
      <Pressable
        style={s.head}
        onPress={() => {
          if (onPress) return onPress();
          if (!expandable) return;
          expandAnim();
          setOpen(!open);
        }}
      >
        {id ? (
          <View style={s.lid}>
            <Txt style={[s.lidTxt, idColor ? { color: idColor } : null]} numberOfLines={1}>
              {id}
            </Txt>
          </View>
        ) : null}
        <View style={s.main}>
          {typeof name === "string" ? (
            <Txt style={s.name} numberOfLines={1}>
              {name}
            </Txt>
          ) : (
            name
          )}
          {sub ? (
            typeof sub === "string" ? (
              <Txt style={s.nameSub} numberOfLines={1}>
                {sub}
              </Txt>
            ) : (
              sub
            )
          ) : null}
        </View>
        {amount || status ? (
          <View style={s.right}>
            {amount ? <Txt style={[s.amt, amountColor ? { color: amountColor } : null]}>{amount}</Txt> : null}
            {status ? <StatusChip label={status} tone={statusTone} style={amount ? { marginTop: 5, alignSelf: "flex-end" } : { alignSelf: "flex-end" }} /> : null}
          </View>
        ) : null}
        <View style={[s.chev, open && { transform: [{ rotate: "90deg" }] }]}>
          <PIcon name="chevright" color={C.muted} />
        </View>
      </Pressable>
      {open && expandable ? (
        <View style={s.body}>
          <View style={s.detail}>
            {details?.map((d) => (
              <View key={d.k} style={s.detailCell}>
                <Txt style={s.k}>{d.k}</Txt>
                {typeof d.v === "string" || typeof d.v === "number" ? (
                  <TruncText lines={3} style={[s.v, d.color ? { color: d.color } : null]}>{d.v}</TruncText>
                ) : (
                  d.v
                )}
              </View>
            ))}
            {actions && actions.length ? (
              <View style={s.actions}>
                {actions.map((a) => (
                  <AccBtn key={a.label} {...a} />
                ))}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Table mode (iPad and bigger). Column widths are fixed so every row lines up with the header.
const t = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  headRow: { backgroundColor: C.brandFaint, borderWidth: 1, borderColor: C.line, borderTopLeftRadius: 12, borderTopRightRadius: 12, paddingVertical: 10 },
  bodyFlat: { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  // The closing edge of the table: the last row rounds off the border so the table ends in a clean bottom line.
  rowWrapLast: { borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: "hidden" },
  rowWrap: { backgroundColor: C.card, borderLeftWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderColor: C.line },
  // Every column is centred, titles and cells alike.
  th: { textAlign: "center", fontSize: 11.5, fontWeight: "700", color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  idCol: { width: 100 },
  nameCol: { flex: 2, minWidth: 0 },
  cell: { flex: 1, minWidth: 0 },
  cellTxt: { fontSize: 12.5, fontWeight: "600" },
  center: { textAlign: "center" },
  amtCol: { width: 110 },
  statusCol: { width: 120 },
  chevCol: { width: 18, alignItems: "center" },
});
