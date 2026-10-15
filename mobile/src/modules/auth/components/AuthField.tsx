import React, { useState } from "react";
import { View, TextInput, TextInputProps } from "react-native";
import { typeScale } from "@/common/theme/typography";
import { useTheme } from "@/common/theme/ThemeProvider";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { Icon } from "@/common/components/ui/Icon";
import { styles } from "./authKitStyles";

// ---------------------------------------------------------------------------
// Inputs

type FieldProps = TextInputProps & {
  ref?: React.Ref<TextInput>;
  label: string;
  icon: string;
  right?: React.ReactNode;
};
export function AuthField({ label, icon, right, onFocus, onBlur, ...rest }: FieldProps) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.fieldGroup}>
      <ThemedText variant="label" color={colors.ink} style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <View
        // Always its own native view + stacking context, so no style change
        // can make Fabric re-parent the TextInput inside it.
        collapsable={false}
        style={[
          styles.field,
          focused
            ? { borderColor: colors.brand, backgroundColor: colors.card }
            : { borderColor: "transparent", backgroundColor: colors.bg },
        ]}
      >
        <View style={[styles.fieldIcon, { backgroundColor: focused ? colors.brandPale : colors.card }]}>
          <Icon name={icon} size={18} color={focused ? colors.brand : colors.muted} />
        </View>
        <TextInput
          placeholderTextColor={colors.muted}
          importantForAutofill="no"
          autoComplete="off"
          selectionColor={colors.brand}
          cursorColor={colors.brand}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.fieldInput, { color: colors.ink, fontFamily: typeScale.body.fontFamily }]}
          {...rest}
        />
        {right}
      </View>
    </View>
  );
}
