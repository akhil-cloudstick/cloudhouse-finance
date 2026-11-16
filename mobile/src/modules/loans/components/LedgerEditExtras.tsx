import React from "react";
import { View } from "react-native";
import { SwitchToggle } from "@/common/components/ui/SwitchToggle";
import { C, Input, Txt } from "@/common/components/ui";
import { inr } from "@/common/utils/format";
import type { LedgerEditPreview, LedgerFollowingEntry } from "@/modules/loans/services/paymentService";

/** The later payments that no longer fit after an edit: what each is now and what it becomes (0 removes it). Mirrors the web's list. */
export function FollowingEntriesInputs({ entries, values, onChange }: { entries: LedgerFollowingEntry[]; values: Record<number, string>; onChange: (id: number, v: string) => void }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Txt style={{ fontSize: 12.5, fontWeight: "700" }}>Payments after this one</Txt>
      <Txt style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>
        Nothing here changes unless you change it. Lower an amount if this edit means it should be different (0 removes it).
        {entries.some((f) => f.needsChange || f.needs_change) ? " A payment marked as not fitting has to be lowered before you can confirm." : ""}
      </Txt>
      {entries.map((f) => (
        <View key={f.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <View style={{ flex: 1 }}>
            <Txt style={{ fontSize: 12.5 }}>
              {(f.paidOn || "").slice(0, 10)} · {f.type || f.reference || "Entry"}
            </Txt>
            <Txt style={{ fontSize: 11.5, color: C.muted }}>Now {inr(f.current)}</Txt>
            {f.needsChange || f.needs_change ? <Txt style={{ fontSize: 11.5, color: C.red }}>No longer fits — at most {inr(f.suggested)}</Txt> : null}
          </View>
          <View style={{ width: 110 }}>
            <Input keyboardType="decimal-pad" value={values[f.id] ?? ""} onChangeText={(v) => onChange(f.id, v)} />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Starting amounts for the following list: each payment's current amount, as the web does. */
export function followingDefaults(res: LedgerEditPreview): Record<number, string> {
  return Object.fromEntries((res.following ?? []).map((f) => [f.id, String(f.current)]));
}

/** Offered only when the server lists a partial release that this edit would undo. */
export function PartialReleaseToggle({ preview, value, onChange }: { preview: LedgerEditPreview | null; value: boolean; onChange: (v: boolean) => void }) {
  const d = preview?.dependents?.find((x) => x.kind === "partial_release");
  if (!d) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 }}>
      <SwitchToggle value={value} onValueChange={onChange} />
      <View style={{ flex: 1 }}>
        <Txt style={{ fontSize: 12.5 }}>
          <Txt style={{ fontWeight: "700" }}>Also update this:</Txt> {d.description}
        </Txt>
        <Txt style={{ fontSize: 11.5, color: C.muted }}>
          {d.current} → {d.suggested}
        </Txt>
        {d.warning && value ? <Txt style={{ fontSize: 11.5, color: C.red }}>{d.warning}</Txt> : null}
      </View>
    </View>
  );
}
