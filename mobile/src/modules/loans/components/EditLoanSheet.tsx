import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, ChipToggle, DashedButton, DateField, Field, FieldRow, Input, NoticeBanner, OrnamentCard, PrimaryButton, ResultBox, SectionTitle, Sheet, TextField, ThemeDropdown, Txt } from "@/common/components/ui";
import { useQuery } from "@tanstack/react-query";
import { latestGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { rateForPurityFull } from "@/common/utils/purity";
import { inr, fmtDate, todayISO } from "@/common/utils/format";
import { addOrnament, addOrnamentImage, deleteOrnament, previewLoanEdit, updateLoanWithFlags, updateOrnament, type LoanEditDependent, type LoanEditFollowing, type LoanEditInterestChange } from "@/modules/loans/services/loanService";
import { type OrnamentRequestInput, type Loan, type Ornament } from "@/modules/loans/types/loan-types";
import { listActiveSchemes } from "@/modules/schemes/services/schemeService";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { OrnamentTypeField } from "@/common/components/OrnamentTypeField";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { ErrorText } from "@/common/components/ErrorText";
import { UploadField } from "@/common/components/UploadField";
import { UploadImage } from "@/common/components/BillSheet";
import { useAuth } from "@/common/providers/AuthProvider";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listLockersPage } from "@/modules/lockers/services/lockerService";
import { listPackets } from "@/modules/packets/services/packetService";
import type { Locker } from "@/modules/lockers/types/locker-types";

type OrnRow = { id?: number; name: string; purity: string; gross: string; net: string; qty: string; removed?: boolean; photos: string[]; newPhotos: string[] };
const PURITIES = ["24K", "23K", "22K", "21K", "20K", "18K", "16K", "14K"];

const toRow = (o: Ornament): OrnRow => ({
  id: o.id,
  name: o.name,
  purity: o.purity,
  gross: String(o.grossWeight),
  net: String(o.netWeight),
  qty: String(o.quantity),
  photos: (o.images ?? []).map((i) => i.imageUrl),
  newPhotos: [],
});

type EditLoanSheetProps = { loan: Loan; visible: boolean; onClose: () => void };

/** Prototype #act-edit — scheme, principal and ornament details. Mirrors web
 * EditLoanModal.tsx: loan PATCH, then one call per ornament row. */
