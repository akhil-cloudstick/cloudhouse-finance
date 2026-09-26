import React, { useMemo, useState } from "react";
import { ActivityIndicator, LayoutAnimation, Pressable, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { C, Txt } from "./base";
import { PIcon } from "./PIcon";
import { Sheet } from "./Sheet";
import { MonthGrid } from "./Cards";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ZERO_SPLIT, isBalanced, splitTotal } from "../PaymentBreakdown";
import type { SplitAmounts } from "../../api/investments";

// ---- .field ---------------------------------------------------------------
export function Field({ label, children, style }: { label?: string; children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.field, style]}>
      {label ? <Txt style={s.label}>{label}</Txt> : null}
      {children}
    </View>
  );
}

/** .field-row — children should be <Field>s; each flexes equally. */
export function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.fieldRow}>
      {React.Children.map(children, (c) => (c ? <View style={{ flex: 1 }}>{c}</View> : null))}
    </View>
  );
}

/** .field input */
export function Input({ style, editable = true, ...rest }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.muted}
      allowFontScaling={false}
      editable={editable}
      {...rest}
      onFocus={(e) => {
        setFocused(true);
        rest.onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        rest.onBlur?.(e);
      }}
      style={[s.input, focused && s.inputFocus, !editable && s.inputDisabled, style]}
    />
  );
}

/** Label + input in one. */
export function TextField({ label, style, ...rest }: TextInputProps & { label: string }) {
  return (
    <Field label={label} style={style as StyleProp<ViewStyle>}>
      <Input {...rest} />
    </Field>
  );
}

