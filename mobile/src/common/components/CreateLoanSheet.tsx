import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AsyncSelect,
  BtnRow2,
  C,
  Card,
  ChipToggle,
  ComboInput,
  DashedButton,
  DateField,
  Field,
  FieldGrid,
  FieldRow,
  Input,
  MenuItem,
  NoticeBanner,
  OrnamentCard,
  PrimaryButton,
  SectionTitle,
  Sheet,
  Txt,
  WarningBanner,
  openPage,
  toast,
} from "@/common/components/ui";
import { UploadField } from "./UploadField";
import { ErrorText } from "./ErrorText";
import { useAuth } from "@/common/providers/AuthProvider";
import { listCustomersPage } from "@/modules/customers/services/customerService";
import { listBranchesPage } from "@/modules/branches/services/branchService";
import { listLockersPage } from "@/modules/lockers/services/lockerService";
import { listActiveSchemes } from "@/modules/schemes/services/schemeService";
import { createLoan, addOrnamentImage, saveDraft, updateDraft } from "@/modules/loans/services/loanService";
import { getLocker } from "@/modules/lockers/services/lockerService";
import { type CreateOrnamentInput, type LoanDraft, type SaveDraftInput } from "@/modules/loans/types/loan-types";
import { latestGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { formatPurity, isFinenessInRange, isKaratInRange, parsePurity, rateForPurityFull, type PurityUnit } from "@/common/utils/purity";
import { inr, todayISO } from "@/common/utils/format";
import { ApiError } from "@/common/services/httpClient";
import { printPolicy } from "@/common/config/brand";
import type { Customer } from "@/modules/customers/types/customer-types";
import type { Scheme } from "@/modules/schemes/types/scheme-types";
import type { Locker } from "@/modules/lockers/types/locker-types";
import { OrnamentTypeField } from "./OrnamentTypeField";

// Create New Loan (prototype #loan-modal) — rise-up sheet opened from the
// Loans page "+" and the dashboard's Create Loan quick action. Same business
// rules as the web NewLoan form: blocked until today's gold rate is
// published, ornament value = net wt × rate for its purity (quantity is not multiplied in), principal
// capped at the scheme's LTV-eligible amount.
type OrnRow = { name: string; purityUnit: PurityUnit; purityValue: string; grossWeight: string; lessWeight: string; quantity: string; imgs: string[]; netText?: string };
const MAX_ORNAMENT_PHOTOS = 3;
const emptyRow: OrnRow = { name: "", purityUnit: "karat", purityValue: "22", grossWeight: "", lessWeight: "", quantity: "1", imgs: [] };
const KARATS = ["24", "23", "22", "21", "20", "18", "16", "14", "12", "10"];
const FINENESS = ["99.9", "99.5", "91.6", "87.5", "83.3", "75", "58.5", "41.7"];

type PurityInputProps = { unit: PurityUnit; value: string; onChange: (v: string) => void };

/** Karat / fineness entry: type any value, or pick a standard one. */
function PurityInput({ unit, value, onChange }: PurityInputProps) {
  const opts = unit === "karat" ? KARATS : FINENESS;
  return (
    <ComboInput
      value={value}
      onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ""))}
      keyboardType="decimal-pad"
      placeholder={unit === "karat" ? "22" : "91.6"}
      menu={(close) => (
        <>
          {opts.map((o) => (
            <MenuItem
              key={o}
              title={unit === "karat" ? `${o}K` : `${o}%`}
              selected={o === value}
              onPress={() => {
                onChange(o);
                close();
              }}
            />
          ))}
        </>
      )}
    />
  );
}

/** Estimated interest over the scheme's full period, using the scheme's interest method (the backend does the
 * exact accrual; this is the up-front preview, like web's "Monthly premium"). */
function periodInterest(sc: Scheme, principal: number): number {
  const months = sc.durationMonths || 0;
  const m = (sc.interestMethod ?? "").toLowerCase();
  if (m.includes("compound")) return principal * (Math.pow(1 + sc.interestRate / 1200, months) - 1);
  if (m.includes("multiple") && sc.rateTiers?.length) {
    const totalDays = months * 30;
    let from = 0;
    let sum = 0;
    for (const t of sc.rateTiers) {
      const to = t.days > 0 ? Math.min(t.days, totalDays) : totalDays;
      if (to > from) sum += (principal * t.rate) / 1200 * ((to - from) / 30);
      from = Math.max(from, to);
    }
    return sum;
  }
  return (principal * sc.interestRate) / 1200 * months;
}

