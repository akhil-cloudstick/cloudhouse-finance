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
import { createLoan, addOrnamentImage, saveDraft, updateDraft, listDrafts, deleteDraft, getNextLoanNumber } from "@/modules/loans/services/loanService";
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


// Purity is now a plain unit-suffixed string ("22K" / "91.6%", see
// common/utils/purity.ts) rather than a fixed k24/k22/k18 bucket — PURITY_LABEL is
// gone since the string itself is already the display label.
//
// `w` (Gross Wt) and `lessWt` (Less Wt, i.e. deduction for stones/dust/
// impurity) are the two independently-entered figures — matching how an
// ornament is actually assessed: gross is a raw scale reading, "less wt" is
// what a jeweler deducts from it. `netW` is NOT entered directly; it's
// derived (`w − lessWt`, floored at 0, recomputed in updOrn below) purely
// for display and for the loan valuation, which is calculated off net
// weight alone — see rowVals below (qty is stored for record only, it does
// not multiply into weight or value anywhere). `lessWt` is sent to the
// backend as-is as Ornament.DeductionWeight, which already re-derives
// NetWeight the same way (GrossWeight − DeductionWeight, see
// backend/internal/loan/service.go) and already prices GoldValue as
// NetWeight × rate with no quantity factor — this frontend calc was the
// one out of step, not the backend.
type OrnRow = { n: string; p: string; w: number; lessWt: number; netW: number; q: number; img?: string; imgName?: string };

// A focused <input type="number"> steps its value on mouse-wheel scroll, so
// scrolling the page past a weight/qty field silently changes it. Dropping
// focus makes the wheel scroll the page instead.
function blurOnWheel(e: React.WheelEvent<HTMLInputElement>) {
  e.currentTarget.blur();
}

// "YYYY-MM-DD" in the browser's local timezone — toISOString() would give the
// UTC date, which is still yesterday before 05:30 IST.
function localISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type NewLoanPageProps = { customerId?: string };

/* Ported from legacy/app.js's `renderNewLoan()` (legacy/app.js:845-1151).
 * Customer/scheme/ornament-type pickers now hit the real backend search
 * endpoints (via SearchableSelect) instead of filtering an in-memory mock
 * list or a localStorage-backed type list. */