export function EditLoanSheet({ loan: l, visible, onClose }: EditLoanSheetProps) {
  const lockersAllFull = useRef(false);
  const qc = useQueryClient();
  const [schemeId, setSchemeId] = useState<number>(l.schemeId);
  const [schemeLabel, setSchemeLabel] = useState("");
  const [schemeLtv, setSchemeLtv] = useState(0);
  // The loan's opening date; changing it moves the due date and redoes the interest from the new date.
  const [openedDate, setOpenedDate] = useState(l.openedDate);
  // A scheme not based on gold LTV (LTV 0) puts no cap on the amount.
  const ltvBased = schemeLtv > 0;
  // The Amount the customer asks for (like New Loan): the principal follows it, with the service charge added on top
  // or taken off the payout depending on the charge method.
  const [principal, setPrincipal] = useState("");
  type ChargeMode = "WithheldFromPayout" | "AddedToPrincipal";
  const loanMode: ChargeMode = l.serviceChargeMode === "AddedToPrincipal" ? "AddedToPrincipal" : "WithheldFromPayout";
  const [chargeMode, setChargeMode] = useState<ChargeMode>(loanMode);
  const [newScheme, setNewScheme] = useState<Scheme | null>(null);
  const [rows, setRows] = useState<OrnRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [overallPhoto, setOverallPhoto] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  // Branch / locker: only for a role that may see every branch (backend enforces the same).
  const { can } = useAuth();
  const canMove = can("Branch_Management", "can_view_all_branches");
  const [branch, setBranch] = useState<{ id: number; name: string } | null>(null);
  const [locker, setLocker] = useState<Locker | null>(null);
  const packets = useQuery({ queryKey: ["packets", "loan", l.id], queryFn: () => listPackets({ loanId: l.id }), enabled: visible && canMove });
  const packetLockerId = packets.data?.[0]?.currentLockerId ?? null;
  const hasPacket = (packets.data?.length ?? 0) > 0;
  // Review step for a disbursed loan: what the edit would do to later payments / released gold, shown before saving.
  const [reviewedFor, setReviewedFor] = useState<string | null>(null);
  const [following, setFollowing] = useState<LoanEditFollowing[]>([]);
  const [deps, setDeps] = useState<LoanEditDependent[]>([]);
  const [interest, setInterest] = useState<LoanEditInterestChange[]>([]);
  const [follow, setFollow] = useState<Record<number, string>>({});
  const [chosenDeps, setChosenDeps] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!visible) return;
    setSchemeId(l.schemeId);
    setSchemeLabel(l.scheme ? `${l.scheme.name} — ${l.schemeLtvPercent ?? l.scheme.ltvPercent}% LTV @ ${l.scheme.interestRate}%` : `Scheme #${l.schemeId}`);
    setSchemeLtv(l.schemeLtvPercent ?? l.scheme?.ltvPercent ?? 0);
    setOpenedDate(l.openedDate);
    setPrincipal(String(Math.round((l.principalAmount - (loanMode === "AddedToPrincipal" ? l.serviceChargeAmount ?? 0 : 0)) * 100) / 100));
    setChargeMode(loanMode);
    setNewScheme(null);
    setRows((l.ornaments ?? []).map(toRow));
    setError(null);
    setReviewedFor(null);
    setOverallPhoto(l.overallPhotoUrl ?? "");
    setAdditionalInfo(l.additionalInfo ?? "");
    setBranch(null);
    setLocker(null);
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
  const capToEligible = (value: string) => (ltvBased && eligible > 0 && +value > eligible ? String(Math.floor(eligible)) : value);
  // Service charge: the switched scheme's terms, else the loan's own; worked out on the Amount.
  const useNew = newScheme !== null && schemeId !== l.schemeId;
  const chargeType = useNew ? newScheme.serviceChargeType : l.serviceChargeType;
  const chargeValue = useNew ? newScheme.serviceChargeValue ?? 0 : l.serviceChargeValue ?? 0;
  const hasCharge = !!chargeType && chargeType !== "None";
  const amountNum = +principal > 0 ? +principal : 0;
  const charge = !hasCharge ? 0 : chargeType === "Percent" ? Math.round(amountNum * chargeValue) / 100 : useNew ? chargeValue : l.serviceChargeAmount ?? 0;
  const principalTotal = amountNum > 0 ? Math.round((hasCharge && chargeMode === "AddedToPrincipal" ? amountNum + charge : amountNum) * 100) / 100 : l.principalAmount;
  const payout = hasCharge && chargeMode === "WithheldFromPayout" ? amountNum - charge : amountNum;
  const modeChanged = hasCharge && chargeMode !== loanMode;
  // A switched scheme brings its own mode on the server, so the chosen one is always sent along with it.
  const sendMode = hasCharge && (modeChanged || schemeId !== l.schemeId);
  // Only a changed scheme, principal or charge method sends the loan back through the sanction chain (same as the backend).
  const triggersReapproval = schemeId !== l.schemeId || (amountNum > 0 && principalTotal !== l.principalAmount) || modeChanged;
  const reviewKey = `${schemeId}|${principalTotal}|${modeChanged ? chargeMode : ""}`;
  const reviewing = reviewedFor === reviewKey;
  const activeFollowing = reviewing ? following : [];
  const activeDeps = reviewing ? deps : [];
  const save = useMutation({
    mutationFn: async () => {
      if (!(amountNum > 0)) throw new Error("__v__Please enter a valid amount.");
      if (hasCharge && payout <= 0) throw new Error("__v__The service charge must be less than the amount.");
      if (!active.length) throw new Error("__v__A loan must have at least one ornament.");
      if (active.some((r) => !r.name.trim() || !(+r.gross > 0) || !(+r.net > 0))) throw new Error("__v__Every ornament needs a name, gross weight and net weight.");
      if (active.some((r) => +r.net > +r.gross)) throw new Error("__v__Net Wt cannot be greater than Gross Wt for any ornament.");
      if (additionalInfo.trim().length > 150) throw new Error("__v__Additional information cannot be longer than 150 characters.");
      const branchChanged = !!branch && branch.id !== l.branchId;
      const lockerChanged = !!locker && locker.id !== packetLockerId;
      if (canMove && branchChanged && hasPacket && packetLockerId && !locker) throw new Error("__v__Choose a locker in the new branch for the gold.");
      if (goldRate.data && eligible > 0 && amountNum > eligible) throw new Error("__v__Amount exceeds eligible amount.");
      // A disbursed loan recalculated by a scheme / principal change is looked at first: nothing is saved until the
      // staff member has seen the later payments it affects and pressed Save again (same as web).
      const principalChanged = principalTotal !== l.principalAmount;
      if (l.disbursementDate && (schemeId !== l.schemeId || principalChanged || modeChanged) && !reviewing) {
        const probe = await previewLoanEdit(l.id, {
          schemeId: schemeId !== l.schemeId ? schemeId : undefined,
          principalAmount: principalChanged ? principalTotal : undefined,
          serviceChargeMode: sendMode ? chargeMode : undefined,
        });
        if (probe.following.length || probe.dependents.length || probe.interestChanges.length) {
          setFollowing(probe.following);
          setDeps(probe.dependents);
          setInterest(probe.interestChanges);
          setFollow(Object.fromEntries(probe.following.map((f) => [f.id, String(f.current)])));
          setChosenDeps(Object.fromEntries(probe.dependents.map((d) => [d.kind, true])));
          setReviewedFor(reviewKey);
          throw new Error("__review__");
        }
      }
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
        } else if (r.id) {
          await updateOrnament(r.id, input);
          for (const url of r.newPhotos) await addOrnamentImage(r.id, url);
        } else await addOrnament(l.id, { ...input, images: r.newPhotos });
      }
      await updateLoanWithFlags(
        l.id,
        {
          schemeId: schemeId !== l.schemeId ? schemeId : undefined,
          principalAmount: principalChanged ? principalTotal : undefined,
          serviceChargeMode: sendMode ? chargeMode : undefined,
          openedDate: openedDate && openedDate !== l.openedDate ? openedDate : undefined,
          overallPhotoUrl: overallPhoto !== (l.overallPhotoUrl ?? "") ? overallPhoto : undefined,
          additionalInfo: additionalInfo.trim() !== (l.additionalInfo ?? "").trim() ? additionalInfo.trim() : undefined,
          ...(canMove && branchChanged ? { branchId: branch!.id } : {}),
          ...(canMove && hasPacket && lockerChanged ? { lockerId: locker!.id } : {}),
        },
        {
          adjustFollowing: activeFollowing.length ? activeFollowing.map((f) => ({ id: f.id, amount: +(follow[f.id] ?? f.current) || 0 })) : undefined,
          reversePacket: activeDeps.some((d) => d.kind === "packet") && !!chosenDeps.packet,
          restorePartialRelease: activeDeps.some((d) => d.kind === "partial_release") && !!chosenDeps.partial_release,
        }
      );
    },
    onSuccess: () => {
      invalidateLoan(qc, l.id);
      onClose();
    },
    onError: (e) => {
      if (e instanceof Error && e.message === "__review__") return;
      if (e instanceof Error && e.message.startsWith("__v__")) return setError(e.message.slice(5));
      setError(apiErr(e, "Could not save changes — try again."));
      // Part of the edit may have landed — refresh so the sheet reopens on the truth.
      invalidateLoan(qc, l.id);
    },
  });

  const totalNet = active.reduce((s, r) => s + (+r.net || 0), 0);

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit Loan Details" maxHeightPct={90}>
      {triggersReapproval ? (
        l.disbursementDate ? (
          <NoticeBanner>
            This loan is already disbursed. Changing the scheme or principal applies immediately: interest is recalculated from the opening date and the loan's ledger and cash entries are rewritten. It is not sent for re-approval.
          </NoticeBanner>
        ) : (
          <NoticeBanner>
            Changing the scheme or principal amount requires re-approval before the loan is active again — saving will resubmit it through the sanction chain from its first enabled stage.
          </NoticeBanner>
        )
      ) : null}

      <AsyncSelect<Scheme>
        label="Scheme"
        placeholder="Search schemes"
        queryKey={["editLoanSchemes"]}
        fetcher={(q) => listActiveSchemes(q || undefined)}
        selectedLabel={schemeLabel}
        keyOf={(s) => s.id}
        renderItem={(s) => ({ title: s.ltvBased === false ? `${s.name} — @ ${s.interestRate}%` : `${s.name} — ${s.ltvPercent}% LTV @ ${s.interestRate}%`, sub: s.code })}
        onSelect={(s) => {
          setSchemeId(s.id);
          setSchemeLabel(s.ltvBased === false ? `${s.name} — @ ${s.interestRate}%` : `${s.name} — ${s.ltvPercent}% LTV @ ${s.interestRate}%`);
          setSchemeLtv(s.ltvBased === false ? 0 : s.ltvPercent);
          setNewScheme(s);
          setChargeMode(s.serviceChargeMode === "AddedToPrincipal" ? "AddedToPrincipal" : "WithheldFromPayout");
        }}
      />
      {ltvBased ? <ResultBox k="Eligible loan amount" v={eligible > 0 ? inr(Math.floor(eligible)) : "—"} /> : null}
      <DateField label="Loan date" value={openedDate} onChange={setOpenedDate} max={todayISO()} />
      {hasCharge ? (
        <Field label="Charge method">
          <ChipToggle
            options={["WithheldFromPayout", "AddedToPrincipal"] as const}
            labels={{ WithheldFromPayout: "Deduct from loan", AddedToPrincipal: "Add to loan" }}
            value={chargeMode}
            onChange={setChargeMode}
          />
        </Field>
      ) : null}
      <TextField label={`${hasCharge ? "Amount" : "Principal amount"}${eligible > 0 ? ` (max ${inr(Math.floor(eligible))})` : ""}`} keyboardType="decimal-pad" value={principal} onChangeText={(v) => setPrincipal(capToEligible(v))} />
      {hasCharge ? (
        <>
          <ResultBox k={`Service charge${chargeType === "Percent" ? ` (${chargeValue}%)` : ""}`} v={`${chargeMode === "WithheldFromPayout" ? "−" : "+"}${inr(charge)}`} />
          <ResultBox k="Principal" v={inr(principalTotal)} />
          <ResultBox k="Customer receives" v={inr(Math.max(0, payout))} />
        </>
      ) : null}

      {canMove ? (
        <>
          <AsyncSelect<{ id: number; name: string; code?: string }>
            label="Branch"
            placeholder="Search branch"
            queryKey={["branches", "edit-loan"]}
            fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
            selectedLabel={branch?.name ?? `Branch #${l.branchId}`}
            onSelect={(b) => {
              setBranch({ id: b.id, name: b.name });
              setLocker(null);
            }}
            keyOf={(b) => b.id}
            renderItem={(b) => ({ title: b.name, sub: b.code })}
          />
          {hasPacket ? (
            <AsyncSelect<Locker>
              label="Locker"
              placeholder="Search locker code"
              queryKey={["lockers", "edit-loan", branch?.id ?? l.branchId]}
              fetcher={async (q) => {
                const all = (await listLockersPage({ branchId: branch?.id ?? l.branchId, status: "active", q: q || undefined, limit: 20, offset: 0 })).items ?? [];
                const free = all.filter((x) => (x.occupied ?? 0) < x.capacity);
                lockersAllFull.current = all.length > 0 && free.length === 0;
                return free;
              }}
              emptyText={() => (lockersAllFull.current ? "All lockers full" : undefined)}
              selectedLabel={locker ? `${locker.code} (${locker.occupied}/${locker.capacity} packets)` : undefined}
              onSelect={setLocker}
              keyOf={(x) => x.id}
              renderItem={(x) => ({ title: `${x.code} (${x.occupied}/${x.capacity} packets)`, sub: x.branch?.name })}
            />
          ) : null}
        </>
      ) : null}

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
            {r.photos.length ? (
              <>
                <Txt style={{ fontSize: 11.5, color: C.muted, marginBottom: 6 }}>{r.photos.length} saved photo{r.photos.length > 1 ? "s" : ""}</Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  {r.photos.map((p) => (
                    <UploadImage key={p} path={p} title={`${r.name || "Ornament"} photo`} style={{ width: 72, height: 72, borderRadius: 8 }} />
                  ))}
                </View>
              </>
            ) : null}
            {r.newPhotos.map((url, k) => (
              <UploadField key={`${i}-${k}-${url}`} label={`New photo ${k + 1}`} value={url} allowPdf={false}
                onChange={(u) => upd(i, { newPhotos: u ? r.newPhotos.map((x, xi) => (xi === k ? u : x)) : r.newPhotos.filter((_, xi) => xi !== k) })} />
            ))}
            {r.photos.length + r.newPhotos.length < 3 ? (
              <UploadField key={`${i}-add-${r.newPhotos.length}`} label="Add ornament photo" value="" allowPdf={false}
                onChange={(u) => u && upd(i, { newPhotos: [...r.newPhotos, u] })}
                maxFiles={3 - r.photos.length - r.newPhotos.length}
                onAddMany={(urls) => upd(i, { newPhotos: [...r.newPhotos, ...urls].slice(0, 3 - r.photos.length) })} />
            ) : null}
          </OrnamentCard>
        )
      )}
      <DashedButton label="Add Ornament" onPress={() => setRows((rs) => [...rs, { name: "", purity: "22K", gross: "", net: "", qty: "1", photos: [], newPhotos: [] }])} />
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 12 }}>Total net weight: {totalNet.toFixed(2)} g</Txt>

      <UploadField label="Overall photo" value={overallPhoto} onChange={setOverallPhoto} allowPdf={false} />
      <TextField label="Additional information" multiline maxLength={150} placeholder="Anything else worth recording on this loan…" value={additionalInfo} onChangeText={setAdditionalInfo} style={{ minHeight: 70 }} />

      {reviewing && (activeFollowing.length || activeDeps.length || interest.length) ? (
        <View style={{ marginBottom: 12 }}>
          <NoticeBanner>Review, then save again.</NoticeBanner>
          {activeFollowing.length ? (
            <>
              <SectionTitle flush>Later payments</SectionTitle>
              {activeFollowing.map((f) => (
                <View key={f.id} style={{ marginBottom: 8 }}>
                  <Txt style={{ fontSize: 12, color: C.muted }}>
                    {fmtDate(f.paidOn)} · {f.type ?? "Payment"}{f.reference ? ` · ${f.reference}` : ""} · now {inr(f.current)}
                    {f.needsChange ? ` — no longer fits, can be at most ${inr(f.suggested)} (0 removes it)` : ""}
                  </Txt>
                  <Field label="Amount after this edit">
                    <Input keyboardType="decimal-pad" value={follow[f.id] ?? String(f.current)} onChangeText={(v) => setFollow((m) => ({ ...m, [f.id]: v }))} />
                  </Field>
                </View>
              ))}
            </>
          ) : null}
          {activeDeps.length ? (
            <>
              <SectionTitle flush>This also affects the gold released for this loan</SectionTitle>
              {activeDeps.map((d) => (
                <View key={d.kind} style={{ marginBottom: 8 }}>
                  <Txt style={{ fontSize: 12, color: C.muted }}>{d.description}</Txt>
                  <Txt style={{ fontSize: 11.5, color: C.muted }}>{d.current} → {d.suggested}</Txt>
                  {d.warning && chosenDeps[d.kind] ? <Txt style={{ fontSize: 11.5, color: C.red }}>{d.warning}</Txt> : null}
                  <ChipToggle options={["Also update", "Leave as is"] as const} value={chosenDeps[d.kind] ? "Also update" : "Leave as is"} onChange={(v) => setChosenDeps((m) => ({ ...m, [d.kind]: v === "Also update" }))} />
                </View>
              ))}
            </>
          ) : null}
          {interest.length ? (
            <>
              <SectionTitle flush>Interest worked out again</SectionTitle>
              {interest.map((c) => (
                <Txt key={c.on} style={{ fontSize: 12, color: C.muted }}>
                  {fmtDate(c.on)}: interest {inr(c.interestBefore)} → {inr(c.interestAfter)}
                  {c.penalBefore || c.penalAfter ? `, penal ${inr(c.penalBefore)} → ${inr(c.penalAfter)}` : ""}
                </Txt>
              ))}
            </>
          ) : null}
        </View>
      ) : null}

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
