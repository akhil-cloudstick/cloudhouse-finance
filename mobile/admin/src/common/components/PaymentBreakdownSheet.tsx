import { useState } from "react";
import { ThemedText } from "@/common/components/ui/ThemedText";
import { GoldButton } from "@/common/components/ui/GoldButton";
import { BottomSheetModal } from "@/common/components/ui/BottomSheetModal";
import { SheetScrollView } from "@/common/components/ui/SheetScrollView";
import { colors } from "@/common/theme/colors";
import type { SplitAmounts } from "@/modules/investments/types/investment-types";
import { PaymentSplitInput } from "./PaymentSplitInput";
import { ZERO_SPLIT, isBalanced } from "@/common/utils/paymentSplit";

type PaymentBreakdownSheetProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  total: number;
  confirmLabel: string;
  onConfirm: (split: SplitAmounts) => void;
  loading?: boolean;
  error?: string | null;
};

/** Rise-up sheet that collects the breakdown for a fixed amount, e.g. a loan
 * disbursement, then confirms. */
export function PaymentBreakdownSheet({
  visible,
  onClose,
  title,
  subtitle,
  total,
  confirmLabel,
  onConfirm,
  loading,
  error,
}: PaymentBreakdownSheetProps) {
  const [split, setSplit] = useState<SplitAmounts>(ZERO_SPLIT);
  const balanced = isBalanced(split, total);
  return (
    <BottomSheetModal visible={visible} onClose={onClose} maxHeightPct={90}>
      <SheetScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <ThemedText variant="h3" style={{ marginBottom: 4 }}>
          {title}
        </ThemedText>
        {subtitle ? (
          <ThemedText variant="small" color={colors.muted} style={{ marginBottom: 14 }}>
            {subtitle}
          </ThemedText>
        ) : null}
        <PaymentSplitInput total={total} value={split} onChange={setSplit} />
        {error ? (
          <ThemedText variant="small" color={colors.red} style={{ marginBottom: 10 }}>
            {error}
          </ThemedText>
        ) : null}
        <GoldButton title={confirmLabel} onPress={() => onConfirm(split)} loading={loading} disabled={!balanced} style={{ marginBottom: 8 }} />
      </SheetScrollView>
    </BottomSheetModal>
  );
}