const netOf = (r: OrnRow) => Math.max(0, (Number(r.grossWeight) || 0) - (Number(r.lessWeight) || 0));
const trim3 = (n: number) => String(+n.toFixed(3));

function rowPurity(r: OrnRow): string | null {
  const n = Number(r.purityValue);
  if (!r.purityValue.trim() || !(n > 0)) return null;
  if (r.purityUnit === "karat" && !isKaratInRange(n)) return null;
  if (r.purityUnit === "fineness" && !isFinenessInRange(n)) return null;
  return formatPurity(r.purityUnit, n);
}

type CreateLoanSheetProps = { visible: boolean; onClose: () => void; /** Start with this customer already picked (opened from the customer page). */ initialCustomer?: Customer | null; /** A saved draft picked from the Loans screen's Draft loans list — loaded into the form when the sheet opens. */ initialDraft?: LoanDraft | null };

export function CreateLoanSheet({ visible, onClose, initialCustomer, initialDraft }: CreateLoanSheetProps) {
  const qc = useQueryClient();
  const { employee, can } = useAuth();
  const canCreate = can("Loan_Management", "can_create_loan");
  // Only a cross-branch user picks another branch — everyone else books into
  // their own (the backend enforces this too, overriding branchId).
  const canPickBranch = can("Branch_Management", "can_view_all_branches");
  const ownBranch = employee ? { id: employee.branchId, name: employee.branch?.name ?? "Your branch" } : null;

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [scheme, setScheme] = useState<Scheme | null>(null);
  const [branch, setBranch] = useState<{ id: number; name: string } | null>(ownBranch);
  const [locker, setLocker] = useState<Locker | null>(null);
  const [rows, setRows] = useState<OrnRow[]>([{ ...emptyRow }]);
  // The "what's missing" message only appears once Create Loan has been pressed.
  const [tried, setTried] = useState(false);
  // A manually typed principal, and the eligible amount it was typed against (`at`; null = restored from a
  // draft). It is dropped whenever the eligible amount changes (ornaments, scheme or rate edited), so the
  // field never keeps an amount computed against different gold — it falls back to the eligible amount.
  const [pEdit, setPEdit] = useState<{ v: string; at: number | null } | null>(null);
  const [exceeds, setExceeds] = useState(false);
  // How the scheme's service charge is applied — Deduct from loan / Add to loan (web's Charge method).
  const [chargeMode, setChargeMode] = useState<"WithheldFromPayout" | "AddedToPrincipal">("WithheldFromPayout");
  // The saved draft being edited, if any — saving again updates it, creating the loan discards it.
  const [draftId, setDraftId] = useState<number | null>(null);
  const [info, setInfo] = useState("");
  // One photo of the whole pledge — optional, but TML businesses must attach it
  // (it prints on their pledge book).
  const [overallPhoto, setOverallPhoto] = useState("");
  const overallPhotoRequired = printPolicy() === "tml";
  // Loan (opened) date — same rule as the web NewLoan form: defaults to
  // today, may be backdated but never set in the future (the DateField's max
  // blocks it; the backend re-checks). Interest accrues from this date and
  // the due date is derived from it.
  const [openedDate, setOpenedDate] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);

  const goldRate = useQuery({ queryKey: ["gold-rates", "latest"], queryFn: latestGoldRate, enabled: visible, refetchOnMount: "always" });

  useEffect(() => {
    if (!visible) return;
    setError(null);
    if (initialCustomer) setCustomer(initialCustomer);
  }, [visible, initialCustomer]);

  const today = todayISO();
  const isTodaySet = !!goldRate.data?.date && goldRate.data.date.slice(0, 10) === today;
  // Rates for the valuation: 22K / 18K ornaments use their own published rates (the backend values them
  // that way and refuses a principal above ITS eligible amount); everything else derives off K24.
  const rates = { k24: goldRate.data?.k24 ?? 0, k22: goldRate.data?.k22 ?? 0, k18: goldRate.data?.k18 ?? 0 };

  const update = (i: number, patch: Partial<OrnRow>) => setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  // Ornament value = net weight × the purity's rate. Quantity is a record-only field — it does NOT
  // multiply into weight or value (the backend prices GoldValue = NetWeight × rate; same as web).
  const valueOf = (r: OrnRow) => {
    const p = rowPurity(r);
    const rate = p ? rateForPurityFull(rates, p) : null;
    return rate == null ? 0 : netOf(r) * rate;
  };
  const valid = rows.filter((r) => r.name.trim() && rowPurity(r) && Number(r.grossWeight) > 0 && netOf(r) > 0);
  const lessExceeds = rows.some((r) => Number(r.lessWeight) > Number(r.grossWeight));
  const totalNet = valid.reduce((sum, r) => sum + netOf(r), 0);
  const goldValue = valid.reduce((sum, r) => sum + valueOf(r), 0);
  // Floored, like web, so the figure shown is never above what the server accepts.
  const eligible = scheme ? Math.floor((goldValue * scheme.ltvPercent) / 100) : 0;
  // The principal field is prefilled with the eligible amount; typing is clamped to it.
  const pActive = pEdit && (pEdit.at === eligible || pEdit.at === null) ? pEdit : null;
  const principal = pActive ? (pActive.v === "" ? "" : String(Math.min(+pActive.v || 0, eligible))) : eligible > 0 ? String(eligible) : "";
  const showExceeds = exceeds && pActive?.at === eligible;
  const hasCharge = !!scheme && !!scheme.serviceChargeType && scheme.serviceChargeType !== "None";
  // The first mandatory thing still missing, in form order. Create Loan stays disabled until there is none
  // (permission is explained by its own banner).
  const missingReason: string | null = !openedDate
    ? "Choose the opening date."
    : openedDate > today
      ? "The opening date can't be after today."
      : !branch
        ? "Select a branch."
        : !customer
          ? "Select a customer."
          : !scheme
            ? "Select a scheme."
            : valid.length === 0
              ? "Add at least one ornament with its name, purity, gross weight and net weight."
              : lessExceeds
                ? "An ornament's less weight can't be more than its gross weight."
                : !(Number(principal) > 0)
                  ? "Enter the loan amount."
                  : !isTodaySet
                    ? "Today's gold rate hasn't been published yet."
                    : overallPhotoRequired && !overallPhoto
                      ? "Add the overall photo of the pledged gold."
                      : null;

  const reset = () => {
    setTried(false);
    setCustomer(null);
    setScheme(null);
    setBranch(ownBranch);
    setLocker(null);
    setRows([{ ...emptyRow }]);
    setPEdit(null);
    setExceeds(false);
    setChargeMode("WithheldFromPayout");
    setDraftId(null);
    setInfo("");
    setOverallPhoto("");
    setOpenedDate(todayISO());
    setError(null);
  };

  const submit = useMutation({
    mutationFn: () => {
      const [oy, om, od] = openedDate.split("-").map(Number);
      const due = new Date(oy, om - 1, od);
      // Clamp to the last day of the target month (31 Jan + 1 month = 28/29 Feb, not 3 Mar), like the backend's addMonths.
      const target = new Date(oy, om - 1 + (scheme?.durationMonths ?? 0), 1);
      due.setFullYear(target.getFullYear(), target.getMonth(), Math.min(od, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
      const ornaments: CreateOrnamentInput[] = valid.map((r) => ({
        name: r.name.trim(),
        purity: rowPurity(r)!,
        grossWeight: Number(r.grossWeight),
        deductionWeight: Number(r.lessWeight) || 0,
        quantity: r.quantity ? Number(r.quantity) : undefined,
      }));
      return createLoan({
        branchId: branch!.id,
        ...(locker ? { lockerId: locker.id } : {}),
        customerId: customer!.id,
        schemeId: scheme!.id,
        openedDate,
        dueDate: `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`,
        principalAmount: Number(principal),
        ornaments,
        ...(overallPhoto ? { overallPhotoUrl: overallPhoto } : {}),
        ...(info.trim() ? { additionalInfo: info.trim() } : {}),
        ...(hasCharge ? { serviceChargeMode: chargeMode } : {}),
        // Hands the server the draft this loan came from, so it is discarded now that a real loan exists.
        ...(draftId ? { draftId } : {}),
      });
    },
    onSuccess: async (loan) => {
      // Link each photographed row to the ornament created for it (returned
      // in submission order). The loan already exists, so a failed photo is
      // reported rather than blocking — it can be re-added from Edit Loan.
      const created = loan.ornaments ?? [];
      const photoResults = await Promise.all(
        valid.flatMap((r, i) => (created[i] ? r.imgs.map((img) => addOrnamentImage(created[i].id, img).then(() => true, () => false)) : []))
      );
      if (photoResults.some((ok) => !ok)) toast.error("Some ornament photos weren't saved", "The loan was created — add the photos again from Edit Loan.");
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["loan-drafts"] });
      reset();
      onClose();
      openPage(`/loans/${loan.id}`);
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not create loan."),
  });

  const schemeLabel = (sc: Scheme) => `${sc.name} — ${sc.interestRate}% · ${sc.durationMonths}mo · LTV ${sc.ltvPercent}%${sc.interestMethod ? ` · ${sc.interestMethod}` : ""}`;

  // ---- Saved drafts — a half-entered loan kept per employee. They are listed from the Loans screen's
  // "Draft loans" button, which hands one back through `initialDraft`. ----

  // Saves whatever is on screen with no validation beyond a branch: the point is to keep an incomplete form.
  // The real rules still apply when the loan is created.
  function buildDraftInput(): SaveDraftInput {
    return {
      branchId: branch!.id,
      ...(customer ? { customerId: customer.id } : {}),
      ...(scheme ? { schemeId: scheme.id } : {}),
      ...(locker ? { lockerId: locker.id } : {}),
      // Only a genuine manual override is stored — an empty field means "use the eligible amount", which must
      // stay computed (a draft reopened next week has to use next week's gold rate).
      ...(pActive && pActive.v !== "" ? { principalOverride: +principal } : {}),
      ...(overallPhoto ? { overallPhotoUrl: overallPhoto } : {}),
      ornaments: rows.map((r) => ({
        name: r.name,
        purity: rowPurity(r) ?? "22K",
        grossWeight: Number(r.grossWeight) || 0,
        quantity: Number(r.quantity) || 1,
        ...(r.imgs.length ? { imageUrl: r.imgs[0], imageUrls: r.imgs } : {}),
      })),
    };
  }

  const hasDraftContent = !!customer || !!scheme || !!locker || !!overallPhoto || rows.some((r) => r.name.trim() || Number(r.grossWeight) > 0 || r.imgs.length > 0);
  const saveDraftMut = useMutation({
    mutationFn: () => (draftId ? updateDraft(draftId, buildDraftInput()) : saveDraft(buildDraftInput())),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["loan-drafts"] });
      toast.success(draftId ? "Draft updated" : "Draft saved", "Reopen it from Draft loans.");
      // The draft is safely stored — hand back a blank form so the next Save Draft starts another one.
      reset();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : "Could not save the draft — try again."),
  });

  // Reopens a saved draft into the form. The customer / scheme / branch labels come from the draft's preloaded
  // objects; the scheme (needed for the LTV) is looked up in the active schemes, the locker by id.
  async function applyDraft(d: LoanDraft) {
    setError(null);
    setDraftId(d.id);
    setCustomer(d.customer ? ({ id: d.customer.id, name: d.customer.name, code: d.customer.code } as Customer) : null);
    setBranch({ id: d.branchId, name: d.branch?.name ?? branch?.name ?? "" });
    setLocker(null);
    if (d.lockerId) getLocker(d.lockerId).then((k) => setLocker(k)).catch(() => undefined);
    setScheme(null);
    if (d.schemeId) {
      listActiveSchemes()
        .then((all) => setScheme(all.find((sc) => sc.id === d.schemeId) ?? null))
        .catch(() => undefined);
    }
    setRows(
      d.ornaments.length
        ? d.ornaments.map((o) => {
            const p = parsePurity(o.purity || "22K");
            return {
              name: o.name,
              purityUnit: p?.unit ?? "karat",
              purityValue: String(p?.value ?? 22),
              grossWeight: o.grossWeight ? String(o.grossWeight) : "",
              // Drafts don't keep the Gross / Less split — reopening assumes no deduction yet.
              lessWeight: "",
              quantity: String(o.quantity || 1),
              imgs: o.imageUrls?.length ? o.imageUrls : o.imageUrl ? [o.imageUrl] : [],
            };
          })
        : [{ ...emptyRow }]
    );
    setOverallPhoto(d.overallPhotoUrl ?? "");
    // The saved manual amount arrived together with these ornaments, so it is not stale.
    setPEdit(d.principalOverride ? { v: String(d.principalOverride), at: null } : null);
    setExceeds(false);
  }

  useEffect(() => {
    if (visible && initialDraft) void applyDraft(initialDraft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialDraft]);

  return (
    <Sheet visible={visible} onClose={onClose} title="Create New Loan" maxHeightPct={80}>
      {!canCreate ? (
        <NoticeBanner>No permission to create.</NoticeBanner>
      ) : null}
      {canCreate && goldRate.data !== undefined && !isTodaySet ? (
        <WarningBanner>Today&apos;s gold rate missing.</WarningBanner>
      ) : null}

      <AsyncSelect<Customer>
        label="Customer"
        placeholder="Search existing customer by name, ID or phone"
        queryKey={["customers", "picker"]}
        pagedFetcher={(q, page) => listCustomersPage({ q: q || undefined, ...page })}
        selectedLabel={customer ? `${customer.name} · ${customer.code ?? ""}` : undefined}
        onClear={() => setCustomer(null)}
        onSelect={(c) => {
          setCustomer(c);
          // A customer borrows from their own branch, so the loan takes it (the backend enforces this too).
          if (c.branchId) {
            setBranch({ id: c.branchId, name: c.branch?.name ?? branch?.name ?? "" });
            if (locker && locker.branchId !== c.branchId) setLocker(null);
          }
        }}
        keyOf={(c) => c.id}
        renderItem={(c) => ({ title: c.name, sub: [c.code, c.phone].filter(Boolean).join(" · ") })}
      />
      <AsyncSelect<Scheme>
        label="Scheme"
        placeholder="Search active schemes"
        queryKey={["schemes", "active"]}
        fetcher={(q) => listActiveSchemes(q || undefined)}
        selectedLabel={scheme ? schemeLabel(scheme) : undefined}
        onClear={() => setScheme(null)}
        onSelect={setScheme}
        keyOf={(sc) => sc.id}
        renderItem={(sc) => ({ title: sc.name, sub: `${sc.interestRate}% · ${sc.durationMonths}mo · LTV ${sc.ltvPercent}%${sc.interestMethod ? ` · ${sc.interestMethod}` : ""}` })}
      />

      {canPickBranch && !customer ? (
        <AsyncSelect<{ id: number; name: string; code?: string }>
          label="Branch"
          placeholder="Search branch"
          queryKey={["branches", "loan-picker"]}
          fetcher={async (q) => (await listBranchesPage({ q: q || undefined, active: true, limit: 20, offset: 0 })).items ?? []}
          selectedLabel={branch?.name}
          onSelect={(b) => {
            setBranch({ id: b.id, name: b.name });
            if (locker && locker.branchId !== b.id) setLocker(null);
          }}
          keyOf={(b) => b.id}
          renderItem={(b) => ({ title: b.name, sub: b.code })}
        />
      ) : (
        <Field label={canPickBranch ? "Branch (customer's branch)" : "Branch"}>
          <Input value={branch?.name ?? ""} editable={false} />
        </Field>
      )}
      <DateField label="Loan date" value={openedDate} onChange={setOpenedDate} max={today} />
      <AsyncSelect<Locker>
        label="Locker (optional)"
        placeholder="Assign later, or search locker code"
        queryKey={["lockers", "loan-picker", branch?.id]}
        fetcher={async (q) => (await listLockersPage({ branchId: branch?.id, status: "active", q: q || undefined, limit: 20, offset: 0 })).items ?? []}
        selectedLabel={locker ? `${locker.code} (${locker.occupied}/${locker.capacity} packets)` : undefined}
        onClear={() => setLocker(null)}
        onSelect={setLocker}
        keyOf={(l) => l.id}
        renderItem={(l) => ({ title: `${l.code} (${l.occupied}/${l.capacity} packets)`, sub: l.branch?.name })}
      />

      <SectionTitle flush style={{ marginTop: 16 }}>
        Ornaments
      </SectionTitle>

      {rows.map((r, i) => {
        const bad = Number(r.lessWeight) > Number(r.grossWeight);
        return (
          <OrnamentCard key={i} title={`Ornament ${i + 1}`} onRemove={rows.length > 1 ? () => setRows((p) => p.filter((_, x) => x !== i)) : undefined}>
            <OrnamentTypeField value={r.name} onChange={(v) => update(i, { name: v })} />
            <Field label="Purity unit">
              <ChipToggle
                options={["karat", "fineness"] as const}
                labels={{ karat: "Karat", fineness: "Fineness" }}
                value={r.purityUnit}
                onChange={(u) => update(i, { purityUnit: u, purityValue: u === "karat" ? "22" : "91.6" })}
              />
            </Field>
            <FieldRow>
              <Field label={r.purityUnit === "karat" ? "Karat" : "Fineness %"}>
                <PurityInput key={r.purityUnit} unit={r.purityUnit} value={r.purityValue} onChange={(v) => update(i, { purityValue: v })} />
              </Field>
              <Field label="Quantity">
                <Input keyboardType="number-pad" value={r.quantity} onChangeText={(v) => update(i, { quantity: v })} />
              </Field>
            </FieldRow>
            <FieldRow>
              <Field label="Gross Wt (g)">
                <Input keyboardType="decimal-pad" placeholder="0.0" value={r.grossWeight} onChangeText={(v) => update(i, { grossWeight: v, netText: undefined })} />
              </Field>
              <Field label="Less Wt (g)">
                <Input keyboardType="decimal-pad" placeholder="0.0" value={r.lessWeight} onChangeText={(v) => update(i, { lessWeight: v, netText: undefined })} style={bad ? { borderColor: C.red } : undefined} />
              </Field>
            </FieldRow>
            {bad ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 8 }}>Less Wt cannot be greater than Gross Wt</Txt> : null}
            <Field label="Net Wt (g)">
              <Input
                keyboardType="decimal-pad"
                placeholder="Auto"
                value={r.netText ?? (r.grossWeight ? trim3(netOf(r)) : "")}
                onChangeText={(v) => {
                  // Net is gross − less, so editing it sets the less weight.
                  const g = Number(r.grossWeight) || 0;
                  const net = Math.min(Number(v) || 0, g);
                  update(i, { netText: v, lessWeight: v === "" || !g ? r.lessWeight : trim3(Math.max(0, g - net)) });
                }}
              />
            </Field>
            {r.imgs.map((url, k) => (
              <UploadField
                key={`${i}-${k}-${url}`}
                label={r.imgs.length > 1 ? `Ornament photo ${k + 1}` : "Ornament photo"}
                value={url}
                onChange={(u) => update(i, { imgs: u ? r.imgs.map((x, xi) => (xi === k ? u : x)) : r.imgs.filter((_, xi) => xi !== k) })}
                allowPdf={false}
              />
            ))}
            {r.imgs.length < MAX_ORNAMENT_PHOTOS ? (
              <UploadField
                key={`${i}-add-${r.imgs.length}`}
                label={r.imgs.length ? "Add another photo" : "Ornament photo"}
                value=""
                onChange={(u) => u && update(i, { imgs: [...r.imgs, u].slice(0, MAX_ORNAMENT_PHOTOS) })}
                maxFiles={MAX_ORNAMENT_PHOTOS - r.imgs.length}
                onAddMany={(urls) => update(i, { imgs: [...r.imgs, ...urls].slice(0, MAX_ORNAMENT_PHOTOS) })}
                allowPdf={false}
              />
            ) : null}
          </OrnamentCard>
        );
      })}

      <DashedButton label="Add Ornament" onPress={() => setRows((p) => [...p, { ...emptyRow }])} />

      <UploadField label={overallPhotoRequired ? "Overall photo *" : "Overall photo (optional)"} value={overallPhoto} onChange={setOverallPhoto} allowPdf={false} />

      <Card style={{ marginHorizontal: 0, marginBottom: 14, padding: 14 }}>
        <FieldGrid
          items={[
            { k: "Total Net Wt", v: `${+totalNet.toFixed(2)} g` },
            { k: "Gold Value", v: inr(Math.round(goldValue)) },
            { k: "LTV", v: scheme ? `${scheme.ltvPercent}%` : "—" },
            { k: "Interest method", v: scheme?.interestMethod || "—" },
            { k: "Eligible Amount", v: inr(eligible), color: C.brandDeep },
          ]}
        />
      </Card>

      {hasCharge && scheme ? (
        <Field label="Charge method">
          <ChipToggle
            options={["WithheldFromPayout", "AddedToPrincipal"] as const}
            labels={{ WithheldFromPayout: "Deduct from loan", AddedToPrincipal: "Add to loan" }}
            value={chargeMode}
            onChange={setChargeMode}
          />
        </Field>
      ) : null}
      <Field label="Amount (₹)">
        <Input
          keyboardType="number-pad"
          placeholder={eligible ? inr(eligible) : "₹"}
          value={principal}
          onChangeText={(v) => {
            // Digits only; the field is clamped to the eligible amount (a figure the server would refuse is never kept).
            const clean = v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
            const num = clean === "" ? 0 : +clean;
            if (num > eligible) {
              setPEdit({ v: String(eligible), at: eligible });
              setExceeds(true);
            } else {
              setPEdit({ v: clean, at: eligible });
              setExceeds(false);
            }
          }}
        />
      </Field>
      {showExceeds ? <Txt style={{ fontSize: 11, color: C.red, marginTop: -6, marginBottom: 10 }}>Amount can&apos;t exceed {inr(eligible)}.</Txt> : null}
      {(() => {
        // Same summary as web: the charge, then Principal and the amount actually paid out. A withheld charge
        // comes off the amount; an added charge rides on top of it (the entered amount is the cap, not the total).
        const amount = +principal || 0;
        const charge = !hasCharge || !scheme ? 0 : scheme.serviceChargeType === "Flat" ? scheme.serviceChargeValue ?? 0 : (amount * (scheme.serviceChargeValue ?? 0)) / 100;
        const withheld = chargeMode === "WithheldFromPayout";
        const loanPrincipal = hasCharge && !withheld ? amount + charge : amount;
        const disbursed = hasCharge && withheld ? Math.max(0, amount - charge) : amount;
        const monthly = scheme ? (loanPrincipal * scheme.interestRate) / 1200 : 0;
        const forPeriod = scheme ? periodInterest(scheme, loanPrincipal) : 0;
        return (
          <Card style={{ marginHorizontal: 0, marginBottom: 14, padding: 14 }}>
            <FieldGrid
              items={[
                ...(scheme
                  ? [
                      { k: `Monthly interest (${scheme.interestRate}% p.a.${scheme.rateTiers?.length ? ", first tier" : ""})`, v: inr(Math.round(monthly)) },
                      { k: `Interest for ${scheme.durationMonths} month${scheme.durationMonths === 1 ? "" : "s"} (est.)`, v: inr(Math.round(forPeriod)), color: C.brandDeep },
                      { k: "Total payable at maturity (est.)", v: inr(Math.round(loanPrincipal + forPeriod)) },
                    ]
                  : []),
                ...(hasCharge ? [{ k: "Service charge", v: `${withheld ? "−" : "+"}${inr(charge)}`, color: withheld ? C.red : C.green }] : []),
                { k: "Principal", v: inr(loanPrincipal), color: C.brandDeep },
                { k: "Loan amount to disburse", v: inr(disbursed), color: C.green },
              ]}
            />
          </Card>
        );
      })()}
      <Field label="Additional information">
        <Input placeholder="Optional notes" value={info} onChangeText={setInfo} multiline />
      </Field>
      {error ? <Txt style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>{error}</Txt> : null}
      {canCreate && !error && tried && missingReason ? <ErrorText>{missingReason}</ErrorText> : null}
      <BtnRow2>
        {canCreate ? (
          <PrimaryButton
            label={draftId ? "Update Draft" : "Save Draft"}
            variant="outline"
            onPress={() => saveDraftMut.mutate()}
            loading={saveDraftMut.isPending}
            disabled={!branch || !hasDraftContent}
          />
        ) : null}
        <PrimaryButton label="Create Loan" onPress={() => (missingReason ? setTried(true) : submit.mutate())} loading={submit.isPending} disabled={!canCreate} />
      </BtnRow2>
    </Sheet>
  );
}
