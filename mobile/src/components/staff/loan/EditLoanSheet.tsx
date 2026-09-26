import React, { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, DashedButton, Field, FieldRow, Input, NoticeBanner, OrnamentCard, PrimaryButton, SectionTitle, Sheet, TextField, ThemeDropdown, Txt } from "../../ui";
import { addOrnament, deleteOrnament, updateLoan, updateOrnament, type OrnamentRequestInput } from "../../../api/loans";
import { listSchemes } from "../../../api/schemes";
import type { Loan, Ornament } from "../../../types/loan";
import type { Scheme } from "../../../types/scheme";
import { ErrorText, apiErr, invalidateLoan } from "./common";

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

/** Prototype #act-edit — scheme, principal and ornament details. Mirrors web
 * EditLoanModal.tsx: loan PATCH, then one call per ornament row. */
export function EditLoanSheet({ loan: l, visible, onClose }: { loan: Loan; visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [schemeId, setSchemeId] = useState<number>(l.schemeId);
  const [schemeLabel, setSchemeLabel] = useState("");
  const [principal, setPrincipal] = useState("");
  const [rows, setRows] = useState<OrnRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setSchemeId(l.schemeId);
    setSchemeLabel(l.scheme ? `${l.scheme.name} — ${l.scheme.interestRate}%/mo` : `Scheme #${l.schemeId}`);
    setPrincipal(String(l.principalAmount));
    setRows((l.ornaments ?? []).map(toRow));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const active = rows.filter((r) => !r.removed);
  const upd = (i: number, patch: Partial<OrnRow>) => setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch } : r)));

  const save = useMutation({
    mutationFn: async () => {
      if (!(+principal > 0)) throw new Error("__v__Please enter a valid principal amount.");
      if (!active.length) throw new Error("__v__A loan must have at least one ornament.");
      if (active.some((r) => !r.name.trim() || !(+r.gross > 0) || !(+r.net > 0))) throw new Error("__v__Every ornament needs a name, gross weight and net weight.");
      if (active.some((r) => +r.net > +r.gross)) throw new Error("__v__Net Wt cannot be greater than Gross Wt for any ornament.");
      await updateLoan(l.id, {
        schemeId: schemeId !== l.schemeId ? schemeId : undefined,
        principalAmount: +principal !== l.principalAmount ? +principal : undefined,
      });
      for (const r of rows) {
        const input: OrnamentRequestInput = {
          name: r.name.trim(),
          purity: r.purity,
          grossWeight: +r.gross,
          deductionWeight: Math.max(0, +r.gross - +r.net),
          quantity: +r.qty || 1,
        };
        if (r.removed) {
          if (r.id) await deleteOrnament(r.id);
        } else if (r.id) await updateOrnament(r.id, input);
        else await addOrnament(l.id, input);
      }
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

  const totalNet = active.reduce((s, r) => s + (+r.net || 0) * (+r.qty || 1), 0);

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit Loan Details" maxHeightPct={90}>
      <NoticeBanner>
        Changing the scheme or principal amount requires re-approval before the loan is active again — saving will resubmit it through the sanction chain from the first stage.
      </NoticeBanner>

      <AsyncSelect<Scheme>
        label="Scheme"
        placeholder="Search schemes"
        queryKey={["editLoanSchemes"]}
        fetcher={(q) => listSchemes(q || undefined)}
        selectedLabel={schemeLabel}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: `${s.name} — ${s.interestRate}%/mo`, sub: `${s.ltvPercent}% LTV` })}
        onSelect={(s) => {
          setSchemeId(s.id);
          setSchemeLabel(`${s.name} — ${s.interestRate}%/mo`);
        }}
      />
      <TextField label="Principal amount" keyboardType="decimal-pad" value={principal} onChangeText={setPrincipal} />

      <SectionTitle flush style={{ marginTop: 14 }}>
        Ornaments
      </SectionTitle>
      {rows.map((r, i) =>
        r.removed ? null : (
          <OrnamentCard key={r.id ?? `new-${i}`} title={r.name.trim() || `Ornament ${i + 1}`} onRemove={() => upd(i, { removed: true })}>
            <TextField label="Name" value={r.name} onChangeText={(v) => upd(i, { name: v })} />
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
