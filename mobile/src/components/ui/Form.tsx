import React, { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { C, Spinner, Txt } from "./base";
import { PIcon } from "./PIcon";
import { Sheet } from "./Sheet";
import { Popover, useAnchor, type Anchor } from "./Popover";
import { MonthGrid } from "./Cards";
import { useDebouncedValue } from "../../hooks/useDebouncedValue";
import { ZERO_SPLIT, isBalanced, splitTotal } from "../PaymentBreakdown";
import { SheetNestedScrollView } from "../BottomSheetModal";
import { doneBarFor } from "./KeyboardDone";
import type { SplitAmounts } from "../../api/investments";
import { dmy } from "../../lib/format";

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
export function Input({ style, editable = true, ...rest }: TextInputProps & { ref?: React.Ref<TextInput> }) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={C.muted}
      allowFontScaling={false}
      editable={editable}
      inputAccessoryViewID={doneBarFor(rest.keyboardType)}
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
// Shown as DD-MM-YYYY; the value itself stays YYYY-MM-DD.
export function isoToPretty(v?: string | null) {
  return v ? dmy(v) : "";
}

export function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function DateField({
  label,
  value,
  onChange,
  placeholder = "DD-MM-YYYY",
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
  const [pickYear, setPickYear] = useState(false);
  const init = value ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1) : new Date();
  const [cursor, setCursor] = useState(new Date(init.getFullYear(), init.getMonth(), 1));
  const thisYear = new Date().getFullYear();
  const minYear = min ? +min.slice(0, 4) : thisYear - 100;
  const maxYear = max ? +max.slice(0, 4) : thisYear + 20;
  const years = useMemo(() => Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i), [minYear, maxYear]);
  const yearScroll = useRef<ScrollView>(null);
  return (
    <Field label={label}>
      <Pressable
        onPress={() => {
          const base = value ? new Date(+value.slice(0, 4), +value.slice(5, 7) - 1, 1) : new Date();
          setCursor(new Date(base.getFullYear(), base.getMonth(), 1));
          setPickYear(false);
          Keyboard.dismiss();
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
          <Pressable style={s.calTitleBtn} onPress={() => setPickYear((y) => !y)} hitSlop={6} accessibilityLabel="Choose year">
            <Txt style={s.calTitle}>
              {cursor.toLocaleString("en-IN", { month: "long" })} {cursor.getFullYear()}
            </Txt>
            <View style={pickYear ? { transform: [{ rotate: "180deg" }] } : null}>
              <PIcon name="chevdown" color={C.brandDeep} />
            </View>
          </Pressable>
          <Pressable style={[s.calNav, { transform: [{ scaleX: -1 }] }]} onPress={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}>
            <PIcon name="back" color={C.brandDeep} />
          </Pressable>
        </View>
        {pickYear ? (
          <SheetNestedScrollView
            ref={yearScroll}
            style={{ maxHeight: 280 }}
            onLayout={() => {
              const row = Math.floor(years.indexOf(cursor.getFullYear()) / 4);
              yearScroll.current?.scrollTo({ y: Math.max(0, row * 48 - 96), animated: false });
            }}
          >
            <View style={s.yearGrid}>
              {years.map((y) => {
                const sel = y === cursor.getFullYear();
                return (
                  <Pressable
                    key={y}
                    style={[s.yearCell, sel && s.yearCellSel]}
                    onPress={() => {
                      setCursor(new Date(y, cursor.getMonth(), 1));
                      setPickYear(false);
                    }}
                  >
                    <Txt style={[s.yearTxt, sel && { color: "#fff" }]}>{y}</Txt>
                  </Pressable>
                );
              })}
            </View>
          </SheetNestedScrollView>
        ) : null}
        {pickYear ? null : (
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
        )}
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
// A normal dropdown: the field keeps its place in the form (same height as
// an input), the list opens right under it — or above when there's no room
// — over everything else (Popover.tsx), and closes on a pick or any tap
// outside. Opening it never changes the height of the card around it.
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
  const { ref, measure } = useAnchor();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = () => setAnchor(null);
  const openMenu = () => {
    Keyboard.dismiss();
    measure(setAnchor);
  };
  return (
    <View style={style}>
      <View ref={ref} collapsable={false}>
        <Pressable style={[s.input, s.dateBtn, anchor && s.inputFocus]} onPress={() => (anchor ? close() : openMenu())}>
          <Txt style={[s.ddValue, value == null && { color: C.muted }]} numberOfLines={1}>
            {value != null ? labelOf(value) : placeholder}
          </Txt>
          <Chevron open={!!anchor} />
        </Pressable>
      </View>
      <Popover anchor={anchor} onClose={close} onRemeasure={() => measure(setAnchor)}>
        {options.length === 0 ? <Txt style={[s.ddItemTxt, { padding: 10, color: C.muted }]}>No options</Txt> : null}
        {options.map((o, i) => {
          const selected = value != null && (keyOf ? keyOf(o) === keyOf(value) : o === value);
          return (
            <MenuItem
              key={keyOf ? keyOf(o) : i}
              title={labelOf(o)}
              selected={selected}
              onPress={() => {
                onChange(o);
                close();
              }}
            />
          );
        })}
      </Popover>
    </View>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <View style={open ? { transform: [{ rotate: "180deg" }] } : null}>
      <PIcon name="chevdown" color={C.brandDeep} />
    </View>
  );
}

/** Typeable dropdown (karat, fineness, ornament type): a normal input with
 * a chevron; while it's focused the suggestions open under it. `menu`
 * returns the rows (or null for none); call `close` after a pick. */
export function ComboInput({
  value,
  onChangeText,
  menu,
  onClosed,
  onOpened,
  placeholder,
  keyboardType,
  style,
  inputStyle,
}: {
  value: string;
  onChangeText: (v: string) => void;
  menu: (close: () => void) => React.ReactNode | null;
  /** Called whenever the list closes (pick, outside tap, back). */
  onClosed?: () => void;
  /** Called when the field gains focus. */
  onOpened?: () => void;
  placeholder?: string;
  keyboardType?: TextInputProps["keyboardType"];
  style?: StyleProp<ViewStyle>;
  inputStyle?: TextInputProps["style"];
}) {
  const { ref, measure } = useAnchor();
  const input = useRef<TextInput>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const close = () => {
    setAnchor(null);
    input.current?.blur();
    Keyboard.dismiss();
    onClosed?.();
  };
  const body = anchor ? menu(close) : null;
  return (
    <View ref={ref} collapsable={false} style={style}>
      <Input
        ref={input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        keyboardType={keyboardType}
        autoCorrect={false}
        onFocus={() => {
          onOpened?.();
          measure(setAnchor);
        }}
        onBlur={() => {
          if (anchor) {
            setAnchor(null);
            onClosed?.();
          }
        }}
        style={[{ paddingRight: 38 }, inputStyle]}
      />
      <Pressable style={s.comboChev} hitSlop={8} onPress={() => (anchor ? close() : input.current?.focus())} accessibilityLabel="Show options">
        <Chevron open={!!anchor} />
      </Pressable>
      <Popover anchor={body != null ? anchor : null} onClose={close} onRemeasure={() => measure(setAnchor)} maxHeight={240} awaitKeyboard>
        {body}
      </Popover>
    </View>
  );
}

/** One row inside a dropdown list. */
export function MenuItem({ title, sub, selected, accent, onPress }: { title: string; sub?: string; selected?: boolean; accent?: boolean; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [s.ddItem, selected && s.ddItemSel, pressed && !selected && { backgroundColor: C.brandFaint }]} onPress={onPress}>
      <Txt style={[s.ddItemTxt, (selected || accent) && { color: C.brandDeep }, accent && { fontWeight: "700" }]} numberOfLines={2}>
        {title}
      </Txt>
      {sub ? (
        <Txt style={{ fontSize: 11, color: C.muted, marginTop: 1 }} numberOfLines={1}>
          {sub}
        </Txt>
      ) : null}
    </Pressable>
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

/** Searchable dropdown backed by a server `q` query — works like the web's:
 * the field itself is the search box. Tap it and type; the matching rows
 * open right under it, and picking one fills the field. No second search
 * box inside the list. */
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
  onCreateNew,
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
  // Opt-in "+ Create '<query>'" row, shown ahead of results when the typed
  // query doesn't exactly match (case-insensitive) any loaded item's title —
  // same allowCreate convention as the web's SearchableSelect.tsx. Resolves
  // to the created item, which is then selected exactly like a picked row.
  onCreateNew?: (q: string) => Promise<T>;
}) {
  const { ref, measure } = useAnchor();
  const input = useRef<TextInput>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q);
  const open = !!anchor;
  const enabled = open && dq.trim().length >= minChars;
  const { data, isFetching } = useQuery({ queryKey: [...queryKey, dq], queryFn: () => fetcher(dq.trim()), enabled });
  const items = useMemo(() => (data ?? []).slice(0, 30), [data]);
  const [creating, setCreating] = useState(false);
  const close = () => {
    setAnchor(null);
    setQ("");
    input.current?.blur();
    Keyboard.dismiss();
  };
  const showClear = !!selectedLabel && !!onClear && !open;
  const trimmedQ = dq.trim();
  const showCreateRow =
    !!onCreateNew && trimmedQ.length > 0 && !items.some((it) => renderItem(it).title.toLowerCase() === trimmedQ.toLowerCase());
  async function pickCreate() {
    if (!onCreateNew || !trimmedQ || creating) return;
    setCreating(true);
    try {
      const created = await onCreateNew(trimmedQ);
      onSelect(created);
      close();
    } finally {
      setCreating(false);
    }
  }
  return (
    <Field label={label}>
      <View ref={ref} collapsable={false}>
        <Input
          ref={input}
          value={open ? q : selectedLabel ?? ""}
          onChangeText={setQ}
          placeholder={open && selectedLabel ? selectedLabel : placeholder || "Search"}
          autoCorrect={false}
          onFocus={() => measure(setAnchor)}
          onBlur={() => {
            if (anchor) {
              setAnchor(null);
              setQ("");
            }
          }}
          style={{ paddingRight: showClear ? 66 : 38 }}
        />
        {showClear ? (
          <Pressable style={[s.comboChev, { right: 30, width: 32 }]} hitSlop={8} onPress={onClear} accessibilityLabel="Clear">
            <PIcon name="close" color={C.muted} size={14} />
          </Pressable>
        ) : null}
        <Pressable style={s.comboChev} hitSlop={8} onPress={() => (open ? close() : input.current?.focus())} accessibilityLabel="Show options">
          <Chevron open={open} />
        </Pressable>
      </View>
      <Popover anchor={anchor} onClose={close} onRemeasure={() => measure(setAnchor)} maxHeight={280} minWidth={240} awaitKeyboard>
        {showCreateRow ? (
          <MenuItem title={creating ? "Creating…" : `+ Create "${trimmedQ}"`} onPress={pickCreate} />
        ) : null}
        {isFetching && items.length === 0 ? (
          <View style={{ paddingVertical: 14, alignItems: "center" }}>
            <Spinner size={20} />
          </View>
        ) : items.length === 0 && !showCreateRow ? (
          <Txt style={[s.ddItemTxt, { padding: 10, color: C.muted }]}>{dq.trim().length < minChars ? "Type to search" : "No matches"}</Txt>
        ) : (
          items.map((it) => {
            const r = renderItem(it);
            return (
              <MenuItem
                key={keyOf(it)}
                title={r.title}
                sub={r.sub}
                onPress={() => {
                  onSelect(it);
                  close();
                }}
              />
            );
          })
        )}
      </Popover>
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
      {loading ? <Spinner color={fg} size={20} /> : <Txt style={[s.btnTxt, { color: fg }]}>{label}</Txt>}
    </Pressable>
  );
}

(PrimaryButton as { stickyFooter?: boolean }).stickyFooter = true;

/** .btn-row-2 */
export function BtnRow2({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.btnRow2, style]}>
      {React.Children.map(children, (c) => (c ? <View style={{ flex: 1 }}>{c}</View> : null))}
    </View>
  );
}