// ---- Date field (input look, opens a themed month calendar) ---------------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function isoToPretty(v?: string | null) {
  const m = v ? /^(\d{4})-(\d{2})-(\d{2})/.exec(v) : null;
  return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}` : "";
}

export function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DateField({
  label,
  value,
  onChange,
  placeholder = "Select date",
  min,
  max,
  clearable,
}: {
  label?: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const init = value ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1) : new Date();
  const [cursor, setCursor] = useState(new Date(init.getFullYear(), init.getMonth(), 1));
  return (
    <Field label={label}>
      <Pressable
        onPress={() => {
          const base = value ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1) : new Date();
          setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
          setOpen(true);
        }}
        style={[s.input, s.dateBtn]}
      >
        <Txt style={{ fontSize: 13.5, color: value ? C.ink : C.muted }}>{value ? isoToPretty(value) : placeholder}</Txt>
        <PIcon name="calendar" color={C.muted} size={15} />
      </Pressable>
      <Sheet visible={open} onClose={() => setOpen(false)} title={label ?? "Select date"} maxHeightPct={70}>
        <View style={s.calHead}>
          <Pressable style={s.calNav} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
          <Txt style={s.calTitle}>
            {cursor.toLocaleString("en-IN", { month: "long" })} {cursor.getFullYear()}
          </Txt>
          <Pressable style={[s.calNav, { transform: [{ scaleX: -1 }] }]} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
        </View>
        <MonthGrid
          month={cursor}
          selected={value}
          min={min}
          max={max}
          gutter={0}
          onSelect={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
        />
        {clearable && value ? (
          <PrimaryButton
            label="Clear date"
            variant="outline"
            style={{ marginTop: 14 }}
            onPress={() => {
              onChange("");
              setOpen(false);
            }}
          />
        ) : null}
      </Sheet>
    </Field>
  );
}

// ---- .theme-dropdown ------------------------------------------------------
// Renders its menu in-flow (pushing content down) rather than absolutely
// positioned — inside scrolling sheets an absolute menu is clipped on Android.
export function ThemeDropdown<T>({
  value,
  options,
  onChange,
  labelOf,
  keyOf,
  placeholder = "Select",
  style,
}: {
  value: T | null | undefined;
  options: T[];
  onChange: (v: T) => void;
  labelOf: (v: T) => string;
  keyOf?: (v: T) => string | number;
  placeholder?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => {
    LayoutAnimation.configureNext(LayoutAnimation.create(180, "easeInEaseOut", "opacity"));
    setOpen((o) => !o);
  };
  return (
    <View style={style}>
      <Pressable style={[s.ddBtn, open && { borderColor: C.brandDeep }]} onPress={toggle}>
        <Txt style={s.ddLabel} numberOfLines={1}>
          {value != null ? labelOf(value) : placeholder}
        </Txt>
        <View style={open ? { transform: [{ rotate: "180deg" }] } : null}>
          <PIcon name="chevdown" color={C.brandDeep} />
        </View>
      </Pressable>
      {open ? (
        <View style={s.ddMenu}>
          {options.map((o, i) => {
            const selected = value != null && (keyOf ? keyOf(o) === keyOf(value) : o === value);
            return (
              <Pressable
                key={keyOf ? keyOf(o) : i}
                style={[s.ddItem, selected && s.ddItemSel]}
                onPress={() => {
                  onChange(o);
                  toggle();
                }}
              >
                <Txt style={[s.ddItemTxt, selected && { color: C.brandDeep }]}>{labelOf(o)}</Txt>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

/** Simple string-options dropdown. */
export function SelectField<T extends string>({ label, value, options, onChange, labels }: { label?: string; value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> }) {
  return (
    <Field label={label}>
      <ThemeDropdown value={value} options={[...options]} onChange={onChange} labelOf={(o) => labels?.[o] ?? o} />
    </Field>
  );
}

/** Search-as-you-type picker backed by a server `q` query — renders an
 * .field input with the results in a .theme-dropdown-menu card below. */
export function AsyncSelect<T>({
  label,
  placeholder,
  queryKey,
  fetcher,
  selectedLabel,
  onSelect,
  keyOf,
  renderItem,
  onClear,
  minChars = 0,
}: {
  label?: string;
  placeholder?: string;
  queryKey: unknown[];
  fetcher: (q: string) => Promise<T[]>;
  selectedLabel?: string;
  onSelect: (v: T) => void;
  keyOf: (v: T) => string | number;
  renderItem: (v: T) => { title: string; sub?: string };
  onClear?: () => void;
  minChars?: number;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const dq = useDebouncedValue(q);
  const enabled = open && dq.trim().length >= minChars;
  const { data, isFetching } = useQuery({ queryKey: [...queryKey, dq], queryFn: () => fetcher(dq.trim()), enabled });
  const items = useMemo(() => (data ?? []).slice(0, 30), [data]);
  return (
    <Field label={label}>
      {selectedLabel && !open ? (
        <Pressable style={[s.input, s.dateBtn]} onPress={() => setOpen(true)}>
          <Txt style={{ fontSize: 13.5, flex: 1 }} numberOfLines={1}>
            {selectedLabel}
          </Txt>
          {onClear ? (
            <Pressable hitSlop={10} onPress={onClear}>
              <PIcon name="close" color={C.muted} size={14} />
            </Pressable>
          ) : (
            <PIcon name="chevdown" color={C.brandDeep} />
          )}
        </Pressable>
      ) : (
        <Input placeholder={placeholder} value={q} onChangeText={setQ} onFocus={() => setOpen(true)} autoCorrect={false} />
      )}
      {open ? (
        <View style={s.ddMenu}>
          {isFetching ? (
            <View style={{ paddingVertical: 12 }}>
              <ActivityIndicator color={C.brandDeep} />
            </View>
          ) : items.length === 0 ? (
            <Txt style={[s.ddItemTxt, { padding: 10, color: C.muted }]}>{dq.trim().length < minChars ? "Type to search" : "No matches"}</Txt>
          ) : (
            items.map((it) => {
              const r = renderItem(it);
              return (
                <Pressable
                  key={keyOf(it)}
                  style={s.ddItem}
                  onPress={() => {
                    onSelect(it);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  <Txt style={s.ddItemTxt}>{r.title}</Txt>
                  {r.sub ? <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }}>{r.sub}</Txt> : null}
                </Pressable>
              );
            })
          )}
          <Pressable style={[s.ddItem, { alignItems: "center" }]} onPress={() => setOpen(false)}>
            <Txt style={{ fontSize: 12, fontWeight: "700", color: C.muted }}>Close</Txt>
          </Pressable>
        </View>
      ) : null}
    </Field>
  );
}

// ---- .btn-primary ---------------------------------------------------------
export function PrimaryButton({
  label,
  onPress,
  variant = "primary",
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline" | "reject" | "danger";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const fg = variant === "primary" || variant === "danger" ? "#fff" : variant === "reject" ? C.red : C.brandDeep;
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        s.btn,
        variant === "outline" && s.btnOutline,
        variant === "reject" && s.btnReject,
        variant === "danger" && { backgroundColor: C.red },
        disabled && { opacity: 0.45 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : <Txt style={[s.btnTxt, { color: fg }]}>{label}</Txt>}
    </Pressable>
  );
}

/** .btn-row-2 */
export function BtnRow2({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.btnRow2, style]}>
      {React.Children.map(children, (c) => (c ? <View style={{ flex: 1 }}>{c}</View> : null))}
    </View>
  );
}

// ---- boxes & banners ------------------------------------------------------
/** .result-box */
export function ResultBox({ k, v, tone = "brand", style }: { k: string; v: string; tone?: "brand" | "green" | "red"; style?: StyleProp<ViewStyle> }) {
  const bg = tone === "green" ? C.greenBg : tone === "red" ? C.redBg : C.brandPale;
  const fg = tone === "green" ? C.green : tone === "red" ? C.red : C.brandDeep;
  return (
    <View style={[s.result, { backgroundColor: bg }, style]}>
      <Txt style={[s.resultK, { color: fg }]}>{k}</Txt>
      <Txt style={[s.resultV, { color: fg }]}>{v}</Txt>
    </View>
  );
}

/** .warning-banner */
export function WarningBanner({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.warn}>
      <PIcon name="alert" color={C.red} />
      <Txt style={s.warnTxt}>{children}</Txt>
    </View>
  );
}
/** .notice-banner */
export function NoticeBanner({ children }: { children: React.ReactNode }) {
  return (
    <View style={s.notice}>
      <Txt style={s.noticeTxt}>{children}</Txt>
    </View>
  );
}
/** .review-warning */
export function ReviewWarning({ children }: { children: React.ReactNode }) {
  return (
    <View style={[s.warn, { backgroundColor: C.amberBg }]}>
      <PIcon name="alert" color={C.amber} />
      <Txt style={[s.warnTxt, { color: C.amber }]}>{children}</Txt>
    </View>
  );
}

/** .confirm-toggle-item / .gold-checkbox-item */
export function CheckItem({
  checked,
  onPress,
  title,
  sub,
  variant = "gold",
}: {
  checked: boolean;
  onPress: () => void;
  title: string;
  sub?: string;
  variant?: "gold" | "confirm";
}) {
  return (
    <Pressable onPress={onPress} style={[variant === "confirm" ? s.confirm : s.goldCb, checked && s.cbChecked]}>
      <View style={[s.cbBox, checked && s.cbBoxChecked]}>{checked ? <PIcon name="check" color="#fff" size={14} strokeWidth={3} /> : null}</View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt style={variant === "confirm" ? s.confirmTitle : s.cbTitle}>{title}</Txt>
        {sub ? <Txt style={s.cbSub}>{sub}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** .ornament-card */
export function OrnamentCard({ title, onRemove, children }: { title: string; onRemove?: () => void; children: React.ReactNode }) {
  return (
    <View style={s.orn}>
      <View style={s.ornHead}>
        <Txt style={s.ornTitle}>{title}</Txt>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={8}>
            <Txt style={s.ornRemove}>Remove</Txt>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** .add-ornament-btn — dashed add button. */
export function DashedButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable style={[s.dashed, style]} onPress={onPress}>
      <PIcon name="plus" color={C.brandDeep} />
      <Txt style={s.dashedTxt}>{label}</Txt>
    </Pressable>
  );
}

/** Dashed "Tap to upload" box. */
export function UploadBox({ label, onPress, done }: { label: string; onPress: () => void; done?: boolean }) {
  return (
    <Pressable onPress={onPress} style={[s.upload, done && { borderColor: C.green, backgroundColor: C.greenBg }]}>
      <Txt style={{ color: done ? C.green : C.muted, fontSize: 12, fontWeight: done ? "700" : "400" }}>{label}</Txt>
    </Pressable>
  );
}

// ---- payment split (.payment-mode-chips + .payment-split-grid) -------------
// Uses the same SplitAmounts shape the payment APIs take (PaymentBreakdown.tsx).
export type { SplitAmounts };
export { ZERO_SPLIT, isBalanced, splitTotal };
const MODES: { key: keyof SplitAmounts; label: string; all: string }[] = [
  { key: "cashAmount", label: "Cash", all: "All Cash" },
  { key: "upiAmount", label: "UPI", all: "All UPI" },
  { key: "bankTransferAmount", label: "Bank Transfer", all: "All Bank Transfer" },
  { key: "chequeAmount", label: "Cheque", all: "All Cheque" },
];
const fmtINR = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export function PaymentSplit({ amount, value, onChange, modes }: { amount: number; value: SplitAmounts; onChange: (v: SplitAmounts) => void; modes?: (keyof SplitAmounts)[] }) {
  const list = modes ? MODES.filter((m) => modes.includes(m.key)) : MODES;
  const total = splitTotal(value);
  const match = isBalanced(value, amount);
  const activeAll = list.find((m) => amount > 0 && value[m.key] === amount && total === amount)?.key;
  return (
    <View>
      <View style={s.pmChips}>
        {list.map((m) => {
          const active = activeAll === m.key;
          return (
            <Pressable key={m.key} style={[s.pmChip, active && s.pmChipActive]} onPress={() => onChange({ ...ZERO_SPLIT, [m.key]: amount })}>
              <Txt style={[s.pmChipTxt, active && { color: "#fff" }]}>{m.all}</Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={s.splitGrid}>
        {list.map((m) => (
          <View key={m.key} style={{ width: "48%" }}>
            <Field label={m.label}>
              <Input
                keyboardType="decimal-pad"
                value={value[m.key] ? String(value[m.key]) : "0"}
                onChangeText={(t) => onChange({ ...value, [m.key]: Number(t.replace(/[^0-9.]/g, "")) || 0 })}
              />
            </Field>
          </View>
        ))}
      </View>
      <View style={s.splitTotal}>
        <Txt style={[s.splitTotalTxt, match && { color: C.green }]}>Split total: {fmtINR(total)}</Txt>
        <Txt style={[s.splitTotalTxt, match && { color: C.green }]}>{match ? "Matches amount ✓" : `Must equal ${fmtINR(amount)}`}</Txt>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  field: { marginBottom: 12 },
  label: { fontSize: 11.5, fontWeight: "600", color: C.muted, marginBottom: 6 },
  fieldRow: { flexDirection: "row", gap: 10 },
  input: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    fontSize: 13.5,
    backgroundColor: C.brandFaint,
    color: C.ink,
  },
  inputFocus: { borderColor: C.brand, backgroundColor: "#fff" },
  inputDisabled: { color: C.muted },
  dateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },

  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  calTitle: { fontWeight: "700", fontSize: 14 },
  calNav: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center" },

  ddBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 7, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: C.card },
  ddLabel: { fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  ddMenu: { marginTop: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 6, boxShadow: "0px 12px 28px rgba(43,26,94,0.18)" },
  ddItem: { paddingVertical: 9, paddingHorizontal: 10, borderRadius: 8 },
  ddItemSel: { backgroundColor: C.brandPale },
  ddItemTxt: { fontSize: 12.5, fontWeight: "600" },

  btn: { width: "100%", padding: 15, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: C.brandDeep, minHeight: 50 },
  btnOutline: { backgroundColor: C.card, borderWidth: 1, borderColor: C.line },
  btnReject: { backgroundColor: C.card, borderWidth: 1, borderColor: C.redBg },
  btnTxt: { fontWeight: "700", fontSize: 14.5 },
  btnRow2: { flexDirection: "row", gap: 10 },

  result: { borderRadius: 12, paddingVertical: 13, paddingHorizontal: 14, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  resultK: { fontSize: 12, fontWeight: "600", opacity: 0.85 },
  resultV: { fontSize: 19, fontWeight: "800" },

  warn: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: C.redBg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 13, marginBottom: 14 },
  warnTxt: { flex: 1, color: C.red, fontSize: 12, fontWeight: "600", lineHeight: 17 },
  notice: { backgroundColor: C.amberBg, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 13, marginBottom: 14 },
  noticeTxt: { color: C.amber, fontSize: 12, fontWeight: "600", lineHeight: 17 },

  goldCb: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderWidth: 1, borderColor: C.line, borderRadius: 13, marginBottom: 8, backgroundColor: C.card },
  confirm: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderWidth: 1.5, borderColor: C.line, borderRadius: 13, marginBottom: 14, backgroundColor: C.card },
  cbChecked: { borderColor: C.brandDeep, backgroundColor: C.brandFaint },
  cbBox: { width: 20, height: 20, borderRadius: 6, borderWidth: 2, borderColor: C.line, alignItems: "center", justifyContent: "center" },
  cbBoxChecked: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  cbTitle: { fontWeight: "700", fontSize: 13 },
  confirmTitle: { fontWeight: "700", fontSize: 12.5 },
  cbSub: { fontSize: 11, color: C.muted, marginTop: 1 },

  orn: { borderWidth: 1, borderColor: C.line, borderRadius: 14, padding: 13, marginBottom: 10, backgroundColor: C.brandFaint },
  ornHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  ornTitle: { fontSize: 12.5, fontWeight: "700", color: C.brandDeep },
  ornRemove: { fontSize: 11, fontWeight: "700", color: C.red },
  dashed: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, padding: 11, borderWidth: 1.5, borderStyle: "dashed", borderColor: C.brand, borderRadius: 12, marginBottom: 14 },
  dashedTxt: { color: C.brandDeep, fontSize: 12.5, fontWeight: "700" },
  upload: { borderWidth: 1.5, borderStyle: "dashed", borderColor: C.line, borderRadius: 12, padding: 16, alignItems: "center" },

  pmChips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 10 },
  pmChip: { paddingVertical: 7, paddingHorizontal: 11, borderRadius: 999, backgroundColor: C.brandFaint },
  pmChipActive: { backgroundColor: C.brandDeep },
  pmChipTxt: { fontSize: 11, fontWeight: "700", color: C.brandDeep },
  splitGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  splitTotal: { flexDirection: "row", justifyContent: "space-between", marginTop: 2, marginBottom: 12 },
  splitTotalTxt: { fontSize: 11.5, fontWeight: "700", color: C.muted },
});
