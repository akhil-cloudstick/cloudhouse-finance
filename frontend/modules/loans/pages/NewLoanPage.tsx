"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useData } from "@/common/providers/DataProvider";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useSchemes } from "@/modules/schemes/store/SchemesProvider";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/ModalProvider";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { useToast } from "@/common/components/ToastProvider";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { stageByPending } from "@/common/services/approvalWorkflowService";
import { Icon } from "@/common/components/Icon";
import { fmt, custOf, schemeOf, fmtDateTime } from "@/common/utils/format";
import { uploadFile, searchCustomersPage, getCustomer } from "@/modules/customers/services/customerService";
import { type CustomerView } from "@/modules/customers/types/customer-types";
import { VerifiedBadge } from "@/modules/customers/components/VerifiedBadge";
import { searchActiveSchemesPage } from "@/modules/schemes/services/schemeService";
import { type SchemeView } from "@/modules/schemes/types/scheme-types";
import { searchOrnamentTypesPage, createOrnamentType } from "@/modules/ornament-types/services/ornamentTypeService";
import { type BackendOrnamentType } from "@/modules/ornament-types/types/ornament-type-types";
import { createLoan, saveDraft, updateDraft, listDrafts, deleteDraft, getNextLoanNumber } from "@/modules/loans/services/loanService";
import { type BackendLoanDraft, type SaveDraftInput } from "@/modules/loans/types/loan-types";
import { publishGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { listActiveBranches } from "@/modules/branches/services/branchService";
import { type BranchView } from "@/modules/branches/types/branch-types";
import { getLocker, searchLockersPage } from "@/modules/lockers/services/lockerService";
import { type LockerView } from "@/modules/lockers/types/locker-types";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { Select } from "@/common/components/ui/Select";
import { DatePicker } from "@/common/components/ui/DatePicker";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { PurityPicker } from "@/common/components/PurityPicker";
import { PhotoSourceMenu } from "@/common/components/ui/PhotoSourceMenu";
import { OrnamentPhotoSlider } from "@/modules/loans/components/OrnamentPhotoSlider";
import { rateForPurityFull } from "@/common/utils/purity";
import { makeEnterToSubmitHandler } from "@/common/utils/enterToSubmit";
import { ApiError } from "@/common/services/httpClient";
import { openPrintWindow, brandHeader } from "@/common/utils/print";
import { printColors, tenantLenderProfile } from "@/common/config/brand";
import { bondLangOptionsFor, type BondLang } from "@/modules/loans/utils/indemnityBond";
import { useBranding } from "@/common/providers/BrandingProvider";
import { useShowBranch } from "@/common/hooks/use-branch-switch";
import type { Ornament } from "@/common/utils/data";
import { navigate } from "@/common/services/appRoutes";


// `netW` is derived (`w − lessWt`, floored at 0) purely for display; valuation uses net weight alone, qty is record-only.
type OrnRow = { n: string; p: string; w: number; lessWt: number; netW: number; q: number; imgs?: string[] };

// A focused <input type="number"> steps its value on mouse-wheel scroll, so drop focus to let the page scroll instead.
function blurOnWheel(e: React.WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur();
}

// Rounding after every arithmetic step keeps float noise out of Net Wt.
const round3 = (n: number) => Math.round(n * 1000) / 1000;

// Backed by a text draft so partial entries like ".", ".5" or "0." survive typing (a number input reports "" for them).
function WeightInput({ value, onChange, ...rest }: {
  value: number;
  onChange: (v: number) => void;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  const parsed = text === "" || text === "." ? 0 : parseFloat(text);
  if (parsed !== value) {
    setText(value === 0 ? "" : String(value));
  }
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const t = e.target.value;
        if (!/^\d*\.?\d{0,3}$/.test(t)) return;
        setText(t);
        onChange(t === "" || t === "." ? 0 : parseFloat(t));
      }}
    />
  );
}

// toISOString() would give the UTC date, which is still yesterday before 05:30 IST.
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NewLoanPageProps = { customerId?: string };

