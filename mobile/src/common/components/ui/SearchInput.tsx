import { useState } from "react";
import { TextInput, View, type StyleProp, type ViewStyle } from "react-native";
import { textStyle } from "@/common/theme/typography";
import { C } from "./base";
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
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.placeholder}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="none"
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        allowFontScaling={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={textStyle([s.search, focused && { borderColor: C.brand }], false)}
      />
    </View>
  );
}