(BtnRow2 as { stickyFooter?: boolean }).stickyFooter = true;

/** Themed replacement for a native Alert.alert() confirm: a rise-up sheet
 * with the message, an optional remarks field, and Cancel / confirm. */
export function ConfirmSheet({
  visible,
  onClose,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  remarks,
  loading,
  error,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Show a remarks input (value is passed to onConfirm). */
  remarks?: { label: string; placeholder?: string; required?: boolean; initial?: string };
  loading?: boolean;
  error?: string | null;
  onConfirm: (remarks: string) => void;
}) {
  const [text, setText] = useState("");
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setText(remarks?.initial ?? "");
  }
  return (
    <Sheet visible={visible} onClose={onClose} title={title} maxHeightPct={70}>
      {danger ? <WarningBanner>{message}</WarningBanner> : <Txt style={{ fontSize: 13, lineHeight: 19, marginVertical: 10 }}>{message}</Txt>}
      {remarks ? (
        <Field label={remarks.label}>
          <Input placeholder={remarks.placeholder} value={text} onChangeText={setText} multiline />
        </Field>
      ) : null}
      {error ? <Txt style={{ color: C.red, fontSize: 12, fontWeight: "600", marginBottom: 6 }}>{error}</Txt> : null}
      <BtnRow2>
        <PrimaryButton label="Cancel" variant="outline" onPress={onClose} disabled={loading} />
        <PrimaryButton
          label={confirmLabel}
          variant={danger ? "danger" : "primary"}
          onPress={() => onConfirm(text.trim())}
          loading={loading}
          disabled={!!remarks?.required && !text.trim()}
        />
      </BtnRow2>
    </Sheet>
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
        {match ? null : <Txt style={[s.splitTotalTxt, { color: C.red }]}>Must equal {fmtINR(amount)}</Txt>}
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
    backgroundColor: C.card,
    color: C.ink,
  },
  inputFocus: { borderColor: C.brand },
  inputDisabled: { color: C.muted },
  dateBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },

  calHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  calTitle: { fontWeight: "700", fontSize: 14 },
  calTitleBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 10, backgroundColor: C.brandFaint },
  yearGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8, paddingBottom: 6 },
  yearCell: { width: "23%", height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: C.line },
  yearCellSel: { backgroundColor: C.brandDeep, borderColor: C.brandDeep },
  yearTxt: { fontSize: 13, fontWeight: "700", color: C.ink },
  calNav: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.brandFaint, alignItems: "center", justifyContent: "center" },

  ddBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 7, borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: C.card },
  ddValue: { fontSize: 13.5, flex: 1, color: C.ink },
  ddLabel: { fontSize: 12.5, fontWeight: "600", flexShrink: 1 },
  comboChev: { position: "absolute", right: 0, top: 0, bottom: 0, width: 38, alignItems: "center", justifyContent: "center" },
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