export function NewLoanPage({ customerId }: NewLoanPageProps = {}) {
  const { isCrossBranch, can, selectedBranchId } = useAuth();
  const canPublishRate = can("Gold_Rate_Management", "can_create_gold_rate");
  // Without locker view, the picker is hidden rather than left to 403 on every search.
  const canViewLockers = can("Locker_Management", "can_view_locker_module");
  const canCreateOrnamentType = can("Ornament_Type_Management", "can_create_ornament_type");
  const canDeleteDrafts = can("Loan_Management", "can_delete_loan");
  const { singleBranch } = useBranding();
  const showBranch = useShowBranch();
  const lockerLabelOf = (k: LockerView) =>
    showBranch
      ? `${k.code} — ${k.branchName} (${k.occupied}/${k.capacity} packets)`
      : `${k.code} (${k.occupied}/${k.capacity} packets)`;
  const { config: workflow } = useApprovalWorkflow();
  const { refresh } = useData();
  const { customers } = useCustomers();
  const { schemes } = useSchemes();
  const { loans, refresh: refreshLoans } = useLoans();
  const { latest: rates, isTodaySet, refresh: refreshGoldRates } = useGoldRates();
  const { openModal, closeModal } = useModal();
  const toast = useToast();

  // Lets staff resolve a missing/stale rate without leaving this page.
  const [rateR24, setRateR24] = useState("");
  const [rateErr, setRateErr] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  // Re-added on a rAF tick after clearing, since re-applying the same class mid-animation doesn't restart it.
  const [shakeRateBanner, setShakeRateBanner] = useState(false);
  // "Submit for Approval" is the only plain .btn on the page, so this selector can't match Save Draft/photo/discard buttons.
  const onEnterSubmit = useMemo(() => makeEnterToSubmitHandler(".btn:not(.ghost):not(.plain):not(.danger):not(:disabled)"), []);

  async function saveTodayRate() {
    const k24 = +rateR24;
    if (!(k24 > 0)) {
      setRateErr("The 24K rate must be greater than zero.");
      return;
    }
    setRateErr("");
    setRateSaving(true);
    try {
      await publishGoldRate({ karat: 24, rate: k24, setBy: rates.setBy && rates.setBy !== "—" ? rates.setBy : "Admin" });
      refreshGoldRates();
      setRateR24("");
      toast("Gold rate published for today");
    } catch (e) {
      setRateErr(e instanceof ApiError ? e.message : "Could not publish rate — try again");
    } finally {
      setRateSaving(false);
    }
  }

  // Preview only — the real number is assigned server-side on submit; loans.length + 1 drifts once anything's deleted.
  const [provId, setProvId] = useState("LN-" + String(loans.length + 1).padStart(5, "0"));
  useEffect(() => {
    let live = true;
    getNextLoanNumber().then((n) => { if (live) setProvId(n); }).catch(() => {});
    return () => { live = false; };
  }, [loans.length]);

  // Picking a locker checks the loan's auto-created packet straight into it at creation; "Assign later" keeps the manual flow.

  // Deliberately NOT defaulted to the first verified customer/active scheme — staff must actively pick from the dropdown.
  const [custId, setCustId] = useState("");
  const [custLabel, setCustLabel] = useState("");
  // Opened from a customer's profile — the route carries that customer's id, so pre-select them here.
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    getCustomer(customerId)
      .then((c) => {
        if (cancelled) return;
        setCustId(c.id);
        setCustLabel(`${c.name} (${c.code})`);
        applyCustomerBranch(c);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [customerId]);
  // Only for roles that may choose a branch — everyone else is pinned to their own by the backend.
  function applyCustomerBranch(c: { branchId: number; branchName: string }) {
    if (!isCrossBranch || singleBranch || selectedBranchId != null || !c.branchId) return;
    setBranchId((cur) => {
      if (cur !== c.branchId) { setLockerId(""); setLockerLabel(""); }
      return c.branchId;
    });
    setBranchLabel(c.branchName);
  }
  const [schemeId, setSchemeId] = useState("");
  // `schemes` is a snapshot fetched once on app load, so a scheme created since would vanish — stash the picked object instead.
  const [schemeObj, setSchemeObj] = useState<SchemeView | null>(null);
  const [schemeLabel, setSchemeLabel] = useState("");
  const [lockerId, setLockerId] = useState<number | "">("");
  const [rows, setRows] = useState<OrnRow[]>([]);
  // Staff can override the disbursed principal; prefilled to the eligible amount, re-prefilled whenever that amount changes.
  const [principalOverride, setPrincipalOverride] = useState("");
  // True while the typed amount exceeds eligible — shown as feedback since the field itself silently clamps to the ceiling.
  const [principalExceedsEligible, setPrincipalExceedsEligible] = useState(false);
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [overallPhoto, setOverallPhoto] = useState("");
  const [chargeMode, setChargeMode] = useState<"WithheldFromPayout" | "AddedToPrincipal">("WithheldFromPayout");
  // May be backdated but never set in the future; interest accrues from this date and the due date derives from it.
  const [openedDate, setOpenedDate] = useState(localISO(new Date()));

  // Non-admin staff are confined to their own branch (scoped server-side); the select is also locked for them.
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [branchLabel, setBranchLabel] = useState("");
  const [lockerLabel, setLockerLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // draftId is set once saved (or reopened), so subsequent saves overwrite it instead of piling up near-duplicates.
  const [draftId, setDraftId] = useState<number | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [drafts, setDrafts] = useState<BackendLoanDraft[]>([]);
  useEffect(() => {
    listActiveBranches()
      .then((list) => {
        setBranches(list);
        if (list.length) {
          const first = list.find((b) => b.id === selectedBranchId) ?? list[0];
          setBranchId((cur) => (cur === "" ? first.id : cur));
          setBranchLabel((cur) => (cur === "" ? first.name : cur));
        }
      })
      .catch(() => toast("Could not load branches — try again later."));
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filters the short in-memory branch list client-side, but uses SearchableSelect for its themed dropdown.
  async function searchBranchesLocal(q: string, _page: number): Promise<{ items: BranchView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    const items = query ? branches.filter((b) => b.name.toLowerCase().includes(query)) : branches;
    return { items, hasMore: false };
  }

  // Full lockers are filtered out of each page rather than shown disabled; scoped to the loan's selected branch.
  function searchLockers(q: string, page: number): Promise<{ items: LockerView[]; hasMore: boolean }> {
    return searchLockersPage(q, page, { activeOnly: true, branchId: branchId === "" ? undefined : branchId }).then((res) => ({
      items: res.items.filter((k) => k.occupied < k.capacity),
      hasMore: res.hasMore,
    }));
  }

  const sch = (schemeObj && schemeObj.id === schemeId) ? schemeObj : schemes.find((s) => s.id === schemeId);

  // Uses rateForPurityFull (not K24-only) since the backend values a 22K/18K ornament at its own published rate.
  const rowVals = rows.map((r) => r.netW * (rateForPurityFull(rates, r.p) ?? 0));
  const totalWeight = round3(rows.reduce((s, r) => s + r.netW, 0));
  const totalGross = rowVals.reduce((s, v) => s + v, 0);
  const eligible = sch ? (totalGross * sch.ltv) / 100 : 0;
  // When the scheme adds its service charge to the principal, the FINAL principal (entered + charge) is what's capped at
  // EligibleLoanAmount — so the entry ceiling here is reduced by the charge to match (WithheldFromPayout needs no adjustment).
  const maxPrincipalEntry = Math.round(eligible * 100) / 100;
  const principal = principalOverride.trim() ? Math.min(Math.max(0, +principalOverride), maxPrincipalEntry) : maxPrincipalEntry;
  // Set when a saved draft is being applied: its own override arrived with its ornaments, so it must survive this reset.
  const skipOverrideResetRef = useRef(false);
  useEffect(() => {
    if (skipOverrideResetRef.current) {
      skipOverrideResetRef.current = false;
      return;
    }
    // Prefilled with maxPrincipalEntry rather than cleared to empty, so the field always shows a real, submittable figure.
    setPrincipalOverride(maxPrincipalEntry > 0 ? String(maxPrincipalEntry) : "");
    setPrincipalExceedsEligible(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPrincipalEntry]);

  // Set only by addOrnRow() — distinguishes a "+ Add Ornament" click from other ways `rows` can grow (e.g. applyDraft()).
  const justAddedRowRef = useRef(false);

  function addOrnRow(pre?: OrnRow) {
    // Ornament type starts blank — it must be explicitly picked, never silently defaulted.
    justAddedRowRef.current = true;
    setRows((rs) => [...rs, pre || { n: "", p: "22K", w: 0, lessWt: 0, netW: 0, q: 1 }]);
  }

  // Moves focus off "+ Add Ornament" after it adds a row, or a stray Enter press would re-click it.
  useEffect(() => {
    if (!justAddedRowRef.current) return;
    justAddedRowRef.current = false;
    requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>(".orn-type-td input.inp");
      const visible = Array.from(inputs).filter((el) => el.offsetParent !== null);
      visible[visible.length - 1]?.focus();
    });
  }, [rows.length]);
  function delOrnRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }
  function updOrn<K extends keyof OrnRow>(i: number, k: K, v: OrnRow[K]) {
    // Weight/qty can never go negative, however it arrives — clamp centrally rather than trusting each call site.
    const clamped = (k === "w" || k === "lessWt" || k === "q") && typeof v === "number" ? (Math.max(0, v) as OrnRow[K]) : v;
    setRows((rs) => rs.map((r, idx) => {
      if (idx !== i) return r;
      // Net Wt is directly editable — editing it derives Less Wt instead, clamped to [0, Gross Wt].
      if (k === "netW" && typeof v === "number") {
        const netW = Math.min(Math.max(0, v), r.w);
        return { ...r, netW, lessWt: round3(Math.max(0, r.w - netW)) };
      }
      const next = { ...r, [k]: clamped };
      if (k === "w" || k === "lessWt") next.netW = round3(Math.max(0, next.w - next.lessWt));
      return next;
    }));
  }

  async function ornImgPicked(i: number, f: File) {
    if (!f.type.startsWith("image/")) { toast("Please choose an image file"); return; }
    try {
      const url = await uploadFile(f);
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, imgs: [...(r.imgs ?? []), url] } : r)));
    } catch {
      toast("Could not upload photo — try again");
    }
  }
  function delOrnImg(i: number, url: string) {
    setRows((rs) => rs.map((r, idx) => {
      if (idx !== i) return r;
      const imgs = (r.imgs ?? []).filter((u) => u !== url);
      const { imgs: old, ...rest } = r;
      void old;
      return (imgs.length ? { ...rest, imgs } : rest) as OrnRow;
    }));
  }
  async function overallPhotoPicked(f: File) {
    if (!f.type.startsWith("image/")) { toast("Please choose an image file"); return; }
    try {
      setOverallPhoto(await uploadFile(f));
    } catch {
      toast("Could not upload photo — try again");
    }
  }
  function ornPhotoMenu(i: number, content: React.ReactNode, title: string, style: React.CSSProperties) {
    return (
      <PhotoSourceMenu
        multiple
        onFile={(f) => { void ornImgPicked(i, f); }}
        webcamTitle={`Ornament Photo${rows[i]?.n ? " — " + rows[i].n : ""}`}
        trigger={(t) => (
          <button ref={t.ref} type="button" className="btn plain sm" style={style} title={title} aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}>{content}</button>
        )}
      />
    );
  }
  function ornPhotoCell(i: number) {
    const imgs = rows[i]?.imgs ?? [];
    if (!imgs.length) {
      return ornPhotoMenu(i, <Icon name="camera" />, "Add ornament photos", { padding: 0, width: 31, height: 31, display: "inline-flex", alignItems: "center", justifyContent: "center" });
    }
    return (
      <div style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, alignItems: "center", justifyContent: "flex-start", padding: "6px 6px 0 0" }}>
        {imgs.map((u) => (
          <span key={u} style={{ position: "relative", display: "inline-flex" }}>
            <SafeImage src={u} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title="View photo" onClick={() => viewOrnImg(i)} />
            <button type="button" title="Remove photo" aria-label="Remove photo"
              style={{ position: "absolute", top: -6, right: -6, width: 16, height: 16, padding: 0, borderRadius: "50%", border: "1px solid var(--line)", background: "var(--card, #fff)", color: "var(--red)", fontSize: 9, lineHeight: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
              onClick={() => delOrnImg(i, u)}>✕</button>
          </span>
        ))}
        {ornPhotoMenu(i, "+", "Add more photos", { padding: "0 9px", height: 31 })}
      </div>
    );
  }
  function viewOrnImg(i: number) {
    const r = rows[i];
    openModal(<OrnamentPhotoSlider title={r.n || "Ornament"} urls={r.imgs ?? []} onClose={closeModal} onRemove={(u) => delOrnImg(i, u)} />, true);
  }

  // --- "Save Draft" ---
  // Deliberately saves whatever is on screen with no validation beyond a branch — real rules apply at Submit.
  function buildDraftInput(): SaveDraftInput {
    return {
      branchId: Number(branchId),
      ...(custId ? { customerId: Number(custId) } : {}),
      ...(schemeId ? { schemeId: Number(schemeId) } : {}),
      ...(lockerId !== "" ? { lockerId: Number(lockerId) } : {}),
      // Empty field means "use the eligible amount", which must stay computed, not frozen (next week's gold rate).
      ...(principalOverride.trim() ? { principalOverride: +principalOverride } : {}),
      ...(overallPhoto ? { overallPhotoUrl: overallPhoto } : {}),
      ornaments: rows.map((r) => ({
        name: r.n,
        purity: r.p,
        grossWeight: r.w,
        quantity: r.q,
        ...(r.imgs?.length ? { imageUrl: r.imgs[0], imageUrls: r.imgs } : {}),
      })),
    };
  }

  async function loadDrafts() {
    try {
      setDrafts(await listDrafts());
    } catch {
      // Drafts are a convenience, not part of loan creation — a failure to
      // list them must not interfere with using this page.
    }
  }

  async function saveDraftNow() {
    if (branchId === "") { toast("Please select a branch before saving a draft"); return; }
    // Blank ornament rows (just added, nothing typed) don't count toward "has content".
    const hasOrnamentDetail = rows.some((r) => r.n.trim() || r.w > 0 || r.imgs?.length);
    if (!custId && !schemeId && lockerId === "" && !hasOrnamentDetail && !overallPhoto) {
      toast("Enter some loan details before saving a draft");
      return;
    }
    setSavingDraft(true);
    try {
      const input = buildDraftInput();
      if (draftId) await updateDraft(draftId, input); else await saveDraft(input);
      await loadDrafts();
      toast(draftId ? "Draft updated" : "Draft saved — reopen it from “Saved drafts” below");
      // Hand back a blank form, or draftId would stay set and every later save would overwrite this one.
      resetForm();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save draft — try again");
    } finally {
      setSavingDraft(false);
    }
  }

  // Branch is kept — it's preset on load (and locked for non-admins), not something staff pick per loan.
  function resetForm() {
    setDraftId(null);
    setCustId("");
    setCustLabel("");
    setSchemeId("");
    setSchemeObj(null);
    setSchemeLabel("");
    setLockerId("");
    setLockerLabel("");
    setRows([]);
    setOverallPhoto("");
    setPrincipalOverride("");
    setPrincipalExceedsEligible(false);
    setAdditionalInfo("");
    setChargeMode("WithheldFromPayout");
  }

  // Locker label has no equivalent preload (unlike customer/scheme/branch), so it's looked up by id directly.
  function applyDraft(d: BackendLoanDraft) {
    setDraftId(d.id);
    setCustId(d.customerId ? String(d.customerId) : "");
    setCustLabel(d.customer ? `${d.customer.name} (${d.customer.code})` : "");
    setSchemeId(d.schemeId ? String(d.schemeId) : "");
    setSchemeObj(null); // draft carries only a label — fall back to the schemes list lookup
    setSchemeLabel(d.scheme ? d.scheme.name : "");
    setBranchId(d.branchId);
    setBranchLabel(d.branch?.name || "");
    setLockerId(canViewLockers ? d.lockerId ?? "" : "");
    setLockerLabel("");
    if (canViewLockers && d.lockerId) {
      getLocker(d.lockerId)
        .then((k) => setLockerLabel(lockerLabelOf(k)))
        .catch(() => {/* locker may have since been deleted — leave the label blank */});
    }
    setRows(d.ornaments.map((o) => ({
      n: o.name,
      p: o.purity || "22K",
      w: o.grossWeight,
      // Drafts don't persist the Gross/Less Wt distinction — reopening assumes no deduction was recorded yet.
      lessWt: 0,
      netW: o.grossWeight,
      q: o.quantity,
      // Drafts saved before multi-photo only have the single imageUrl.
      ...(o.imageUrls?.length ? { imgs: o.imageUrls } : o.imageUrl ? { imgs: [o.imageUrl] } : {}),
    })));
    setOverallPhoto(d.overallPhotoUrl || "");
    // Suppress the reset that restoring rows would normally trigger, or reopening a draft would drop its saved amount.
    skipOverrideResetRef.current = true;
    setPrincipalOverride(d.principalOverride != null ? String(d.principalOverride) : "");
    toast("Draft reopened — review it, then submit for approval");
  }

  async function discardDraft(id: number) {
    try {
      await deleteDraft(id);
      if (draftId === id) setDraftId(null);
      await loadDrafts();
      toast("Draft discarded");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not discard draft — try again");
    }
  }

  async function submitNewLoan() {
    const validRows = rows.filter((r) => r.w > 0 && r.q > 0);
    if (!validRows.length) { toast("Add at least one ornament with weight and qty"); return; }
    if (validRows.some((r) => !r.n.trim())) { toast("Please select an ornament type for every row"); return; }
    if (validRows.some((r) => r.lessWt > r.w)) { toast("Less Wt cannot be greater than Gross Wt"); return; }
    const s = (schemeObj && schemeObj.id === schemeId) ? schemeObj : schemes.find((x) => x.id === schemeId);
    if (!s) { toast("Please select a scheme"); return; }
    if (!custId) { toast("Please select a verified customer"); return; }
    if (branchId === "") { toast("Please select a branch"); return; }

    if (!(principal > 0)) { toast("Please enter a valid loan amount"); return; }
    if (!isTodaySet) {
      toast("Today's gold rate must be set before creating a loan.");
      setShakeRateBanner(false);
      requestAnimationFrame(() => setShakeRateBanner(true));
      return;
    }
    const today = localISO(new Date());
    if (!openedDate) { toast("Please select the loan date"); return; }
    if (openedDate > today) { toast("Loan date cannot be in the future"); return; }
    const months = s.durationMonths || 12;
    const [oy, om, od] = openedDate.split("-").map(Number);
    const due = new Date(oy, om - 1, od);
    due.setMonth(due.getMonth() + months);

    setSubmitting(true);
    try {
      const loan = await createLoan({
        branchId: Number(branchId),
        customerId: Number(custId),
        schemeId: Number(schemeId),
        openedDate,
        dueDate: localISO(due),
        principalAmount: principal,
        ornaments: validRows.map((r) => ({
          name: r.n,
          purity: r.p,
          grossWeight: r.w,
          // netW is only ever derived client-side for display; the backend re-derives NetWeight the same way.
          deductionWeight: r.lessWt,
          quantity: r.q,
          // Every photo is attached by the backend as the ornament is created.
          ...(r.imgs?.length ? { images: r.imgs } : {}),
        })),
        ...(overallPhoto ? { overallPhotoUrl: overallPhoto } : {}),
        ...(lockerId !== "" ? { lockerId: Number(lockerId) } : {}),
        // Hands the backend the draft this loan came from, so it's discarded now that a real loan exists.
        ...(draftId ? { draftId } : {}),
        ...(additionalInfo.trim() ? { additionalInfo: additionalInfo.trim() } : {}),
        ...(sch && sch.serviceChargeType !== "None" ? { serviceChargeMode: chargeMode } : {}),
      });

      setDraftId(null);
      void loadDrafts();

      refresh();
      refreshLoans();
      const firstStage = stageByPending(workflow, "loan_sanction", loan.approvalStage);
      toast(`Loan ${loan.loanNumber} submitted for approval${firstStage ? ` — awaiting ${firstStage.label}` : ""}`);
      navigate("loan/" + loan.loanNumber);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not submit loan — try again");
    } finally {
      setSubmitting(false);
    }
  }

  // Defensive second check — the route guard already blocks direct navigation here, and the backend 403s regardless.
  if (!can("Loan_Management", "can_create_loan")) {
    return (
      <div className="empty">
        You don&apos;t have permission to create a loan. Contact a Loan Operator, Branch Manager, or Administrator.
      </div>
    );
  }

  return (
    // display:contents keeps this key handler in the DOM without becoming the sole flex item of `.page`.
    <div onKeyDown={onEnterSubmit} style={{ display: "contents" }}>
      <div className="page-h"><div><h1>New Gold Loan</h1><p>Select a verified customer, choose a scheme, and record pledged ornaments</p></div></div>
      <hr className="gold-rule" style={{ margin: "4px 0 18px" }} />
      {!isTodaySet && (
        <div
          className={`notice${shakeRateBanner ? " shake-attention" : ""}`}
          style={{ borderColor: "var(--red)", marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 10 }}
          onAnimationEnd={() => setShakeRateBanner(false)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--red)" }}>
            <Icon name="warning" /> <b>Today&apos;s gold rate must be set before creating a loan.</b>
          </div>
          {canPublishRate ? (
            <>
              <div className="frow"><div><label className="f">24K · 999 (₹/g)</label><input className="inp" type="number" onWheel={blurOnWheel} value={rateR24} onChange={(e) => setRateR24(e.target.value)} /></div></div>
              <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
                Only the 24K benchmark needs to be set — other purities are resolved per-ornament when pledged.
              </p>
              {rateErr && <p style={{ color: "var(--red)", fontSize: 12.5, margin: 0 }}>{rateErr}</p>}
              <div>
                <button className="btn" onClick={saveTodayRate} disabled={rateSaving}>
                  <Icon name="check" /> {rateSaving ? "Saving…" : "Save Rate"}
                </button>
              </div>
            </>
          ) : (
            <p style={{ fontSize: 12.5, margin: 0 }}>Ask someone who can publish gold rates to set today&apos;s rate.</p>
          )}
        </div>
      )}
      {/* Inline override of .cols21's shared ratio, scoped to this page's grid, gives the ornament form more room. */}
      <div className="grid cols21 newloan-orn-grid" style={{ gridTemplateColumns: "minmax(0, 2.34fr) minmax(0, 0.9fr)" }}>
        {/* orn-form-card opts this card into a container query so the table falls back to card view by its own width. */}
        <div className="card gtop orn-form-card"><div className="bd">
          <div className="frow c2">
            <div><label className="f">Customer</label>
              <SearchableSelect<CustomerView>
                value={custLabel}
                onChange={(id, item) => { setCustId(id); setCustLabel(`${item.name} (${item.code})`); applyCustomerBranch(item); }}
                fetchFn={searchCustomersPage}
                searchHint="Searches: customer name, customer code, phone"
                getLabel={(c) => `${c.name} (${c.code})`}
                // Verified badge is the only marker now; backend still refuses an unverified customer on submit regardless.
                renderLabel={(c) => (
                  <span className="ss-name">
                    <b>{c.name} ({c.code})</b>
                    <VerifiedBadge customer={c} />
                  </span>
                )}
                getId={(c) => c.id}
                placeholder="Search customers…"
              /></div>
            <div><label className="f">Scheme</label>
              <SearchableSelect<SchemeView>
                value={schemeLabel}
                onChange={(id, item) => { setSchemeId(id); setSchemeObj(item); setSchemeLabel(`${item.name} — ${item.ltv}% LTV @ ${item.rate}%`); }}
                fetchFn={searchActiveSchemesPage}
                searchHint="Searches: scheme name, scheme code"
                getLabel={(s) => `${s.name} — ${s.ltv}% LTV @ ${s.rate}%`}
                getId={(s) => s.id}
                placeholder="Search active schemes…"
              /></div>
          </div>
          <div className={showBranch || !canViewLockers ? "frow c2" : "frow c3"}>
            {showBranch && <div><label className="f">Branch</label>
              {/* Locked unless a cross-branch role and more than one active branch exist. */}
              <SearchableSelect<BranchView>
                value={branchLabel}
                onChange={(id, item) => {
                  // A picked locker belongs to the old branch — drop it.
                  if (+id !== branchId) { setLockerId(""); setLockerLabel(""); }
                  setBranchId(+id); setBranchLabel(item.name);
                }}
                fetchFn={searchBranchesLocal}
                searchHint="Searches: branch name"
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder={branches.length === 0 ? "Loading branches…" : "Search branch…"}
                disabled={!isCrossBranch || singleBranch || selectedBranchId != null || branches.length <= 1}
              /></div>}
            {canViewLockers && <div><label className="f">Locker / Storage</label>
              {/* key={branchId} remounts so cached results don't show the previous branch's lockers. */}
              <SearchableSelect<LockerView>
                key={branchId}
                value={lockerLabel}
                onChange={(id, item) => { setLockerId(+id); setLockerLabel(lockerLabelOf(item)); }}
                fetchFn={searchLockers}
                searchHint="Searches: locker code"
                getLabel={lockerLabelOf}
                getId={(k) => String(k.id)}
                placeholder="— Assign later — or search locker…"
              /></div>}
            {!showBranch && <>
              <div><label className="f">Loan No (auto)</label><input className="inp" value={provId} disabled /></div>
              <div><label className="f">Loan Date</label><DatePicker value={openedDate} onChange={setOpenedDate} max={localISO(new Date())} /></div>
            </>}
          </div>
          {showBranch && (
            <div className="frow c2">
              <div><label className="f">Loan No (auto)</label><input className="inp" value={provId} disabled /></div>
              <div><label className="f">Loan Date</label><DatePicker value={openedDate} onChange={setOpenedDate} max={localISO(new Date())} /></div>
            </div>
          )}
          <label className="f" style={{ marginTop: 6 }}>Pledged Ornaments</label>
          {/* No .tbl-wrap: overflow-x:auto there would force vertical overflow too, clipping the type picker's dropdown. */}
          {/* Two renderings of `rows`, toggled by a 1350px breakpoint (CSS display only) — each with its own photo menu. */}
          {/* minWidth:900 is a computed floor: Purity's 22% column needs ~176px for its toggle, so columns must sum to 100%. */}
          <div className="orn-table-view" style={{ width: "100%", minWidth: 900, paddingBottom: 6 }}><table className="tbl orn-table" style={{ width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "7%" }} />
              {/* Purity needs real room for its Karat/Fineness toggle plus the number field beside it. */}
              <col style={{ width: "22%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "7%" }} />
            </colgroup>
            <thead><tr><th>Ornament</th><th style={{ textAlign: "center", paddingRight: 4 }}>Qty</th><th style={{ paddingLeft: 4, paddingRight: 0 }}>Purity</th><th className="num" style={{ paddingLeft: 2, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis" }}>Gross(g)</th><th className="num" style={{ paddingLeft: 8, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis" }}>Less(g)</th><th className="num" style={{ paddingLeft: 8, paddingRight: 8, overflow: "hidden", textOverflow: "ellipsis" }}>Net(g)</th><th style={{ textAlign: "left", paddingLeft: 8 }}>Photo</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="empty">No ornaments added yet — click &quot;Add Ornament&quot; below.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="orn-type-td">
                    <SearchableSelect<BackendOrnamentType>
                      value={r.n}
                      onChange={(_id, item) => updOrn(i, "n", item.name)}
                      fetchFn={searchOrnamentTypesPage}
                      searchHint="Searches: ornament type name"
                      getLabel={(t) => t.name}
                      getId={(t) => String(t.id)}
                      placeholder="Ornament type…"
                      allowCreate={canCreateOrnamentType}
                      onCreate={createOrnamentType}
                    />
                  </td>
                  <td style={{ paddingRight: 4 }}><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 32, height: 31, textAlign: "center", boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} placeholder="Qty" value={r.q === 0 ? "" : r.q} onChange={(e) => updOrn(i, "q", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td style={{ paddingLeft: 4, paddingRight: 0 }}><PurityPicker value={r.p} onChange={(v) => updOrn(i, "p", v)} dropdownMinWidth={0} /></td>
                  <td className="num" style={{ paddingLeft: 2, paddingRight: 8 }}><WeightInput className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 68, height: 31, textAlign: "right", boxSizing: "border-box" }} placeholder="0.000" value={r.w} onChange={(v) => updOrn(i, "w", v)} /></td>
                  <td className="num" style={{ paddingLeft: 8, paddingRight: 8 }}><WeightInput className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 68, height: 31, textAlign: "right", boxSizing: "border-box" }} placeholder="0.000" value={r.lessWt} onChange={(v) => updOrn(i, "lessWt", v)} /></td>
                  <td className="num" style={{ paddingLeft: 8, paddingRight: 8 }}><WeightInput className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 68, height: 31, textAlign: "right", boxSizing: "border-box" }} placeholder="0.000" value={r.netW} onChange={(v) => updOrn(i, "netW", v)} /></td>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap", paddingLeft: 8, paddingRight: 2 }}>
                    {ornPhotoCell(i)}
                  </td>
                  <td style={{ textAlign: "center", paddingLeft: 2 }}>
                    <button className="btn danger sm" style={{ height: 31, width: 31, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }} title="Remove ornament" onClick={() => delOrnRow(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>

          <div className="orn-cards-view">
            {rows.length === 0 && (
              <div className="empty" style={{ padding: "14px 4px" }}>No ornaments added yet — click &quot;Add Ornament&quot; below.</div>
            )}
            {rows.map((r, i) => (
              <div className="orn-card" key={i}>
                <div className="orn-card-row">
                  <div className="orn-type-td" style={{ flex: 1, minWidth: 0 }}>
                    <label className="f">Ornament</label>
                    <SearchableSelect<BackendOrnamentType>
                      value={r.n}
                      onChange={(_id, item) => updOrn(i, "n", item.name)}
                      fetchFn={searchOrnamentTypesPage}
                      searchHint="Searches: ornament type name"
                      getLabel={(t) => t.name}
                      getId={(t) => String(t.id)}
                      placeholder="Ornament type…"
                      allowCreate={canCreateOrnamentType}
                      onCreate={createOrnamentType}
                    />
                  </div>
                  <div style={{ width: 60, flexShrink: 0 }}>
                    <label className="f">Qty</label>
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box", textAlign: "center" }} type="number" onWheel={blurOnWheel} min={0} placeholder="Qty" value={r.q === 0 ? "" : r.q} onChange={(e) => updOrn(i, "q", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} />
                  </div>
                  <button className="btn danger sm" style={{ height: 31, width: 31, padding: 0, marginTop: 20, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }} title="Remove ornament" onClick={() => delOrnRow(i)}>✕</button>
                </div>
                <div>
                  <label className="f">Purity</label>
                  <PurityPicker value={r.p} onChange={(v) => updOrn(i, "p", v)} dropdownMinWidth={70} />
                </div>
                <div className="orn-card-row" style={{ flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label className="f">Gross Wt (g)</label>
                    <WeightInput className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} placeholder="0.000" value={r.w} onChange={(v) => updOrn(i, "w", v)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label className="f">Less Wt (g)</label>
                    <WeightInput className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} placeholder="0.000" value={r.lessWt} onChange={(v) => updOrn(i, "lessWt", v)} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label className="f">Net Wt (g)</label>
                    <WeightInput className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} placeholder="0.000" value={r.netW} onChange={(v) => updOrn(i, "netW", v)} />
                  </div>
                </div>
                <div className="orn-card-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Photo</span>
                  {ornPhotoCell(i)}
                </div>
              </div>
            ))}
          </div>
          {/* tabIndex only while there are zero ornaments, so Enter can create the first row with no keyboard dead end. */}
          <button className="btn plain sm" style={{ marginTop: 10 }} tabIndex={rows.length === 0 ? 0 : -1} onClick={() => addOrnRow()}><Icon name="plus" /> Add Ornament</button>
        </div>
          <div className="ft" style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", padding: "14px 18px" }}>
            {/* Print/download actions were removed here — a provisional loan's documents might still change during approval. */}
            <button className="btn ghost" onClick={saveDraftNow} disabled={savingDraft}>
              {savingDraft ? "Saving…" : draftId ? "Update Draft" : "Save Draft"}
            </button>
            <button className="btn" onClick={submitNewLoan} disabled={submitting || !isTodaySet} title={!isTodaySet ? "Today's gold rate must be set before creating a loan." : undefined}>
              <Icon name="check" /> {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
          </div>
        </div>

        <div className="grid newloan-sidebar">
          <div className="card gtop"><div className="hd"><h3>Valuation</h3></div>
            <div className="bd" style={{ fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Total net weight</span><b>{totalWeight.toFixed(3)} g</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Gross gold value</span><b>{fmt(totalGross)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Scheme LTV</span><b>{sch ? sch.ltv + "%" : "—"}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                <span>Eligible gold amount</span><b>{fmt(eligible)}</b></div>
              {(() => {
                const hasCharge = !!sch;
                const amount = +principalOverride || 0;
                const charge = !sch || sch.serviceChargeType === "None" ? 0 : sch.serviceChargeType === "Flat" ? sch.serviceChargeValue : (amount * sch.serviceChargeValue) / 100;
                const withheld = chargeMode === "WithheldFromPayout";
                // AddedToPrincipal rides on top of what the customer receives; WithheldFromPayout comes off it.
                const loanPrincipal = hasCharge && !withheld ? amount + charge : amount;
                const disbursed = hasCharge && withheld ? Math.max(0, amount - charge) : amount;
                const row = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "5px 0" } as const;
                return (
                  <>
                    {hasCharge && sch && (
                      <>
                        <div style={row}>
                          <span>Service charge{sch.serviceChargeType === "Percent" ? ` (${sch.serviceChargeValue}%)` : ""}</span>
                          <b style={{ color: withheld ? "var(--red)" : "var(--green)" }}>{withheld ? "−" : "+"}{fmt(charge)}</b>
                        </div>
                        <div style={row}>
                          <span>Charge method</span>
                          <div style={{ width: 170 }}>
                            <Select
                              value={chargeMode}
                              onChange={(v) => setChargeMode(v as "WithheldFromPayout" | "AddedToPrincipal")}
                              options={[
                                { value: "WithheldFromPayout", label: "Deduct from loan" },
                                { value: "AddedToPrincipal", label: "Add to loan" },
                              ]}
                            />
                          </div>
                        </div>
                      </>
                    )}
                    <div style={{ ...row, borderTop: "1px dashed var(--line)", marginTop: 8, paddingTop: 10 }}>
                      <label htmlFor="loan-amount-input">Amount (₹)</label>
                      <input
                        id="loan-amount-input"
                        className="inp"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        // Integer part is grouped; the paise are shown as typed.
                        value={principalOverride
                          ? (() => {
                              const [ip, fp] = principalOverride.split(".");
                              return (+ip || 0).toLocaleString("en-IN") + (fp !== undefined ? "." + fp : "");
                            })()
                          : ""}
                        onChange={(e) => {
                          const el = e.target;
                          const atEnd = (el.selectionStart ?? el.value.length) >= el.value.length;
                          // Digits left of the caret, so it can be restored after re-grouping instead of jumping to the end.
                          const digitsLeft = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, "").length;
                          const raw = el.value.replace(/[^\d.]/g, "");
                          const dot = raw.indexOf(".");
                          const clean = (dot === -1
                            ? raw
                            : raw.slice(0, dot) + "." + raw.slice(dot + 1).replace(/\./g, "").slice(0, 2)
                          ).replace(/^0+(?=\d)/, "");
                          const num = clean === "" || clean === "." ? 0 : +clean;
                          // Clamp so the field never shows a figure the server would reject; show the clamp as feedback.
                          if (num > maxPrincipalEntry) {
                            setPrincipalOverride(String(maxPrincipalEntry));
                            setPrincipalExceedsEligible(true);
                          } else {
                            setPrincipalOverride(clean);
                            setPrincipalExceedsEligible(false);
                          }
                          requestAnimationFrame(() => {
                            let pos = 0, seen = 0;
                            if (atEnd) pos = el.value.length;
                            else while (pos < el.value.length && seen < digitsLeft) { if (/\d/.test(el.value[pos])) seen++; pos++; }
                            el.setSelectionRange(pos, pos);
                          });
                        }}
                        style={{ flex: "0 0 120px", minWidth: 0, padding: "3px 8px", textAlign: "right", fontWeight: 600, color: "var(--brand-deep)", fontSize: 13.5 }}
                      />
                    </div>
                    {principalExceedsEligible && (
                      <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 4px", textAlign: "right" }}>
                        Amount can&apos;t exceed {fmt(maxPrincipalEntry)}.
                      </p>
                    )}
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "8px 0 0", marginTop: 6, borderTop: "1px solid var(--line)" }}>
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>Principal</span>
                      <b style={{ fontSize: 18, letterSpacing: "-.01em", color: "var(--brand-deep)" }}>{fmt(loanPrincipal)}</b>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, padding: "8px 0 0", marginTop: 6, borderTop: "1px solid var(--line)" }}>
                      <span style={{ color: "var(--muted)", fontWeight: 500 }}>Loan amount to disburse</span>
                      <b style={{ fontSize: 18, letterSpacing: "-.01em", color: "var(--green)" }}>{fmt(disbursed)}</b>
                    </div>
                  </>
                );
              })()}
              <div style={{ padding: "10px 0 2px" }}>
                <label className="f">Overall Photo (optional)</label>
                {overallPhoto ? (
                  <div style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                    <SafeImage src={overallPhoto} style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid var(--line)", cursor: "pointer" }} title="View overall photo" onClick={() => openModal(<OrnamentPhotoSlider title="Overall photo" urls={[overallPhoto]} onClose={closeModal} />, true)} />
                    <PhotoSourceMenu
                      onFile={(f) => { void overallPhotoPicked(f); }}
                      webcamTitle="Overall Photo"
                      trigger={(t) => (
                        <button ref={t.ref} type="button" className="btn plain sm" title="Replace overall photo" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}>↺</button>
                      )}
                    />
                    <button type="button" className="btn plain sm" title="Remove overall photo" onClick={() => setOverallPhoto("")}>✕</button>
                  </div>
                ) : (
                  <PhotoSourceMenu
                    onFile={(f) => { void overallPhotoPicked(f); }}
                    webcamTitle="Overall Photo"
                    trigger={(t) => (
                      <button ref={t.ref} type="button" className="btn plain sm" aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}><Icon name="camera" /> Add overall photo</button>
                    )}
                  />
                )}
              </div>
              <div style={{ padding: "10px 0 2px" }}>
                <label className="f" htmlFor="additional-info-input">Additional Information (optional)</label>
                <textarea
                  id="additional-info-input"
                  className="inp"
                  rows={3}
                  placeholder="Anything else worth recording on this loan…"
                  value={additionalInfo}
                  onChange={(e) => setAdditionalInfo(e.target.value)}
                  style={{ resize: "vertical", width: "100%" }}
                />
              </div>
            </div>
          </div>
          {/* Drafts are this employee's own (scoped server-side), not a branch queue — hidden entirely when empty. */}
          {drafts.length > 0 && (
            <div className="card gtop newloan-drafts"><div className="hd"><h3>Saved drafts</h3></div>
              <div className="bd" style={{ fontSize: 13 }}>
                {drafts.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                      borderBottom: "1px dashed var(--line)",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        {d.customer?.name || "No customer yet"}
                        {d.id === draftId ? " · editing" : ""}
                      </div>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        {d.ornaments.length} ornament{d.ornaments.length === 1 ? "" : "s"}
                        {d.scheme ? ` · ${d.scheme.name}` : ""}
                        {" · saved "}
                        {fmtDateTime(d.updatedAt)}
                      </div>
                    </div>
                    <button className="btn plain sm" onClick={() => applyDraft(d)}>Open</button>
                    {canDeleteDrafts && <button className="btn danger sm" title="Discard draft" onClick={() => discardDraft(d.id)}>✕</button>}
                  </div>
                ))}
              </div>
              <div className="ft">Opening a draft replaces whatever is currently in the form above.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
