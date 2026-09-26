import React, { useState } from "react";
import { LayoutAnimation, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { C, Txt, initialsOf } from "./base";
import { PIcon } from "./PIcon";
import { StatusChip, type ChipTone } from "./Chips";

const expandAnim = () => LayoutAnimation.configureNext(LayoutAnimation.create(250, "easeInEaseOut", "opacity"));

export type AccDetail = { k: string; v: React.ReactNode; color?: string };
export type AccAction = { label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean };

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
  defaultOpen,
  onPress,
  style,
}: {
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
  defaultOpen?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const expandable = !onPress && ((details && details.length > 0) || (actions && actions.length > 0));
  return (
    <View style={[s.row, style]}>
      <Pressable
        style={s.head}
        onPress={() => {
          if (onPress) return onPress();
          if (!expandable) return;
          expandAnim();
          setOpen((o) => !o);
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
                  <Txt style={[s.v, d.color ? { color: d.color } : null]}>{d.v}</Txt>
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

/** .acc-btn */
export function AccBtn({ label, onPress, primary, danger, disabled, style }: AccAction & { style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} style={[s.btn, primary && s.btnPrimary, disabled && { opacity: 0.5 }, style]}>
      <Txt style={[s.btnTxt, primary && { color: "#fff" }, danger && { color: C.red }]} numberOfLines={1}>
        {label}
      </Txt>
    </Pressable>
  );
}

/** .pkt-card — two-row packet card, opens a detail sheet. */
export function PktCard({
  code,
  status,
  loan,
  customer,
  items,
  weight,
  location,
  onPress,
}: {
  code: string;
  status: string;
  loan: string;
  customer: string;
  items: number;
  weight: string;
  location: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={s.pkt} onPress={onPress}>
      <View style={s.pktRow1}>
        <Txt style={s.pktId}>{code}</Txt>
        <StatusChip label={status} />
      </View>
      <View style={s.pktRow2}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt style={s.pktLoan} numberOfLines={1}>
            {loan}
          </Txt>
          <Txt style={s.pktSub} numberOfLines={1}>
            {customer}
          </Txt>
        </View>
        <View>
          <Txt style={s.pktMeta}>
            <Txt style={s.pktMetaB}>{items}</Txt> {items === 1 ? "ornament" : "ornaments"} · <Txt style={s.pktMetaB}>{weight}</Txt>
          </Txt>
          <Txt style={s.pktMeta}>{location}</Txt>
        </View>
      </View>
    </Pressable>
  );
}

/** Rounded-square initials avatar (.cust-header-avatar / .act-avatar). */
export function Avatar({ name, size = 38, radius = 11, fontSize = 13, filled = true }: { name?: string | null; size?: number; radius?: number; fontSize?: number; filled?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: filled ? C.brandDeep : C.brandFaint,
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <Txt style={{ color: filled ? "#fff" : C.brandDeep, fontWeight: "700", fontSize }}>{initialsOf(name)}</Txt>
    </View>
  );
}

/** .cust-row */
export function CustRow({ name, sub, onPress }: { name: string; sub: string; onPress: () => void }) {
  return (
    <Pressable style={s.custRow} onPress={onPress}>
      <Avatar name={name} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.custName} numberOfLines={1}>
          {name}
        </Txt>
        <Txt style={s.custSub} numberOfLines={1}>
          {sub}
        </Txt>
      </View>
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );
}

/** .report-section-label + .report-row */
export function ReportSectionLabel({ children }: { children: string }) {
  return <Txt style={s.reportLabel}>{children.toUpperCase()}</Txt>;
}
export function ReportRow({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable style={s.reportRow} onPress={onPress}>
      <Txt style={s.reportTitle}>{title}</Txt>
      <PIcon name="chevright" color={C.muted} />
    </Pressable>
  );
}

/** .sheet-list-item — actions / documents / More / cash actions. */
export function SheetListItem({
  icon,
  title,
  sub,
  onPress,
  warn,
  first,
  right,
}: {
  icon: string;
  title: string;
  sub?: string;
  onPress: () => void;
  warn?: boolean;
  first?: boolean;
  right?: React.ReactNode;
}) {
  return (
    <Pressable style={[s.sli, !first && s.sliBorder]} onPress={onPress}>
      <View style={[s.sliIc, warn && { backgroundColor: C.redBg }]}>
        <PIcon name={icon} color={warn ? C.red : C.brandDeep} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.sliTitle}>{title}</Txt>
        {sub ? <Txt style={s.sliSub}>{sub}</Txt> : null}
      </View>
      {right ?? <PIcon name="chevright" color={C.muted} />}
    </Pressable>
  );
}

/** .act-item — dashboard activity / stored packets. */
export function ActItem({ title, sub, amount, amountColor, avatar, first, onPress }: { title: string; sub: string; amount?: string; amountColor?: string; avatar?: string; first?: boolean; onPress?: () => void }) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[s.act, !first && s.actBorder]}>
      <View style={s.actAvatar}>
        <Txt style={s.actAvatarTxt}>{avatar ?? initialsOf(title)}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.actTitle} numberOfLines={1}>
          {title}
        </Txt>
        <Txt style={s.actSub} numberOfLines={1}>
          {sub}
        </Txt>
      </View>
      {amount ? <Txt style={[s.actAmt, amountColor ? { color: amountColor } : null]}>{amount}</Txt> : null}
    </Pressable>
  );
}

