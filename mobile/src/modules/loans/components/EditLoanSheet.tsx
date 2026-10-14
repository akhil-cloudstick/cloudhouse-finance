import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, DashedButton, Field, FieldRow, Input, NoticeBanner, OrnamentCard, PrimaryButton, ResultBox, SectionTitle, Sheet, TextField, ThemeDropdown, Txt } from "@/common/components/ui";
import { useQuery } from "@tanstack/react-query";
import { latestGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { rateForPurityFull } from "@/common/utils/purity";
import { inr } from "@/common/utils/format";
import { addOrnament, deleteOrnament, updateLoan, updateOrnament } from "@/modules/loans/services/loanService";
import { type OrnamentRequestInput, type Loan, type Ornament } from "@/modules/loans/types/loan-types";
import { listActiveSchemes } from "@/modules/schemes/services/schemeService";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { OrnamentTypeField } from "@/common/components/OrnamentTypeField";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";

type OrnRow = { id?: number; name: string; purity: string; gross: string; net: string; qty: string; removed?: boolean };
const PURITIES = ["24K", "23K", "22K", "21K", "20K", "18K", "16K", "14K"];

const toRow = (o: Ornament): OrnRow => ({
  id: o.id,
  name: o.name,
  purity: o.purity,
  gross: String(o.grossWeight),
  net: String(o.netWeight),
  qty: String(o.quantity),
});

type EditLoanSheetProps = { loan: Loan; visible: boolean; onClose: () => void };

/** Prototype #act-edit — scheme, principal and ornament details. Mirrors web
 * EditLoanModal.tsx: loan PATCH, then one call per ornament row. */
export function EditLoanSheet({ loan: l, visible, onClose }: EditLoanSheetProps) {
  const qc = useQueryClient();
  const [schemeId, setSchemeId] = useState<number>(l.schemeId);
  const [schemeLabel, setSchemeLabel] = useState("");
  const [schemeLtv, setSchemeLtv] = useState(0);
  const [principal, setPrincipal] = useState("");
  const [rows, setRows] = useState<OrnRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSchemeId(l.schemeId);
    setSchemeLabel(l.scheme ? `${l.scheme.name} — ${l.schemeLtvPercent ?? l.scheme.ltvPercent}% LTV @ ${l.scheme.interestRate}%` : `Scheme #${l.schemeId}`);
    setSchemeLtv(l.schemeLtvPercent ?? l.scheme?.ltvPercent ?? 0);
    setPrincipal(String(l.principalAmount));
    setRows((l.ornaments ?? []).map(toRow));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const active = rows.filter((r) => !r.removed);
  const upd = (i: number, patch: Partial<OrnRow>) => setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  // Live estimate of what the loan can carry, from the same rates the backend uses (22K / 18K at their own
  // published rates). Net weight × rate per ornament — quantity is not multiplied in (the backend values
  // GoldValue = NetWeight × rate), so this matches what Save will accept.
  const goldRate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible });
  const rates = { k24: goldRate.data?.k24 ?? 0, k22: goldRate.data?.k22 ?? 0, k18: goldRate.data?.k18 ?? 0 };
  const totalGoldValue = active.reduce((s, r) => s + (+r.net || 0) * (rateForPurityFull(rates, r.purity) ?? 0), 0);
  const eligible = (totalGoldValue * schemeLtv) / 100;
  // The principal can never be typed above the eligible amount — pulled back to it (floored to a whole rupee).
  const capToEligible = (value: string) => (eligible > 0 && +value > eligible ? String(Math.floor(eligible)) : value);
  // Only a changed scheme or principal sends the loan back through the sanction chain (same as the backend).
  const triggersReapproval = schemeId !== l.schemeId || (+principal > 0 && +principal !== l.principalAmount);
  const save = useMutation({
    mutationFn: async () => {
      if (!(+principal > 0)) throw new Error("__v__Please enter a valid principal amount.");
      if (!active.length) throw new Error("__v__A loan must have at least one ornament.");
      if (active.some((r) => !r.name.trim() || !(+r.gross > 0) || !(+r.net > 0))) throw new Error("__v__Every ornament needs a name, gross weight and net weight.");
      if (active.some((r) => +r.net > +r.gross)) throw new Error("__v__Net Wt cannot be greater than Gross Wt for any ornament.");
      if (goldRate.data && eligible > 0 && +principal > eligible) throw new Error(`__v__Principal amount cannot exceed the eligible loan amount (${inr(Math.floor(eligible))}).`);
      // Ornaments are saved BEFORE the loan: each call revalues its row and recalculates the loan's eligible amount, while
      // the loan update only checks the values already stored — so a principal raised together with new ornaments
      // would otherwise be refused against the old values (same order as web).
      for (const r of rows) {
        const input: OrnamentRequestInput = {
          name: r.name.trim(),
          purity: r.purity,
          grossWeight: +r.gross,
          deductionWeight: Math.round(Math.max(0, +r.gross - +r.net) * 1000) / 1000,
          quantity: +r.qty || 1,
        };
        if (r.removed) {
          if (r.id) await deleteOrnament(r.id);
        } else if (r.id) await updateOrnament(r.id, input);
        else await addOrnament(l.id, input);
      }
      await updateLoan(l.id, {
        schemeId: schemeId !== l.schemeId ? schemeId : undefined,
        principalAmount: +principal !== l.principalAmount ? +principal : undefined,
      });
    },
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => {
      if (e instanceof Error && e.message.startsWith("__v__")) return setError(e.message.slice(5));
      setError(apiErr(e, "Could not save changes — try again."));
      // Part of the edit may have landed — refresh so the sheet reopens on the truth.
      invalidateLoan(qc, l.id);
    },
  });

  const totalNet = active.reduce((s, r) => s + (+r.net || 0), 0);

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit Loan Details" maxHeightPct={90}>
      {triggersReapproval ? <NoticeBanner>
        Changing the scheme or principal amount requires re-approval before the loan is active again — saving will resubmit it through the sanction chain from its first enabled stage.
      </NoticeBanner> : null}

      <AsyncSelect<Scheme>
        label="Scheme"
        placeholder="Search schemes"
        queryKey={["editLoanSchemes"]}
        fetcher={(q) => listActiveSchemes(q || undefined)}
        selectedLabel={schemeLabel}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: `${s.name} — ${s.ltvPercent}% LTV @ ${s.interestRate}%`, sub: s.code })}
        onSelect={(s) => {
          setSchemeId(s.id);
          setSchemeLabel(`${s.name} — ${s.ltvPercent}% LTV @ ${s.interestRate}%`);
          setSchemeLtv(s.ltvPercent);
        }}
      />
      <ResultBox k="Eligible loan amount" v={eligible > 0 ? inr(Math.floor(eligible)) : "—"} />
      <TextField label={`Principal amount${eligible > 0 ? ` (max ${inr(Math.floor(eligible))})` : ""}`} keyboardType="decimal-pad" value={principal} onChangeText={(v) => setPrincipal(capToEligible(v))} />

      <SectionTitle flush style={{ marginTop: 14 }}>
        Ornaments
      </SectionTitle>
      {rows.map((r, i) =>
        r.removed ? null : (
          <OrnamentCard key={r.id ?? `new-${i}`} title={r.name.trim() || `Ornament ${i + 1}`} onRemove={() => upd(i, { removed: true })}>
            <OrnamentTypeField value={r.name} onChange={(v) => upd(i, { name: v })} />
            <FieldRow>
              <Field label="Purity">
                <ThemeDropdown value={r.purity} options={PURITIES.includes(r.purity) ? PURITIES : [r.purity, ...PURITIES]} onChange={(v) => upd(i, { purity: v })} labelOf={(p) => p} />
              </Field>
              <Field label="Qty">
                <Input keyboardType="number-pad" value={r.qty} onChangeText={(v) => upd(i, { qty: v })} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Gross (g)">
                <Input keyboardType="decimal-pad" value={r.gross} onChangeText={(v) => upd(i, { gross: v })} />
              </Field>
              <Field label="Net (g)">
                <Input keyboardType="decimal-pad" value={r.net} onChangeText={(v) => upd(i, { net: v })} />
              </Field>
            </FieldRow>
          </OrnamentCard>
        )
      )}
      <DashedButton label="Add Ornament" onPress={() => setRows((rs) => [...rs, { name: "", purity: "22K", gross: "", net: "", qty: "1" }])} />
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 12 }}>Total net weight: {totalNet.toFixed(2)} g</Txt>

      <ErrorText>{error}</ErrorText>
      <PrimaryButton
        label="Save Changes"
        onPress={() => {
          setError(null);
          save.mutate();
        }}
        loading={save.isPending}
      />
    </Sheet>
  );
}
