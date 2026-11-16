import React, { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AsyncSelect, C, ChipToggle, DashedButton, DateField, Field, Input, NoticeBanner, PrimaryButton, ResultBox, SectionTitle, Sheet, TextField, Txt, toast } from "@/common/components/ui";
import { useQuery } from "@tanstack/react-query";
import { latestGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { rateForPurityFull } from "@/common/utils/purity";
import { OrnamentFormCard, emptyOrnRow, netOf, ornFormFields, rowPurity, type OrnFormRow } from "@/common/components/OrnamentFormCard";
import { inr, fmtDate, todayISO } from "@/common/utils/format";
import { addOrnament, addOrnamentImage, deleteOrnament, previewLoanEdit, updateLoanWithFlags, updateOrnament, type LoanEditDependent, type LoanEditFollowing, type LoanEditInterestChange } from "@/modules/loans/services/loanService";
import { type OrnamentRequestInput, type Loan, type Ornament } from "@/modules/loans/types/loan-types";
import { listActiveSchemes } from "@/modules/schemes/services/schemeService";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import { apiErr, invalidateLoan } from "@/common/components/loanSheetKit";
import { FieldErr } from "@/common/components/ErrorText";
import { UploadField } from "@/common/components/UploadField";
import { useAuth } from "@/common/providers/AuthProvider";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listLockersPage } from "@/modules/lockers/services/lockerService";
import { listPackets } from "@/modules/packets/services/packetService";
import type { Locker } from "@/modules/lockers/types/locker-types";

// Same ornament fields as Create New Loan (shared OrnamentFormCard); `imgs` holds photos added in this edit,
// `photos` the ones already saved.
type OrnRow = OrnFormRow & { id?: number; removed?: boolean; edited?: boolean; photos: string[] };

const toRow = (o: Ornament): OrnRow => ({
  id: o.id,
  name: o.name,
  ...ornFormFields(o),
  photos: (o.images ?? []).map((i) => i.imageUrl),
  imgs: [],
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
  const [tried, setTried] = useState(false);
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
    setTried(false);
    setReviewedFor(null);
    setOverallPhoto(l.overallPhotoUrl ?? "");
    setAdditionalInfo(l.additionalInfo ?? "");
    setBranch(null);
    setLocker(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const active = rows.filter((r) => !r.removed);
  const upd = (i: number, patch: Partial<OrnRow>) => setRows((rs) => rs.map((r, x) => (x === i ? { ...r, ...patch, edited: true } : r)));

  // Live estimate of what the loan can carry, from the same rates the backend uses (22K / 18K at their own
  // published rates). Net weight × rate per ornament — quantity is not multiplied in (the backend values
  // GoldValue = NetWeight × rate), so this matches what Save will accept.
  const goldRate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible });
  const rates = { k24: goldRate.data?.k24 ?? 0, k22: goldRate.data?.k22 ?? 0, k18: goldRate.data?.k18 ?? 0 };
  const totalGoldValue = active.reduce((s, r) => {
    const p = rowPurity(r);
    return s + netOf(r) * (p ? rateForPurityFull(rates, p) ?? 0 : 0);
  }, 0);
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
  const branchChanged = !!branch && branch.id !== l.branchId;
  const lockerChanged = !!locker && locker.id !== packetLockerId;
  const ornamentsEdited = rows.some((r) => r.removed || !r.id || r.edited);
  const errs: Record<string, string> = {};
  if (!(amountNum > 0)) errs.amount = "Enter valid amount.";
  else if (hasCharge && payout <= 0) errs.amount = "Charge exceeds amount.";
  else if ((principalTotal !== l.principalAmount || schemeId !== l.schemeId || ornamentsEdited) && goldRate.data && eligible > 0 && amountNum > Math.floor(eligible)) errs.amount = "Exceeds eligible amount.";
  if (!active.length) errs.ornaments = "Add an ornament.";
  else if (active.some((r) => !r.name.trim() || !rowPurity(r) || !(Number(r.grossWeight) > 0) || !(netOf(r) > 0))) errs.ornaments = "Complete ornament details.";
  else if (active.some((r) => Number(r.lessWeight) > Number(r.grossWeight))) errs.ornaments = "Less exceeds gross weight.";
  if (additionalInfo.trim().length > 150) errs.info = "Info max 150 characters.";
  if (canMove && branchChanged && hasPacket && packetLockerId && !locker) errs.locker = "Choose new locker.";
  const fe = (k: string) => (tried ? errs[k] : undefined);
  const save = useMutation({
    mutationFn: async () => {
      // Checked against today's live rate only when the amount, scheme or ornaments are being changed — an untouched
      // loan (say, just a new note) must stay saveable even if the gold rate has fallen since it was opened.
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
          purity: rowPurity(r)!,
          grossWeight: Number(r.grossWeight),
          deductionWeight: Math.round((Number(r.lessWeight) || 0) * 1000) / 1000,
          quantity: Number(r.quantity) || 1,
        };
        if (r.removed) {
          if (r.id) await deleteOrnament(r.id);
        } else if (r.id) {
          await updateOrnament(r.id, input);
          for (const url of r.imgs) await addOrnamentImage(r.id, url);
        } else await addOrnament(l.id, { ...input, images: r.imgs });
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
      toast.error(apiErr(e, "Save failed."));
      // Part of the edit may have landed — refresh so the sheet reopens on the truth.
      invalidateLoan(qc, l.id);
    },
  });

  const totalNet = active.reduce((s, r) => s + netOf(r), 0);

  return (
    <Sheet visible={visible} onClose={onClose} title="Edit Loan Details" maxHeightPct={90}>
      {triggersReapproval ? (
        l.disbursementDate ? (
          <NoticeBanner>
            Applies immediately; interest recalculated.
          </NoticeBanner>
        ) : (
          <NoticeBanner>
            Needs re-approval after saving.
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
      <FieldErr m={fe("amount")} />
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
          <FieldErr m={fe("locker")} />
        </>
      ) : null}

      <SectionTitle flush style={{ marginTop: 14 }}>
        Ornaments
      </SectionTitle>
      {rows.map((r, i) =>
        r.removed ? null : (
          <OrnamentFormCard key={r.id ?? `new-${i}`} title={r.name.trim() || `Ornament ${i + 1}`} row={r} savedPhotos={r.photos} onChange={(patch) => upd(i, patch)} onRemove={() => upd(i, { removed: true })} />
        )
      )}
      <FieldErr m={fe("ornaments")} />
      <DashedButton label="Add Ornament" onPress={() => setRows((rs) => [...rs, { ...emptyOrnRow, photos: [] }])} />
      <Txt style={{ fontSize: 11.5, color: C.muted, fontWeight: "600", marginBottom: 12 }}>Total net weight: {totalNet.toFixed(2)} g</Txt>

      <UploadField label="Overall photo" value={overallPhoto} onChange={setOverallPhoto} allowPdf={false} />
      <TextField label="Additional information" multiline maxLength={150} placeholder="Anything else worth recording on this loan…" value={additionalInfo} onChangeText={setAdditionalInfo} style={{ minHeight: 70 }} />
      <FieldErr m={fe("info")} />

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

      <PrimaryButton
        label="Save Changes"
        onPress={() => {
          if (Object.keys(errs).length) return setTried(true);
          save.mutate();
        }}
        loading={save.isPending}
      />
    </Sheet>
  );
}