/** .pledge-item — loan history timeline. */
export function PledgeItem({ icon, iconBg, iconColor, title, sub, date, first }: { icon: string; iconBg?: string; iconColor?: string; title: string; sub?: string; date?: string; first?: boolean }) {
  return (
    <View style={[s.pledge, !first && s.actBorder]}>
      <View style={[s.pledgeDot, iconBg ? { backgroundColor: iconBg } : null]}>
        <PIcon name={icon} color={iconColor ?? C.brandDeep} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.pledgeTitle}>{title}</Txt>
        {sub ? <Txt style={s.pledgeSub}>{sub}</Txt> : null}
      </View>
      {date ? <Txt style={s.pledgeDate}>{date}</Txt> : null}
    </View>
  );
}

/** .move-item — packet movement history. */
export function MoveItem({ title, sub, date, first }: { title: string; sub?: string; date?: string; first?: boolean }) {
  return (
    <View style={[s.move, !first && s.actBorder]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.moveT}>{title}</Txt>
        {sub ? <Txt style={s.moveS}>{sub}</Txt> : null}
      </View>
      {date ? <Txt style={s.moveD}>{date}</Txt> : null}
    </View>
  );
}

/** .repay-item / .grm-history-item — label left, value right. */
export function RepayItem({ label, value, labelColor, valueColor, first }: { label: string; value: string; labelColor?: string; valueColor?: string; first?: boolean }) {
  return (
    <View style={[s.repay, !first && s.actBorder]}>
      <Txt style={[s.repayD, labelColor ? { color: labelColor } : null]}>{label}</Txt>
      <Txt style={[s.repayV, valueColor ? { color: valueColor } : null]}>{value}</Txt>
    </View>
  );
}

