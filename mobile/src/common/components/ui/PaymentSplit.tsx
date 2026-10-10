import { Pressable, View } from "react-native";
import { C } from "./base";
import { Txt } from "./Txt";
import { ZERO_SPLIT, isBalanced, splitTotal } from "@/common/utils/paymentSplit";
import type { SplitAmounts } from "@/modules/investments/types/investment-types";
import { Field } from "./Field";
import { Input } from "./Input";
import { s } from "./formHelpers";

const MODES: { key: keyof SplitAmounts; label: string; all: string }[] = [
  { key: "cashAmount", label: "Cash", all: "All Cash" },
  { key: "upiAmount", label: "UPI", all: "All UPI" },
  { key: "bankTransferAmount", label: "Bank Transfer", all: "All Bank Transfer" },
  { key: "chequeAmount", label: "Cheque", all: "All Cheque" },
];
const fmtINR = (n: number) => `₹${(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
type PaymentSplitProps = { amount: number; value: SplitAmounts; onChange: (v: SplitAmounts) => void; modes?: (keyof SplitAmounts)[] };

export function PaymentSplit({ amount, value, onChange, modes }: PaymentSplitProps) {
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
