import type { ReactNode } from "react";
import { Pressable, View, type StyleProp, type ViewStyle } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { PIcon } from "./PIcon";
import { SearchInput } from "./SearchInput";

type SearchFilterRowProps = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  /** Filter button(s) shown beside the search (e.g. <GroupedFilter/>). Omit for a full-width search. */
  filter?: ReactNode;
  /** Outer spacing override (default: 18 side gutter, 10 below). */
  style?: StyleProp<ViewStyle>;
};

/** Plain filter button (same look as GroupedFilter's trigger) for pages with a custom filter sheet. */
export function FilterButton({ count = 0, onPress, label = "Filters" }: { count?: number; onPress: () => void; label?: string }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.card }}
    >
      <PIcon name="filter" color={C.ink} size={17} />
      {count > 0 ? (
        <View style={{ minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3, alignItems: "center", justifyContent: "center", backgroundColor: C.brandDeep }}>
          <Txt style={{ color: "#fff", fontSize: 10, fontWeight: "800" }}>{count}</Txt>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Standard list header: search input (flex 1) with the filter button(s) on the same line. */
export function SearchFilterRow({ value, onChangeText, placeholder, filter, style }: SearchFilterRowProps) {
  if (!filter) {
    return <SearchInput value={value} onChangeText={onChangeText} placeholder={placeholder} style={style} />;
  }
  return (
    <View style={[{ flexDirection: "row", alignItems: "stretch", gap: 8, paddingHorizontal: 18, paddingBottom: 10 }, style]}>
      <View style={{ flex: 1 }}>
        <SearchInput value={value} onChangeText={onChangeText} placeholder={placeholder} style={{ paddingHorizontal: 0, paddingBottom: 0 }} />
      </View>
      {filter}
    </View>
  );
}