/** .hit — global search result. */
export function Hit({ name, meta, tag, onPress }: { name: string; meta: string; tag?: string; onPress: () => void }) {
  return (
    <Pressable style={s.hit} onPress={onPress}>
      <View style={s.actAvatar}>
        <Txt style={s.actAvatarTxt}>{initialsOf(name)}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={s.actTitle} numberOfLines={1}>
          {name}
        </Txt>
        <Txt style={s.actSub} numberOfLines={1}>
          {meta}
        </Txt>
      </View>
      {tag ? (
        <View style={s.hitTag}>
          <Txt style={s.hitTagTxt}>{tag}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  row: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, marginBottom: 10, overflow: "hidden" },
  head: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14 },
  lid: { flexShrink: 0, maxWidth: 110 },
  lidTxt: { fontWeight: "700", fontSize: 12.5, color: C.brandDeep },
  main: { flex: 1, minWidth: 0 },
  name: { fontWeight: "700", fontSize: 13.5 },
  nameSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  right: { alignItems: "flex-end", flexShrink: 0 },
  amt: { fontWeight: "700", fontSize: 13.5 },
  chev: { flexShrink: 0 },
  body: { backgroundColor: C.brandFaint },
  detail: { paddingTop: 4, paddingHorizontal: 14, paddingBottom: 14, flexDirection: "row", flexWrap: "wrap", rowGap: 10 },
  detailCell: { width: "50%", paddingRight: 16 },
  k: { fontSize: 10.5, color: C.muted, fontWeight: "600" },
  v: { fontSize: 12.5, fontWeight: "700", marginTop: 2 },
  actions: { width: "100%", flexDirection: "row", gap: 8, marginTop: 4 },
  btn: { flex: 1, alignItems: "center", padding: 9, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  btnPrimary: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  btnTxt: { fontSize: 11.5, fontWeight: "700", color: C.brandDeep },

  pkt: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10 },
  pktRow1: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  pktId: { fontWeight: "700", fontSize: 13, color: C.brandDeep },
  pktRow2: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 },
  pktLoan: { fontSize: 12.5, fontWeight: "600" },
  pktSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  pktMeta: { textAlign: "right", fontSize: 11, color: C.muted },
  pktMetaB: { color: C.ink, fontWeight: "700", fontSize: 11 },

  custRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 13, paddingHorizontal: 18, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  custName: { fontWeight: "700", fontSize: 13.5 },
  custSub: { fontSize: 11.5, color: C.muted, marginTop: 1 },

  reportLabel: { fontSize: 11, fontWeight: "700", color: C.muted, letterSpacing: 0.55, paddingTop: 16, paddingHorizontal: 18, paddingBottom: 6 },
  reportRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 18, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line },
  reportTitle: { fontWeight: "700", fontSize: 13, flex: 1 },

  sli: { flexDirection: "row", alignItems: "center", gap: 13, paddingVertical: 14, paddingHorizontal: 2 },
  sliBorder: { borderTopWidth: 1, borderTopColor: C.line },
  sliIc: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  sliTitle: { fontWeight: "700", fontSize: 13.5 },
  sliSub: { fontSize: 11, color: C.muted, marginTop: 1 },

  act: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  actBorder: { borderTopWidth: 1, borderTopColor: C.line },
  actAvatar: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  actAvatarTxt: { color: C.brandDeep, fontWeight: "700", fontSize: 12 },
  actTitle: { fontWeight: "600", fontSize: 13 },
  actSub: { fontSize: 11, color: C.muted },
  actAmt: { fontWeight: "700", fontSize: 13, textAlign: "right" },

  pledge: { flexDirection: "row", gap: 12, paddingVertical: 11 },
  pledgeDot: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  pledgeTitle: { fontWeight: "700", fontSize: 12.5 },
  pledgeSub: { fontSize: 11, color: C.muted, marginTop: 1 },
  pledgeDate: { fontSize: 10.5, color: C.muted, textAlign: "right", flexShrink: 0 },

  move: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", paddingVertical: 10 },
  moveT: { fontSize: 12.5, fontWeight: "700" },
  moveS: { fontSize: 11, color: C.muted, marginTop: 1 },
  moveD: { fontSize: 10.5, color: C.muted, textAlign: "right" },

  repay: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 10 },
  repayD: { fontSize: 12, color: C.muted },
  repayV: { fontSize: 13, fontWeight: "700", color: C.green },

  hit: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  hitTag: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 999, backgroundColor: C.brandPale, flexShrink: 0 },
  hitTagTxt: { fontSize: 10, fontWeight: "700", color: C.brandDeep },
});