export function NewLoanPage({ customerId }: NewLoanPageProps = {}) {
  const { isCrossBranch, can, selectedBranchId } = useAuth();
  const canPublishRate = can("Gold_Rate_Management", "can_create_gold_rate");
  // Single-branch business: the Branch picker is locked to its one branch.
  const { singleBranch } = useBranding();
  // Single-branch plan: no branch is ever shown — the Branch picker is not
  // rendered and locker labels drop the branch name.
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

  // Inline "Set today's gold rate" recovery form (see the banner rendered
  // below) — lets staff resolve a missing/stale rate without leaving this
  // page, reusing RateModal.tsx's own validation rules and the same
  // publishGoldRate() call it makes.
  const [rateR24, setRateR24] = useState("");
  const [rateErr, setRateErr] = useState("");
  const [rateSaving, setRateSaving] = useState(false);
  // Briefly shakes the rate-recovery banner when staff try to submit
  // without a published rate for today, so the requirement is impossible
  // to miss instead of just showing a toast. Re-triggered on every blocked
  // attempt: re-added on a rAF tick after being cleared, since re-applying
  // the same class name to an element mid-animation doesn't restart it.
  const [shakeRateBanner, setShakeRateBanner] = useState(false);
  // Enter submits from any plain field on this page — this isn't a modal
  // (see common/utils/enterToSubmit.ts), so it needs its own handler.
  // "Submit for Approval" is the only plain (non-ghost/plain-variant/
  // danger) .btn on the whole page — "Save Draft" is ghost, "Add
  // Ornament"/photo buttons/"Open" are plain, the draft-discard ✕ is
  // danger — so this selector can't accidentally match any of those.
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

  // Preview only — mirrors the backend's actual assignment
  // (backend/internal/loan/service.go: `fmt.Sprintf("LN-%05d", count+1)`).
  // The real number is assigned server-side on submit; this just shows what
  // it's expected to be, from the real backend-backed loan list (`useLoans()`)
  // rather than the legacy localStorage-backed `db.loans`, which is always
  // empty now that loans live in the Go backend.
  // The real next number comes from the backend (highest ever issued + 1,
  // hard-deleted loans included) — loans.length + 1 drifts as soon as any
  // loan has been deleted. Refetched when the loan list changes.
  const [provId, setProvId] = useState("LN-" + String(loans.length + 1).padStart(5, "0"));
  useEffect(() => {
    let live = true;
    getNextLoanNumber().then((n) => { if (live) setProvId(n); }).catch(() => {});
    return () => { live = false; };
  }, [loans.length]);

  // Lockers are backend-managed (see lockerApi.ts / LockerModal.tsx). Picking
  // one here checks the loan's auto-created packet straight into it at
  // creation (see submitNewLoan's `lockerId` on createLoan()) instead of
  // requiring a separate manual "check in to locker" step afterward on the
  // Packets page — leaving it on "Assign later" keeps the old manual flow.

  // Deliberately NOT defaulted to the first verified customer/active scheme — the
  // SearchableSelect fields below start blank (custLabel/schemeLabel === "")
  // to match, so staff must actively pick from the dropdown. Defaulting
  // custId to the first verified customer while its label stayed blank used
  // to let a loan submit against that hidden default without anyone ever
  // selecting a customer.
  const [custId, setCustId] = useState("");
  const [custLabel, setCustLabel] = useState("");
  // Opened from a customer's profile ("New Loan" on CustomerDetail.tsx) —
  // the route carries that customer's id, so pre-select them here. This is
  // an explicit choice by staff, not the hidden default warned about above.
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
  // Picking a customer fills the Branch with theirs. Only for roles that may
  // choose a branch — everyone else is pinned to their own by the backend.
  function applyCustomerBranch(c: { branchId: number; branchName: string }) {
    if (!isCrossBranch || singleBranch || selectedBranchId != null || !c.branchId) return;
    setBranchId((cur) => {
      if (cur !== c.branchId) { setLockerId(""); setLockerLabel(""); }
      return c.branchId;
    });
    setBranchLabel(c.branchName);
  }
  const [schemeId, setSchemeId] = useState("");
  // The scheme picker searches GET /schemes/active live on every keystroke,
  // while `schemes` (useSchemes()) is a snapshot fetched once on app load —
  // a scheme created/activated after that snapshot (or otherwise missing
  // from it) would then vanish from the LTV panel and submit validation
  // even though it's visibly selected. Stashing the actual picked object
  // sidesteps that: it's used whenever its id still matches schemeId,
  // falling back to the `schemes` lookup only for draft-restored scheme ids
  // (see applyDraft(), which never populates this).
  const [schemeObj, setSchemeObj] = useState<SchemeView | null>(null);
  const [schemeLabel, setSchemeLabel] = useState("");
  const [lockerId, setLockerId] = useState<number | "">("");
  const [rows, setRows] = useState<OrnRow[]>([]);
  // Staff can override the disbursed principal instead of always taking the
  // scheme-LTV-computed eligible amount as-is (e.g. rounding down, or
  // sanctioning less than the max eligible). Prefilled to the eligible
  // amount (see the roundedEligible effect below) rather than left empty
  // behind a placeholder, so the field shows a real, immediately-editable
  // figure from the start — empty string still means "use the eligible
  // amount" for the principal calc below, but now only transiently, while
  // staff have the field cleared mid-edit, not as the field's resting
  // state. Re-prefilled whenever the eligible amount itself changes so a
  // stale manual figure never silently outlives the ornaments/scheme it
  // was computed against.
  const [principalOverride, setPrincipalOverride] = useState("");
  // True while the staff member's most recent keystroke in "Loan amount to
  // disburse" typed a number above the eligible amount — shown as inline
  // feedback since the field itself silently clamps to the eligible ceiling
  // rather than accepting the excess digits.
  const [principalExceedsEligible, setPrincipalExceedsEligible] = useState(false);
  // Free text staff may want to record on this loan that no standard field
  // captures — carried through onto the printed Statement of Account.
  const [additionalInfo, setAdditionalInfo] = useState("");
  // How the scheme's service charge is collected — chosen per loan here, not
  // on the scheme.
  const [chargeMode, setChargeMode] = useState<"WithheldFromPayout" | "AddedToPrincipal">("WithheldFromPayout");
  // Loan (opened) date — defaults to today, may be backdated but never set
  // in the future (the DatePicker's max blocks it; the backend re-checks).
  // Interest accrues from this date, and the due date is derived from it.
  const [openedDate, setOpenedDate] = useState(localISO(new Date()));

  // Non-admin staff are confined to their own branch — the backend's
  // GET /branches already scopes the list server-side (platform.GetBranchScope),
  // so a non-admin only ever gets their own branch back here; the select
  // below is additionally locked (disabled, single option) for them so the
  // UI doesn't even look pickable. Administrators see every active branch
  // and can freely choose.
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [branchLabel, setBranchLabel] = useState("");
  const [lockerLabel, setLockerLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // "Save Draft" state. draftId is set once this form has been saved (or was
  // reopened from a saved draft), so subsequent saves overwrite that draft
  // instead of leaving a trail of near-identical copies; it's also handed to
  // createLoan() so the backend discards the draft once the real loan exists.
  const [draftId, setDraftId] = useState<number | null>(null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [drafts, setDrafts] = useState<BackendLoanDraft[]>([]);
  useEffect(() => {
    listActiveBranches()
      .then((list) => {
        setBranches(list);
        if (list.length) {
          // The global branch selection, when one is active, else the first.
          const first = list.find((b) => b.id === selectedBranchId) ?? list[0];
          setBranchId((cur) => (cur === "" ? first.id : cur));
          setBranchLabel((cur) => (cur === "" ? first.name : cur));
        }
      })
      .catch(() => toast("Could not load branches — try again later."));
    // This staff member's own saved drafts, so an interrupted loan can be
    // picked back up (see the "Saved drafts" card below).
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Branch is a short, already-loaded list (not a paginated backend search
  // like customers/schemes/ornament types), so this just filters the
  // in-memory list client-side — but it's plugged into the same
  // SearchableSelect component so Branch shares its themed dropdown instead
  // of a native <select>'s unstyled browser popup.
  async function searchBranchesLocal(q: string, _page: number): Promise<{ items: BranchView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    const items = query ? branches.filter((b) => b.name.toLowerCase().includes(query)) : branches;
    return { items, hasMore: false };
  }

  // Server-side paginated + searched (same lockerService.ts's
  // searchLockersPage the Packet Check-In picker already uses) instead of a
  // bulk-fetch-then-filter-in-JS list — that approach needed a manual
  // re-fetch on every branch change and still relied on the branch filter
  // matching the fetched snapshot's own shape. Full lockers are filtered out
  // of each page rather than shown disabled. Scoped to the loan's selected
  // branch: a locker physically lives at one branch, so listing every
  // branch's lockers here would let staff assign gold into a locker the
  // branch doesn't actually have access to.
  function searchLockers(q: string, page: number): Promise<{ items: LockerView[]; hasMore: boolean }> {
    return searchLockersPage(q, page, { activeOnly: true, branchId: branchId === "" ? undefined : branchId }).then((res) => ({
      items: res.items.filter((k) => k.occupied < k.capacity),
      hasMore: res.hasMore,
    }));
  }

  const sch = (schemeObj && schemeObj.id === schemeId) ? schemeObj : schemes.find((s) => s.id === schemeId);

  // rateForPurityFull, not the K24-only derivation: the backend values an
  // exact 22K/18K ornament at its independently published K22/K18 rate, and
  // rejects a principal above ITS eligible amount — so the preview here must
  // use the same rate or it offers an amount the server then refuses.
  const rowVals = rows.map((r) => r.netW * (rateForPurityFull(rates, r.p) ?? 0));
  const totalWeight = rows.reduce((s, r) => s + r.netW, 0);
  const totalGross = rowVals.reduce((s, v) => s + v, 0);
  const eligible = sch ? (totalGross * sch.ltv) / 100 : 0;
  // Clear a stale manual override whenever the eligible amount it was based
  // on changes (ornaments edited, scheme swapped, rates refreshed) — the
  // field falls back to showing the new eligible amount as a placeholder
  // rather than silently keeping an amount computed against different gold.
  const roundedEligible = Math.floor(eligible);
  // When the scheme adds its service charge to the principal, the FINAL
  // principal (what's entered here + the charge) is what the backend caps
  // at EligibleLoanAmount, not just the entered amount alone (see
  // loan.Service.Create's finalPrincipal check) — a loan with an added
  // charge must stay within gold coverage the same as any other loan, so
  // the entry ceiling here is reduced by the charge to match, rather than
  // letting staff enter the full eligible amount and have it rejected
  // server-side once the charge is added. WithheldFromPayout doesn't touch
  // PrincipalAmount at all, so it needs no such adjustment.
  // The cap applies to the entered loan amount only — an AddedToPrincipal
  // charge is added on top of it and does not eat into the eligible amount
  // (see loan.Service.Create).
  const maxPrincipalEntry = roundedEligible;
  // Staff can reduce the disbursed principal below the ceiling, but never
  // raise it above — maxPrincipalEntry (eligible amount, minus any
  // AddedToPrincipal charge) is the hard cap a manual override may not
  // cross, and is also what an empty/cleared field falls back to (NOT the
  // full roundedEligible — defaulting to that when a charge applies would
  // prefill a figure that fails submission the moment the charge is added
  // on top).
  const principal = principalOverride.trim() ? Math.min(Math.max(0, +principalOverride), maxPrincipalEntry) : maxPrincipalEntry;
  // Set when a saved draft is being applied: that draft's own override
  // arrived together with its ornaments, so it is not stale and must survive
  // the reset this effect would otherwise perform. See applyDraft().
  const skipOverrideResetRef = useRef(false);
  useEffect(() => {
    if (skipOverrideResetRef.current) {
      skipOverrideResetRef.current = false;
      return;
    }
    // Prefill with maxPrincipalEntry (the eligible amount, or less when an
    // AddedToPrincipal charge needs room — see that field's own comment)
    // rather than clearing to empty — the field should always show a real,
    // ready-to-submit figure, not a placeholder staff have to notice and
    // accept, and never one that would fail submission as soon as the
    // charge is added on top.
    setPrincipalOverride(maxPrincipalEntry > 0 ? String(maxPrincipalEntry) : "");
    setPrincipalExceedsEligible(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxPrincipalEntry]);

  // Set only by addOrnRow() below — distinguishes an actual "+ Add
  // Ornament" click from every other way `rows` can grow (applyDraft()
  // restoring a saved draft's ornaments, most notably), so the focus
  // effect below only ever fires for the former.
  const justAddedRowRef = useRef(false);

  function addOrnRow(pre?: OrnRow) {
    // Ornament type starts blank — it must be explicitly picked (or created)
    // via the SearchableSelect below, never silently defaulted.
    justAddedRowRef.current = true;
    setRows((rs) => [...rs, pre || { n: "", p: "22K", w: 0, lessWt: 0, netW: 0, q: 1 }]);
  }

  // Moves focus into a freshly-added row's own Ornament-type field —
  // "+ Add Ornament" is an Enter-flow waypoint (enterToSubmit.ts): landing
  // on it via Enter never clicks it (.focus() only), so it takes an
  // explicit, separate Enter press while it's already focused to actually
  // add a row (native "Enter activates the focused button" behavior).
  // Without moving focus on from there afterward, it would still be the
  // only thing focus could return to — leaving a THIRD accidental Enter
  // free to re-click it again. Both the table and card ornament views
  // render every row at once (CSS `display` toggles which is visible per
  // breakpoint — see their own JSX comments), so this picks whichever
  // instance of the newest row's own input is actually laid out
  // (offsetParent !== null), same visibility check enterToSubmit.ts's own
  // focusable-list building already uses.
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
    // Weight/qty can never go negative, however the value arrives (native
    // spinner decrement past 0, typed "-", pasted value, etc.) — clamp here
    // centrally rather than trusting each call site.
    const clamped = (k === "w" || k === "lessWt" || k === "q") && typeof v === "number" ? (Math.max(0, v) as OrnRow[K]) : v;
    setRows((rs) => rs.map((r, idx) => {
      if (idx !== i) return r;
      // Net Wt is directly editable — editing it derives Less Wt instead
      // (Gross Wt never changes as a side effect of editing Net/Less Wt).
      // Clamped to [0, Gross Wt], mirroring the submit-time guard that Less
      // Wt can't exceed Gross Wt.
      if (k === "netW" && typeof v === "number") {
        const netW = Math.min(Math.max(0, v), r.w);
        return { ...r, netW, lessWt: Math.max(0, r.w - netW) };
      }
      const next = { ...r, [k]: clamped };
      // Gross Wt/Less Wt are the two inputs that drive Net Wt — any change
      // to either recomputes it here.
      if (k === "w" || k === "lessWt") next.netW = Math.max(0, next.w - next.lessWt);
      return next;
    }));
  }

  // Gets the row's photo from PhotoSourceMenu — a file from the system or
  // a webcam shot, both arrive as a File.
  async function ornImgPicked(i: number, f: File) {
    if (!f.type.startsWith("image/")) { toast("Please choose an image file"); return; }
    try {
      const url = await uploadFile(f);
      setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, img: url, imgName: f.name } : r)));
    } catch {
      toast("Could not upload photo — try again");
    }
  }
  function delOrnImg(i: number) {
    setRows((rs) => rs.map((r, idx) => {
      if (idx !== i) return r;
      const { img, imgName, ...rest } = r;
      void img; void imgName;
      return rest as OrnRow;
    }));
  }
  // One photo button per row: opens "Upload from system" / "Take photo
  // (webcam)". Each view (table + cards) mounts its own, each owning its own
  // hidden file input, so there's no shared per-row input ref to race on.
  function ornPhotoMenu(i: number, content: React.ReactNode, title: string, style: React.CSSProperties) {
    return (
      <PhotoSourceMenu
        onFile={(f) => { void ornImgPicked(i, f); }}
        webcamTitle={`Ornament Photo${rows[i]?.n ? " — " + rows[i].n : ""}`}
        trigger={(t) => (
          <button ref={t.ref} type="button" className="btn plain sm" style={style} title={title} aria-haspopup="menu" aria-expanded={t.open} onClick={t.toggle}>{content}</button>
        )}
      />
    );
  }
  function viewOrnImg(i: number) {
    const r = rows[i];
    openModal(
      <>
        <div className="hd"><h3>{r.n}{r.imgName ? " — " + r.imgName : ""}</h3><button className="x" onClick={closeModal}>×</button></div>
        <div className="bd" style={{ textAlign: "center" }}><SafeImage src={r.img} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt={r.n} /></div>
      </>,
      true
    );
  }

  /* --- "Save Draft" -------------------------------------------------------
   *
   * Persists the form as-is to /loans/drafts (backend LoanDraft) so a
   * half-entered loan survives leaving this page — previously this button
   * only raised a "Draft saved (demo)" toast and threw the form away.
   *
   * Deliberately saves whatever is on screen, with no validation beyond a
   * branch: the entire point is to keep an incomplete form, including rows
   * with no weight yet or no customer picked. The real rules still apply at
   * "Submit for Approval". */
  function buildDraftInput(): SaveDraftInput {
    return {
      branchId: Number(branchId),
      ...(custId ? { customerId: Number(custId) } : {}),
      ...(schemeId ? { schemeId: Number(schemeId) } : {}),
      ...(lockerId !== "" ? { lockerId: Number(lockerId) } : {}),
      // Only a genuine manual override is stored — an empty field means "use
      // the eligible amount", which must stay computed rather than frozen
      // (a draft reopened next week has to use next week's gold rate).
      ...(principalOverride.trim() ? { principalOverride: +principalOverride } : {}),
      // Every row is sent, including blank ones, so the form comes back
      // looking exactly as it was left.
      ornaments: rows.map((r) => ({
        name: r.n,
        purity: r.p,
        grossWeight: r.w,
        quantity: r.q,
        ...(r.img ? { imageUrl: r.img } : {}),
        ...(r.imgName ? { imageName: r.imgName } : {}),
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
    // A draft with nothing entered would just be an empty row in "Saved
    // drafts". Blank ornament rows (just added, nothing typed) don't count.
    const hasOrnamentDetail = rows.some((r) => r.n.trim() || r.w > 0 || r.img);
    if (!custId && !schemeId && lockerId === "" && !hasOrnamentDetail) {
      toast("Enter some loan details before saving a draft");
      return;
    }
    setSavingDraft(true);
    try {
      const input = buildDraftInput();
      if (draftId) await updateDraft(draftId, input); else await saveDraft(input);
      await loadDrafts();
      toast(draftId ? "Draft updated" : "Draft saved — reopen it from “Saved drafts” below");
      // The draft is safely stored, so hand back a blank form — otherwise
      // draftId stays set and every later "Save Draft" just overwrites this
      // one, leaving no way to start another draft short of a page refresh.
      resetForm();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save draft — try again");
    } finally {
      setSavingDraft(false);
    }
  }

  // Returns the form to its freshly-loaded state. Branch is kept — it's
  // preset on load (and locked for non-admins), not something staff pick per loan.
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
    setPrincipalOverride("");
    setPrincipalExceedsEligible(false);
    setAdditionalInfo("");
    setChargeMode("WithheldFromPayout");
  }

  // Reopens a saved draft into the form. Labels for the pickers come from the
  // draft's preloaded customer/scheme/branch (the backend sends them for
  // exactly this reason); the locker label has no equivalent preload, so it's
  // looked up by id directly (searchLockersPage no longer keeps a full
  // in-memory list around to search for it).
  function applyDraft(d: BackendLoanDraft) {
    setDraftId(d.id);
    setCustId(d.customerId ? String(d.customerId) : "");
    setCustLabel(d.customer ? `${d.customer.name} (${d.customer.code})` : "");
    setSchemeId(d.schemeId ? String(d.schemeId) : "");
    setSchemeObj(null); // draft carries only a label — fall back to the schemes list lookup
    setSchemeLabel(d.scheme ? d.scheme.name : "");
    setBranchId(d.branchId);
    setBranchLabel(d.branch?.name || "");
    setLockerId(d.lockerId ?? "");
    setLockerLabel("");
    if (d.lockerId) {
      getLocker(d.lockerId)
        .then((k) => setLockerLabel(lockerLabelOf(k)))
        .catch(() => {/* locker may have since been deleted — leave the label blank */});
    }
    setRows(d.ornaments.map((o) => ({
      n: o.name,
      p: o.purity || "22K",
      w: o.grossWeight,
      // Drafts are unvalidated scratch state and don't persist the Gross/
      // Less Wt distinction (see SaveDraftInput/BackendLoanDraft — no
      // deductionWeight field) — reopening one assumes no deduction was
      // recorded yet, same as this form's own default for a brand-new row.
      lessWt: 0,
      netW: o.grossWeight,
      q: o.quantity,
      ...(o.imageUrl ? { img: o.imageUrl } : {}),
      ...(o.imageName ? { imgName: o.imageName } : {}),
    })));
    // Restoring rows changes the eligible amount, which normally clears a
    // stale manual override (see the effect on roundedEligible). Here the
    // override arrived WITH those rows, so suppress that one reset — without
    // this, reopening a draft silently drops its saved loan amount.
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
          // Less Wt is now the direct input (netW is only ever derived
          // client-side for display) — sent straight through as
          // deductionWeight; the backend re-derives NetWeight from it the
          // same way (GrossWeight − DeductionWeight).
          deductionWeight: r.lessWt,
          quantity: r.q,
        })),
        ...(lockerId !== "" ? { lockerId: Number(lockerId) } : {}),
        // Hands the backend the draft this loan came from, so it's discarded
        // now that a real loan exists (fail-soft server-side — see
        // Service.DeleteDraftQuietly).
        ...(draftId ? { draftId } : {}),
        ...(additionalInfo.trim() ? { additionalInfo: additionalInfo.trim() } : {}),
        ...(sch && sch.serviceChargeType !== "None" ? { serviceChargeMode: chargeMode } : {}),
      });

      // The backend creates + returns ornaments in the same order they were
      // submitted (internal/loan/service.go's Create, then
      // OrnamentRepository.FindByLoanID's "order by id asc") — safe to zip
      // validRows with loan.ornaments by array index.
      const createdOrnaments = loan.ornaments || [];
      await Promise.all(
        validRows.map((r, i) => {
          const created = createdOrnaments[i];
          if (r.img && created) return addOrnamentImage(created.id, r.img);
          return Promise.resolve();
        })
      );

      // The draft (if any) was consumed server-side by the create call above.
      setDraftId(null);
      void loadDrafts();

      refresh();
      refreshLoans();
      // Loan sanction always has at least one stage switched on, so every
      // new loan enters the chain — name the stage it is now waiting at (the
      // first enabled one, read back from the created loan).
      const firstStage = stageByPending(workflow, "loan_sanction", loan.approvalStage);
      toast(`Loan ${loan.loanNumber} submitted for approval${firstStage ? ` — awaiting ${firstStage.label}` : ""}`);
      navigate("loan/" + loan.loanNumber);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not submit loan — try again");
    } finally {
      setSubmitting(false);
    }
  }

  // The backend already 403s a POST /loans without "can change loan" — the
  // page-level route guard (app/(product)/app/page.tsx's ROUTE_PERMISSIONS) already
  // blocks direct navigation to #newloan, this is a defensive second check
  // in case this component is ever rendered another way.
  if (!can("Loan_Management", "can_create_loan")) {
    return (
      <div className="empty">
        You don&apos;t have permission to create a loan. Contact a Loan Operator, Branch Manager, or Administrator.
      </div>
    );
  }

  return (
    /* display:contents keeps this key handler in the DOM (keydown still
     * bubbles up from the form fields inside) without it becoming the sole
     * flex item of `.page` (display:flex;flex-direction:column) — wrapping
     * every child in one extra box here, unlike every other page whose
     * .page-h/.gold-rule/etc. sit directly under .page, was pushing this
     * page's title row out of alignment with the rest. */
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
      {/* .cols21's shared 2fr:1fr ratio (app.css) is used by three other
       * pages too (Packets/PacketDetail/Calendar) — this inline override,
       * scoped to just this page's own grid instance, gives the ornament
       * form more room (and the Valuation sidebar correspondingly less)
       * without changing that shared class for the other three. */}
      <div className="grid cols21 newloan-orn-grid" style={{ gridTemplateColumns: "minmax(0, 2.34fr) minmax(0, 0.9fr)" }}>
        {/* orn-form-card opts this card into a container query (app.css)
         * that switches the ornament table to the card view based on this
         * card's own rendered width, not the browser window's — the table
         * needs ~880px+padding to lay out without overlap (see its own
         * minWidth comment below), but this card sits beside a fixed-width
         * Valuation sidebar, so at plenty of ordinary desktop window widths
         * (1366px, ~1700px — both narrower than the old flat 1350px
         * *window*-width breakpoint's threshold in the direction that
         * matters) its own actual column was still narrower than that,
         * overflowing the Photo/Upload column out past the card's edge and
         * over the sidebar instead of ever falling back to the card view
         * meant to handle exactly this. */}
        <div className="card gtop orn-form-card"><div className="bd">
          <div className="frow c2">
            <div><label className="f">Customer</label>
              <SearchableSelect<CustomerView>
                value={custLabel}
                onChange={(id, item) => { setCustId(id); setCustLabel(`${item.name} (${item.code})`); applyCustomerBranch(item); }}
                fetchFn={searchCustomersPage}
                searchHint="Searches: customer name, customer code, phone"
                getLabel={(c) => `${c.name} (${c.code})`}
                /* Rendered as "Name (CUST-4)" plus a "Verified" badge, and
                 * nothing at all for part/unverified customers — the flat
                 * "(Unverified)"/"(Part Verified)" suffix this label used to
                 * carry was requested gone, with the badge alone as the
                 * positive marker. Nothing about eligibility changes — the
                 * backend still refuses a loan for an unverified customer
                 * on submit; it just isn't spelled out in the picker row. */
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
          <div className={showBranch ? "frow c2" : "frow"}>
            {showBranch && <div><label className="f">Branch</label>
              {/* Locked unless there's a real choice: only cross-branch roles
                  (Administrator, Management) may pick — the backend pins
                  everyone else to their own branch (EnforceBranchOnWrite) —
                  and only when more than one active branch exists. */}
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
            <div><label className="f">Locker / Storage</label>
              {/* key={branchId}: SearchableSelect caches results per search
                * term, so without remounting it kept showing the previous
                * branch's lockers after the branch changed. */}
              <SearchableSelect<LockerView>
                key={branchId}
                value={lockerLabel}
                onChange={(id, item) => { setLockerId(+id); setLockerLabel(lockerLabelOf(item)); }}
                fetchFn={searchLockers}
                searchHint="Searches: locker code"
                getLabel={lockerLabelOf}
                getId={(k) => String(k.id)}
                placeholder="— Assign later — or search locker…"
              /></div>
          </div>
          <div className="frow c2">
            <div><label className="f">Loan No (auto)</label><input className="inp" value={provId} disabled /></div>
            <div><label className="f">Loan Date</label><DatePicker value={openedDate} onChange={setOpenedDate} max={localISO(new Date())} /></div>
          </div>
          <label className="f" style={{ marginTop: 6 }}>Pledged Ornaments</label>
          {/* Deliberately NOT wrapped in .tbl-wrap (unlike other tables) — that
              class sets overflow-x:auto, and per the CSS overflow spec,
              setting either overflow axis to a value other than visible
              forces the other axis to compute as auto too. That turned this
              box into an unwanted vertical scroll container and clipped the
              ornament-type SearchableSelect's dropdown, which pops out of
              its input via position:absolute. A plain div (no overflow
              rule) avoids both; the page itself scrolls horizontally on
              very narrow viewports instead.

              table-layout:fixed + percentage <col> widths below (instead of
              each cell hard-coding its own px width) is what makes every
              column shrink together, proportionally, as this wrapper's
              track (`.grid.cols21`'s left column is `minmax(0,2fr)`, so it
              can go narrower than the row's natural content width — see
              that rule's comment) narrows on small/medium screens. With
              per-cell px widths the auto layout algorithm let the flexible
              PurityPicker search field absorb almost all of the squeeze
              while fixed-width cells (Net Wt/Qty/Photo) stayed put — so on a
              narrow screen that one field got crushed to a few px and
              became untypable. Fixed layout instead divides *any* available
              width by these ratios up front, so no single column bears the
              whole squeeze. Net Wt/Qty's own inputs are floored at 70px
              (see those <input>s' minWidth below) — narrower than the
              column's own % share and the whole table's rendered width
              simply grows past 100% to give them that floor (the same
              mechanism a plain min-width on any descendant uses to push an
              ancestor wider), and .page (whose overflow-y:auto computes
              overflow-x to auto too) scrolls it horizontally instead of
              anything clipping or drifting out of alignment with its own
              header. */}
          {/* Two renderings of the same `rows` state, toggled by a
              dedicated 1350px breakpoint (app.css) via CSS display only —
              not a JS resize listener, matching how `.side`/`.burger`
              already switch layouts in this app (those use the app's usual
              900px breakpoint; this table needed its own wider one — see
              app.css's comment above `.orn-cards-view`). `.orn-table-view`
              is hidden below 1350px, `.orn-cards-view` shown instead. Each
              view's photo button is its own ornPhotoMenu (with its own
              hidden file input), both writing to the same `rows` entry. */}
          {/* minWidth:900 is a real, computed floor — not an organic
              "however wide the content happens to need" guess. Purity's
              own column (22%) is the binding constraint: its content needs
              at least ~176px (the toggle's own 130px floor + 6px row gap +
              the search field's 34px floor + ~6px cell padding), comfortably
              inside 22% of 900px (198px). table-layout:fixed does NOT
              reallocate a tight column's shortfall from another column's
              slack, so these 8 <col> percentages are kept summing to
              exactly 100 (not left to silently normalize down) — a sum
              over 100 shrinks EVERY column's real rendered share,
              including Purity's, which is exactly what caused it to clip
              against Gross/Net Wt after those two were last widened.
              Below this width Purity's content no longer fits its own
              <td> and spills into the column beside it instead of the
              table falling back to .page's horizontal scroll the way it's
              meant to. Ornament's own 13% is a deliberate, modest ~20%
              bump over its original 11% (not the much larger jump a
              previous pass tried, which — combined with a much wider
              container it also needed — pushed this whole card past the
              width `.grid.cols21`'s left column actually had to give it;
              see that grid's own inline style override in this page for
              the complementary fix on that side instead), taken from
              Photo's share (13%→11%) — safe since Photo's content is now
              just a single 31px icon button in the common case, not the
              old "📷 Upload" text label it used to need room for. */}
          <div className="orn-table-view" style={{ width: "100%", minWidth: 900, paddingBottom: 6 }}><table className="tbl orn-table" style={{ width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: "7%" }} />
              {/* Purity needs real room for its Karat/Fineness toggle
               * plus the number field beside it — it can't be squeezed
               * to the same width as the plain number columns without
               * clipping (see the width-budget note further up). */}
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
                  {/* height:31 matches the Purity/weight/Qty cells beside it */}
                  <td className="orn-type-td">
                    <SearchableSelect<BackendOrnamentType>
                      value={r.n}
                      onChange={(_id, item) => updOrn(i, "n", item.name)}
                      fetchFn={searchOrnamentTypesPage}
                      searchHint="Searches: ornament type name"
                      getLabel={(t) => t.name}
                      getId={(t) => String(t.id)}
                      placeholder="Ornament type…"
                      allowCreate
                      onCreate={createOrnamentType}
                    />
                  </td>
                  <td style={{ paddingRight: 4 }}><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 32, height: 31, textAlign: "center", boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} placeholder="Qty" value={r.q === 0 ? "" : r.q} onChange={(e) => updOrn(i, "q", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td style={{ paddingLeft: 4, paddingRight: 0 }}><PurityPicker value={r.p} onChange={(v) => updOrn(i, "p", v)} dropdownMinWidth={0} /></td>
                  <td className="num" style={{ paddingLeft: 2, paddingRight: 8 }}><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 68, height: 31, textAlign: "right", boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} placeholder="0.0gm" value={r.w === 0 ? "" : r.w} onChange={(e) => updOrn(i, "w", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td className="num" style={{ paddingLeft: 8, paddingRight: 8 }}><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 68, height: 31, textAlign: "right", boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} max={r.w || undefined} placeholder="0.0gm" value={r.lessWt === 0 ? "" : r.lessWt} onChange={(e) => updOrn(i, "lessWt", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  {/* Net Wt is directly editable — editing it derives Less
                      Wt instead (see updOrn); Gross Wt never changes as a
                      side effect. */}
                  <td className="num" style={{ paddingLeft: 8, paddingRight: 8 }}><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 68, height: 31, textAlign: "right", boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} max={r.w || undefined} placeholder="0.0gm" value={r.netW === 0 ? "" : r.netW} onChange={(e) => updOrn(i, "netW", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td style={{ textAlign: "left", whiteSpace: "nowrap", paddingLeft: 8, paddingRight: 2 }}>
                    {r.img ? (
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center", justifyContent: "flex-start" }}>
                        <SafeImage src={r.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title="View photo" onClick={() => viewOrnImg(i)} />
                        {ornPhotoMenu(i, "↺", "Replace photo", { padding: "0 7px", height: 31 })}
                        <button className="btn plain sm" style={{ padding: "0 7px", height: 31 }} title="Remove photo" onClick={() => delOrnImg(i)}>✕</button>
                      </div>
                    ) : (
                      ornPhotoMenu(i, <Icon name="camera" />, "Add ornament photo", { padding: 0, width: 31, height: 31, display: "inline-flex", alignItems: "center", justifyContent: "center" })
                    )}
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
                  {/* orn-type-td (app.css) shrinks this field's own input to
                      31px tall — the same height every other field in this
                      card (Net Wt/Qty/Purity below, and the ✕ button beside
                      it) already uses — instead of the SearchableSelect's
                      default 40px, which made the ✕ button read as an odd
                      size next to it despite being the exact 31×31 every
                      other row/card control is pinned to. */}
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
                      allowCreate
                      onCreate={createOrnamentType}
                    />
                  </div>
                  {/* Qty sits right beside Ornament (not down with the
                      weight fields) to match the table view's column order. */}
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
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} placeholder="0.00 " value={r.w === 0 ? "" : r.w} onChange={(e) => updOrn(i, "w", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label className="f">Less Wt (g)</label>
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} max={r.w || undefined} placeholder="0.00 " value={r.lessWt === 0 ? "" : r.lessWt} onChange={(e) => updOrn(i, "lessWt", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label className="f">Net Wt (g)</label>
                    {/* Editable — editing derives Less Wt instead, see updOrn. */}
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} type="number" onWheel={blurOnWheel} min={0} max={r.w || undefined} placeholder="0.00 " value={r.netW === 0 ? "" : r.netW} onChange={(e) => updOrn(i, "netW", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} />
                  </div>
                </div>
                <div className="orn-card-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Photo</span>
                  {r.img ? (
                    <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <SafeImage src={r.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title="View photo" onClick={() => viewOrnImg(i)} />
                      {ornPhotoMenu(i, "↺", "Replace photo", { padding: "0 7px", height: 31 })}
                      <button className="btn plain sm" style={{ padding: "0 7px", height: 31 }} title="Remove photo" onClick={() => delOrnImg(i)}>✕</button>
                    </div>
                  ) : (
                    ornPhotoMenu(i, <Icon name="camera" />, "Add ornament photo", { padding: 0, width: 31, height: 31, display: "inline-flex", alignItems: "center", justifyContent: "center" })
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* tabIndex only while there are zero ornaments — otherwise
              there'd be NOTHING in this whole section for Enter to land
              on at all (the row fields below only exist once at least one
              row does), leaving no keyboard-only way to ever create the
              first one. Deliberately NOT marked `data-enter-waypoint`
              (unlike Select.tsx's own trigger) — adding an ornament has no
              natural "done" signal the way picking a dropdown option
              does, so pass-through treatment here would just re-trigger
              it forever instead of ever letting a real click through.
              Once rows.length > 0, tabIndex={-1} removes it from the
              Enter chain entirely, so Enter from the last row's Qty field
              goes straight to Loan Amount below instead of detouring back
              here — adding another ornament from then on is a deliberate
              mouse click. */}
          <button className="btn plain sm" style={{ marginTop: 10 }} tabIndex={rows.length === 0 ? 0 : -1} onClick={() => addOrnRow()}><Icon name="plus" /> Add Ornament</button>
        </div>
          <div className="ft" style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", padding: "14px 18px" }}>
            {/* Slip/Label and Pledge Agreement print/download were removed
              * from here — a loan is still provisional at this point (not
              * yet saved/approved), so printing its documents before
              * submission served no purpose and only encouraged staff to
              * hand out paperwork for a loan that might still change during
              * approval. The same documents remain available from
              * LoanDetail.tsx once the loan is saved. */}
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
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Total net weight</span><b>{totalWeight.toFixed(1)} g</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Gross gold value</span><b>{fmt(totalGross)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Scheme LTV</span><b>{sch ? sch.ltv + "%" : "—"}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                <span>Eligible gold amount</span><b>{fmt(eligible)}</b></div>
              {/* Option 4 layout: charge rows first, then the one editable
                  Amount, then Principal / Disbursed as the headline figures. */}
              {(() => {
                const hasCharge = !!sch;
                const amount = +principalOverride || 0;
                const charge = !sch || sch.serviceChargeType === "None" ? 0 : sch.serviceChargeType === "Flat" ? sch.serviceChargeValue : (amount * sch.serviceChargeValue) / 100;
                const withheld = chargeMode === "WithheldFromPayout";
                // AddedToPrincipal: the charge rides on top of the amount the
                // customer receives; WithheldFromPayout: it comes off it.
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
                        inputMode="numeric"
                        autoComplete="off"
                        // principalOverride is prefilled to the eligible amount
                        // (see the roundedEligible effect above) rather than
                        // left empty, so this displays whatever's stored —
                        // including genuinely empty while staff are mid-edit.
                        value={principalOverride ? (+principalOverride).toLocaleString("en-IN") : ""}
                        onChange={(e) => {
                          const el = e.target;
                          // Digits left of the caret, so the caret can be put
                          // back after the same digit once the value is
                          // re-grouped — otherwise it jumps to the end and
                          // mid-number edits are impossible.
                          const digitsLeft = el.value.slice(0, el.selectionStart ?? el.value.length).replace(/\D/g, "").length;
                          const clean = el.value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
                          const num = clean === "" ? 0 : +clean;
                          // maxPrincipalEntry (the eligible amount) is a hard
                          // ceiling — clamp what's stored so the field never
                          // shows a figure the server would reject, and show
                          // the clamp as inline feedback.
                          if (num > maxPrincipalEntry) {
                            setPrincipalOverride(String(maxPrincipalEntry));
                            setPrincipalExceedsEligible(true);
                          } else {
                            setPrincipalOverride(clean);
                            setPrincipalExceedsEligible(false);
                          }
                          requestAnimationFrame(() => {
                            let pos = 0, seen = 0;
                            while (pos < el.value.length && seen < digitsLeft) { if (/\d/.test(el.value[pos])) seen++; pos++; }
                            el.setSelectionRange(pos, pos);
                          });
                        }}
                        style={{ flex: "0 0 120px", minWidth: 0, padding: "3px 8px", textAlign: "right", fontWeight: 600, color: "var(--brand-deep)", fontSize: 13.5 }}
                      />
                    </div>
                    {principalExceedsEligible && (
                      <p style={{ color: "var(--red)", fontSize: 12, margin: "0 0 4px", textAlign: "right" }}>
                        Amount can&apos;t exceed {fmt(roundedEligible)}.
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
            <div className="ft">Uses today&apos;s published rates (22K {fmt(rates.k22)}/g) — defaults to the eligible amount, and can be reduced but not increased beyond it</div></div>
          {/* Saved drafts. Only rendered when there are any — an empty card
              on every visit would be noise on a page staff use constantly.
              Drafts are this employee's own (scoped server-side from the
              JWT), so this is a personal work-in-progress list, not a
              branch queue. */}
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
                    <button className="btn danger sm" title="Discard draft" onClick={() => discardDraft(d.id)}>✕</button>
                  </div>
                ))}
              </div>
              <div className="ft">Opening a draft replaces whatever is currently in the form above.</div>
            </div>
          )}
          {/* <div className="notice"><Icon name="shield" /> Every loan is verified by the Loan Operator, approved by the Branch Manager, then finally sanctioned by Management.</div> */}
        </div>
      </div>
    </div>
  );
}
