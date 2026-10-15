import { useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, TextInput, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { C } from "./base";
import { Spinner } from "./Spinner";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { Popover, useAnchor, type Anchor } from "./Popover";
import { useDebouncedValue } from "@/common/hooks/use-debounced-value";
import { Field } from "./Field";
import { Input } from "./Input";
import { MenuItem } from "./MenuItem";
import { s } from "./formHelpers";
import { Chevron } from "./Chevron";

type AsyncSelectProps<T> = {
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
};

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
}: AsyncSelectProps<T>) {
  const { ref, measure } = useAnchor();
  const input = useRef<TextInput>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [q, setQ] = useState("");
  // Until the user types, an open field keeps showing the current selection (selected, so typing
  // replaces it) instead of going blank; the search itself still starts from an empty query.
  const [typed, setTyped] = useState(false);
  const dq = useDebouncedValue(q);
  const open = !!anchor;
  const enabled = open && dq.trim().length >= minChars;
  const { data, isFetching } = useQuery({ queryKey: [...queryKey, dq], queryFn: () => fetcher(dq.trim()), enabled });
  const items = useMemo(() => (data ?? []).slice(0, 30), [data]);
  const [creating, setCreating] = useState(false);
  const close = () => {
    setAnchor(null);
    setQ("");
    setTyped(false);
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
          value={open && typed ? q : selectedLabel ?? ""}
          onChangeText={(v) => {
            setTyped(true);
            setQ(v);
          }}
          placeholder={placeholder || "Search"}
          autoCorrect={false}
          selectTextOnFocus
          onFocus={() => measure(setAnchor)}
          onBlur={() => {
            if (anchor) {
              setAnchor(null);
              setQ("");
              setTyped(false);
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
