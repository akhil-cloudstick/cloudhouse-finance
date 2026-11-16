import { SELECTION_COLOR } from "@/common/theme/colors";
import { useState } from "react";
import { Pressable, TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { textStyle } from "@/common/theme/typography";
import { C } from "./base";
import { PIcon } from "./PIcon";
import { s } from "./listKitStyles";

type SearchInputProps = {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
  style?: StyleProp<ViewStyle>;
};

/** .local-search-input — every page's search box (server `q`). */
export function SearchInput({
  value,
  onChangeText,
  placeholder,
  style,
}: SearchInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.searchWrap, style]}>
      <View style={{ position: "relative", justifyContent: "center" }}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.placeholder}
        cursorColor={C.brand}
        selectionColor={SELECTION_COLOR}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        allowFontScaling={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={textStyle([s.search, focused && { borderColor: C.brand }, !!value && { paddingRight: 44 }], false)}
      />
      {value ? (
        <Pressable
          style={{ position: "absolute", right: 8, top: 0, bottom: 0, width: 28, alignItems: "center", justifyContent: "center" }}
          hitSlop={8}
          onPress={() => onChangeText("")}
          accessibilityLabel="Clear search"
        >
          <PIcon name="close" color={C.muted} size={14} />
        </Pressable>
      ) : null}
      </View>
    </View>
  );
}
