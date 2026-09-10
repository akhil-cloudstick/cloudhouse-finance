"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { useData } from "@/common/DataProvider";
import { useCustomers } from "@/modules/customers/store/CustomersProvider";
import { useSchemes } from "@/modules/schemes/store/SchemesProvider";
import { useLoans } from "@/modules/loans/store/LoansProvider";
import { useGoldRates } from "@/modules/gold-rates/store/GoldRatesProvider";
import { useModal } from "@/common/components/Modal";
import { useToast } from "@/common/components/Toast";
import { useAuth } from "@/common/auth-context";
import { Icon } from "@/common/components/Icon";
import { fmt, custOf, schemeOf } from "@/common/utils/format";
import { appPath } from "@/common/services/tenantSession";
import { uploadFile, searchCustomersPage, getCustomerAadhaarFull, type CustomerView } from "@/modules/customers/services/customerService";
import { VerifiedBadge } from "@/modules/customers/components/VerifiedBadge";
import { searchActiveSchemesPage, type SchemeView } from "@/modules/schemes/services/schemeService";
import { searchOrnamentTypesPage, createOrnamentType, type BackendOrnamentType } from "@/modules/ornament-types/services/ornamentTypeService";
import {
  createLoan,
  addOrnamentImage,
  saveDraft,
  updateDraft,
  listDrafts,
  deleteDraft,
  type BackendLoanDraft,
  type SaveDraftInput,
} from "@/modules/loans/services/loanService";
import { listPackets } from "@/modules/packets/services/packetService";
import { publishGoldRate } from "@/modules/gold-rates/services/goldRateService";
import { listActiveBranches, type BranchView } from "@/modules/branches/services/branchService";
import { listLockers, type LockerView } from "@/modules/lockers/services/lockerService";
import { SearchableSelect } from "@/common/components/ui/SearchableSelect";
import { StatusChip } from "@/common/components/ui/StatusChip";
import { PurityPicker } from "@/common/components/ui/PurityPicker";
import { rateForPurityString } from "@/common/utils/purity";
import { makeEnterToSubmitHandler } from "@/common/utils/enterToSubmit";
import { openPrintWindow, brandHeader } from "@/common/utils/print";
import { BRAND, printColors } from "@/common/config/brand";
import { printIndemnityBond, bondLangOptionsFor, type BondLang } from "@/modules/loans/utils/indemnityBond";
import { useBranding } from "@/common/BrandingProvider";
import { ApiError } from "@/common/services/httpClient";
import type { Ornament } from "@/common/utils/data";


// Purity is now a plain unit-suffixed string ("22K" / "91.6%", see
// lib/purity.ts) rather than a fixed k24/k22/k18 bucket — PURITY_LABEL is
// gone since the string itself is already the display label.
//
// `w` (Gross Wt) and `netW` (Net Wt) are two INDEPENDENT inputs, not one
// derived from the other — matching how an ornament is actually assessed:
// gross is a raw scale reading (includes stones/dust/impurity), net is the
// separately assessed pure-gold weight a jeweler determines. Loan value is
// calculated off net weight, never gross — see rowVals below. `deductionWeight`
// sent to the backend (Ornament.DeductionWeight) is derived as `w − netW`
// at submit time; the backend re-derives NetWeight from that same subtraction,
// so the two stay in agreement without the frontend needing to send NetWeight
// directly.
type OrnRow = { n: string; p: string; w: number; netW: number; q: number; img?: string; imgName?: string };

/* Ported from legacy/app.js's `renderNewLoan()` (legacy/app.js:845-1151).
 * Customer/scheme/ornament-type pickers now hit the real backend search
 * endpoints (via SearchableSelect) instead of filtering an in-memory mock
 * list or a localStorage-backed type list. */
export function NewLoan() {
  const { isAdmin, can } = useAuth();
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
  const provId = useMemo(() => "LN-" + String(loans.length + 1).padStart(5, "0"), [loans.length]);

  // Lockers are backend-managed (see lockerApi.ts / LockerModal.tsx). Picking
  // one here checks the loan's auto-created packet straight into it at
  // creation (see submitNewLoan's `lockerId` on createLoan()) instead of
  // requiring a separate manual "check in to locker" step afterward on the
  // Packets page — leaving it on "Assign later" keeps the old manual flow.
  const [lockers, setLockers] = useState<LockerView[]>([]);
  const activeLockers = lockers.filter((k) => k.isActive);

  // Deliberately NOT defaulted to the first verified customer/active scheme — the
  // SearchableSelect fields below start blank (custLabel/schemeLabel === "")
  // to match, so staff must actively pick from the dropdown. Defaulting
  // custId to the first verified customer while its label stayed blank used
  // to let a loan submit against that hidden default without anyone ever
  // selecting a customer.
  const [custId, setCustId] = useState("");
  const [custLabel, setCustLabel] = useState("");
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
  // sanctioning less than the max eligible). Empty string means "use the
  // eligible amount" — the field is re-blanked whenever the eligible amount
  // itself changes so a stale manual figure never silently outlives the
  // ornaments/scheme it was computed against.
  const [principalOverride, setPrincipalOverride] = useState("");
  // Free text staff may want to record on this loan that no standard field
  // captures — carried through onto the printed Statement of Account.
  const [additionalInfo, setAdditionalInfo] = useState("");
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

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
  // Real Packet.Code, fetched right after loan creation succeeds (the
  // backend auto-creates the loan's tracking packet — see
  // loan.PacketCreator) — printPacketLabel() prefers this over the
  // provisional provId-based URL once it's known.
  const [createdPacketCode, setCreatedPacketCode] = useState<string | null>(null);
  const [bondLang, setBondLang] = useState<BondLang>("en");
  // Only the languages this business was granted; English always survives.
  const bondLangOptions = bondLangOptionsFor(useBranding().languages);
  const [bondMenuOpen, setBondMenuOpen] = useState(false);
  const bondMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!bondMenuOpen) return;
    function onDocClick(e: MouseEvent) {
      if (!bondMenuRef.current?.contains(e.target as Node)) setBondMenuOpen(false);
    }
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [bondMenuOpen]);

  useEffect(() => {
    listActiveBranches()
      .then((list) => {
        setBranches(list);
        if (list.length) {
          setBranchId((cur) => (cur === "" ? list[0].id : cur));
          setBranchLabel((cur) => (cur === "" ? list[0].name : cur));
        }
      })
      .catch(() => toast("Could not load branches — try again later."));
    listLockers()
      .then(setLockers)
      .catch(() => toast("Could not load lockers — try again later."));
    // This staff member's own saved drafts, so an interrupted loan can be
    // picked back up (see the "Saved drafts" card below).
    void loadDrafts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Branch/locker are short, already-loaded lists (not paginated backend
  // searches like customers/schemes/ornament types), so these just filter
  // the in-memory list client-side — but they're plugged into the same
  // SearchableSelect component so Branch/Locker share its themed dropdown
  // instead of a native <select>'s unstyled browser popup.
  async function searchBranchesLocal(q: string, _page: number): Promise<{ items: BranchView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    const items = query ? branches.filter((b) => b.name.toLowerCase().includes(query)) : branches;
    return { items, hasMore: false };
  }

  async function searchLockersLocal(q: string, _page: number): Promise<{ items: LockerView[]; hasMore: boolean }> {
    const query = q.trim().toLowerCase();
    // Full lockers were previously shown but disabled (unclickable) — since
    // SearchableSelect rows are always clickable, they're excluded outright
    // instead, matching the same "can't pick a full locker" behavior.
    const available = activeLockers.filter((k) => k.occupied < k.capacity);
    const items = query
      ? available.filter((k) => `${k.code} ${k.branchName}`.toLowerCase().includes(query))
      : available;
    return { items, hasMore: false };
  }

  const sch = (schemeObj && schemeObj.id === schemeId) ? schemeObj : schemes.find((s) => s.id === schemeId);

  const rowVals = rows.map((r) => r.netW * r.q * (rateForPurityString(rates.k24, r.p) ?? 0));
  const totalWeight = rows.reduce((s, r) => s + r.netW * r.q, 0);
  const totalGross = rowVals.reduce((s, v) => s + v, 0);
  const eligible = sch ? (totalGross * sch.ltv) / 100 : 0;
  const principal = principalOverride.trim() ? Math.max(0, +principalOverride) : Math.round(eligible);

  // Clear a stale manual override whenever the eligible amount it was based
  // on changes (ornaments edited, scheme swapped, rates refreshed) — the
  // field falls back to showing the new eligible amount as a placeholder
  // rather than silently keeping an amount computed against different gold.
  const roundedEligible = Math.round(eligible);
  // Set when a saved draft is being applied: that draft's own override
  // arrived together with its ornaments, so it is not stale and must survive
  // the reset this effect would otherwise perform. See applyDraft().
  const skipOverrideResetRef = useRef(false);
  useEffect(() => {
    if (skipOverrideResetRef.current) {
      skipOverrideResetRef.current = false;
      return;
    }
    setPrincipalOverride("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundedEligible]);

  function addOrnRow(pre?: OrnRow) {
    // Ornament type starts blank — it must be explicitly picked (or created)
    // via the SearchableSelect below, never silently defaulted.
    setRows((rs) => [...rs, pre || { n: "", p: "22K", w: 0, netW: 0, q: 1 }]);
  }
  function delOrnRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }
  function updOrn<K extends keyof OrnRow>(i: number, k: K, v: OrnRow[K]) {
    // Weight/qty can never go negative, however the value arrives (native
    // spinner decrement past 0, typed "-", pasted value, etc.) — clamp here
    // centrally rather than trusting each call site.
    const clamped = (k === "w" || k === "netW" || k === "q") && typeof v === "number" ? (Math.max(0, v) as OrnRow[K]) : v;
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: clamped } : r)));
  }

  async function ornImgPicked(i: number, input: HTMLInputElement) {
    const f = input.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("Please choose an image file"); input.value = ""; return; }
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
  function viewOrnImg(i: number) {
    const r = rows[i];
    openModal(
      <>
        <div className="hd"><h3>{r.n}{r.imgName ? " — " + r.imgName : ""}</h3><button className="x" onClick={closeModal}>×</button></div>
        <div className="bd" style={{ textAlign: "center" }}><img src={r.img} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt={r.n} /></div>
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
    setSavingDraft(true);
    try {
      const input = buildDraftInput();
      const saved = draftId ? await updateDraft(draftId, input) : await saveDraft(input);
      setDraftId(saved.id);
      await loadDrafts();
      toast(draftId ? "Draft updated" : "Draft saved — reopen it from “Saved drafts” below");
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Could not save draft — try again");
    } finally {
      setSavingDraft(false);
    }
  }

  // Reopens a saved draft into the form. Labels for the pickers come from the
  // draft's preloaded customer/scheme/branch (the backend sends them for
  // exactly this reason); the locker label is resolved from the already-loaded
  // locker list, which has no equivalent preload.
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
    const k = d.lockerId ? lockers.find((x) => x.id === d.lockerId) : undefined;
    setLockerLabel(k ? `${k.code} — ${k.branchName} (${k.occupied}/${k.capacity} packets)` : "");
    setRows(d.ornaments.map((o) => ({
      n: o.name,
      p: o.purity || "22K",
      w: o.grossWeight,
      // Drafts are unvalidated scratch state and don't persist the Gross/Net
      // distinction (see SaveDraftInput/BackendLoanDraft — no deductionWeight
      // field) — reopening one assumes no deduction was recorded yet, same as
      // this form's own default for a brand-new row.
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

  // TODO: buildDraft()/print* functions build their own Ornament shape
  // straight from `rows` (not from any backend response), so they stay
  // consistent even though submitNewLoan() now posts to the real loan API —
  // no rewrite needed here, but note this if createLoan()'s ornament shape
  // ever changes and rows are adjusted to match it more closely.
  function buildDraft() {
    const c = custOf(customers, custId);
    const s = (schemeObj && schemeObj.id === schemeId) ? schemeObj : schemeOf(schemes, schemeId);
    let weight = 0, gross = 0;
    const orns: Ornament[] = rows.filter((r) => r.w > 0 && r.q > 0).map((r) => {
      const v = r.netW * r.q * (rateForPurityString(rates.k24, r.p) ?? 0);
      weight += r.netW * r.q; gross += v;
      return { n: r.n, purity: r.p, gross: r.w, net: r.netW, qty: r.q, val: Math.round(v), img: r.img };
    });
    const locker = lockers.find((k) => k.id === lockerId);
    return { c, sch: s, orns, weight, gross, eligible: Math.round((gross * s.ltv) / 100), locker };
  }

  function printPledgeSlip() {
    const d = buildDraft();
    if (!d.orns.length) { toast("Add at least one ornament with weight and qty first"); return; }
    openPrintWindow("Pledge Slip — " + provId, `
      ${brandHeader("Gold Loan Pledge Slip")}
      <table>
        <tr><th style="width:110px">Loan No</th><td>${provId}</td><th style="width:110px">Date</th><td>${new Date().toLocaleDateString("en-IN")}</td></tr>
        <tr><th>Customer</th><td>${d.c.name} (${d.c.id})</td><th>Phone</th><td>${"phone" in d.c ? d.c.phone : "—"}</td></tr>
        <tr><th>Address</th><td>${"address" in d.c ? d.c.address : "—"}</td><th>Branch</th><td>${"branchName" in d.c ? d.c.branchName : "—"}</td></tr>
        <tr><th>Scheme</th><td>${d.sch.name} @ ${d.sch.rate}% p.a. (LTV ${d.sch.ltv}%)</td>
            <th>Locker</th><td>${d.locker ? d.locker.code + " — " + d.locker.branchName : "Not assigned"}</td></tr>
      </table>
      <table>
        <thead><tr><th>#</th><th>Ornament</th><th>Purity</th><th class="num">Net Wt (g)</th><th class="num">Qty</th><th class="num">Value</th><th>Photo</th></tr></thead>
        <tbody>
          ${d.orns.map((o, i) => `<tr><td>${i + 1}</td><td>${o.n}</td><td>${o.purity}</td>
            <td class="num">${o.net.toFixed(1)}</td><td class="num">${o.qty}</td><td class="num">${fmt(o.val)}</td>
            <td style="text-align:center">${o.img ? `<img src="${o.img}" style="width:56px;height:56px;object-fit:cover">` : "—"}</td></tr>`).join("")}
          <tr><th colspan="3">Total</th><th class="num">${d.weight.toFixed(1)}</th><th></th><th class="num">${fmt(d.gross)}</th><th></th></tr>
        </tbody>
      </table>
      <p><b>Eligible loan amount: ${fmt(d.eligible)}</b> &nbsp;<span class="muted">(at today's published rates — 22K ${fmt(rates.k22)}/g)</span></p>
      <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`,
      toast);
  }

  /* Same pledge agreement staff re-print from Loan Details later — see
   * modules/loans/utils/indemnityBond.ts for the template. Full Aadhaar is
   * fetched separately (getCustomerAadhaarFull) since the customer picker's
   * cached CustomerView only ever carries the last-4. */
  async function printIndemnity(lang: BondLang = bondLang) {
    const d = buildDraft();
    const c = d.c as { id?: string; name?: string; dob?: string; address?: string; branchName?: string; phone?: string; pan?: string };
    const aadhaar = c.id ? await getCustomerAadhaarFull(c.id).catch(() => "") : "";
    printIndemnityBond(
      {
        loanNumber: provId,
        ...c,
        aadhaar,
        principalAmount: roundedEligible,
        interestRate: d.sch.rate,
        ornaments: d.orns.map((o) => ({ name: o.n, purity: o.purity, grossWeight: o.gross, netWeight: o.net, value: o.val })),
      },
      toast,
      lang
    );
  }

  async function printPacketLabel() {
    const d = buildDraft();
    const c = d.c as { name?: string; id?: string; phone?: string };
    // Once the loan has actually been created, the real Packet.Code (see
    // backend/internal/packet) is known — encode #packet/<code> so a
    // future scan-lookup app (GET /packets/by-code/:code) resolves it.
    // Before submission, fall back to the provisional loan-id URL used for
    // the pre-submission label preview.
    const packetLabel = createdPacketCode || "PKT-" + provId.slice(3);
    // appPath keeps the business slug — see LoanDetail's label QR.
    const url = createdPacketCode
      ? location.origin + appPath(undefined, "#packet/" + createdPacketCode)
      : location.origin + appPath(undefined, "#loan/" + provId);
    let qr: string;
    try {
      qr = await toDataURL(url, { width: 256, errorCorrectionLevel: "M" });
    } catch {
      toast("Could not generate QR code");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) { toast("Popup blocked — please allow popups for this site to print"); return; }
    // Die-cut "flag tag" stock: 81mm total — a 56mm×12mm head (perforated
    // at the 28mm midpoint) plus a blank 25mm×3mm strap for wrapping
    // around/through the item and tearing off. See the approved wire
    // diagram (packet-flag-tag artifact): first 28mm segment holds the QR,
    // the second (the half that stays with the item once torn) holds the
    // readable identifiers, the strap stays blank. Replaces the old plain
    // 50mm×30mm rectangular label this stock physically can't fit.
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${provId}</title><style>
      @page{size:81mm 12mm;margin:0}
      body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
      .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
        border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid}
      .label img{width:25mm;height:25mm;flex:none}
      .t{font-size:2.5mm;line-height:1.45;min-width:0}
      .t .brand{font-size:2mm;letter-spacing:0.3mm;color:${printColors().brand}}
      .t .id{font-size:3.4mm;font-weight:bold}
      .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .noprint{text-align:center;margin:8mm;font-family:Arial}
      @media print{.noprint{display:none} .head{border:none} .infocell{border-left:none} .strap .band{border:none}}
    </style></head><body>
      <div class="label">
        <img src="${qr}" alt="QR">
        <div class="t">
          <div class="brand">${BRAND.name.toUpperCase()}</div>
          <div class="id">${provId} · ${packetLabel}</div>
          <div>${c.name || "—"}</div>
          <div>${c.id || "—"} · ${c.phone || ""}</div>
          <div>${new Date().toLocaleDateString("en-IN")} · ${d.weight.toFixed(1)} g · ${d.orns.length} item(s)</div>
        </div>
      </div>
      <div class="noprint">
        <p style="font-size:13px;color:#555">81mm × 12mm flag tag — scanning the QR opens ${url}</p>
        <button onclick="window.print()" style="padding:10px 26px;font-size:14px;cursor:pointer">🖨 Print Label</button>
      </div>
    </body></html>`);
    w.document.close();
    setTimeout(() => { try { w.focus(); w.print(); } catch { /* ignore */ } }, 400);
  }

  async function submitNewLoan() {
    const validRows = rows.filter((r) => r.w > 0 && r.q > 0);
    if (!validRows.length) { toast("Add at least one ornament with weight and qty"); return; }
    if (validRows.some((r) => !r.n.trim())) { toast("Please select an ornament type for every row"); return; }
    if (validRows.some((r) => r.netW > r.w)) { toast("Net Wt cannot be greater than Gross Wt"); return; }
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
    const months = s.durationMonths || 12;
    const opened = new Date();
    const due = new Date(opened);
    due.setMonth(due.getMonth() + months);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    setSubmitting(true);
    try {
      const loan = await createLoan({
        branchId: Number(branchId),
        customerId: Number(custId),
        schemeId: Number(schemeId),
        openedDate: iso(opened),
        dueDate: iso(due),
        principalAmount: principal,
        ornaments: validRows.map((r) => ({
          name: r.n,
          purity: r.p,
          grossWeight: r.w,
          // Backend re-derives NetWeight as grossWeight − deductionWeight —
          // sending it this way (rather than a raw netWeight field) keeps the
          // two independently-entered figures in agreement without a second
          // field on the wire.
          deductionWeight: Math.max(0, r.w - r.netW),
          quantity: r.q,
        })),
        ...(lockerId !== "" ? { lockerId: Number(lockerId) } : {}),
        // Hands the backend the draft this loan came from, so it's discarded
        // now that a real loan exists (fail-soft server-side — see
        // Service.DeleteDraftQuietly).
        ...(draftId ? { draftId } : {}),
        ...(additionalInfo.trim() ? { additionalInfo: additionalInfo.trim() } : {}),
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

      // Fetch the auto-created packet's real Code so any subsequent
      // printPacketLabel() call encodes it — fail-soft: packet lookup is
      // enrichment, not a hard dependency of loan submission.
      try {
        const pkts = await listPackets({ loanId: loan.id });
        if (pkts[0]) setCreatedPacketCode(pkts[0].code);
      } catch {
        // ignore — packet tracking is enrichment, not required here
      }

      // Fetch the backend-auto-created tracking packet (loan.PacketCreator,
      // fired right after loan.Service.Create() succeeds) so
      // printPacketLabel() can encode its real Code instead of a
      // provisional loan-id-based URL. Best-effort: a lookup failure here
      // shouldn't block the loan-creation success path.
      try {
        const packets = await listPackets({ loanId: loan.id });
        if (packets.length) setCreatedPacketCode(packets[0].code);
      } catch {
        // ignore — printPacketLabel() falls back to the provisional id
      }

      // The draft (if any) was consumed server-side by the create call above.
      setDraftId(null);
      void loadDrafts();

      refresh();
      refreshLoans();
      toast(`Loan ${loan.loanNumber} submitted for approval`);
      location.hash = "loan/" + loan.loanNumber;
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Could not submit loan — try again");
    } finally {
      setSubmitting(false);
    }
  }

  // The backend already 403s a POST /loans without "can change loan" — the
  // page-level route guard (app/app/page.tsx's ROUTE_PERMISSIONS) already
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
    <div onKeyDown={onEnterSubmit}>
      <div className="page-h"><div><h1>New Gold Loan</h1><p>Select a verified customer, choose a scheme, and record pledged ornaments</p></div></div>
      <hr className="gold-rule" />
      {!isTodaySet && (
        <div
          className={`notice${shakeRateBanner ? " shake-attention" : ""}`}
          style={{ borderColor: "var(--red)", marginBottom: 16, flexDirection: "column", alignItems: "stretch", gap: 10 }}
          onAnimationEnd={() => setShakeRateBanner(false)}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--red)" }}>
            <Icon name="warning" /> <b>Today&apos;s gold rate must be set before creating a loan.</b>
          </div>
          <div className="frow"><div><label className="f">24K · 999 (₹/g)</label><input className="inp" type="number" value={rateR24} onChange={(e) => setRateR24(e.target.value)} /></div></div>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: 0 }}>
            Only the 24K benchmark needs to be set — other purities are resolved per-ornament when pledged.
          </p>
          {rateErr && <p style={{ color: "var(--red)", fontSize: 12.5, margin: 0 }}>{rateErr}</p>}
          <div>
            <button className="btn" onClick={saveTodayRate} disabled={rateSaving}>
              <Icon name="check" /> {rateSaving ? "Saving…" : "Save Rate"}
            </button>
          </div>
        </div>
      )}
      <div className="grid cols21">
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
                onChange={(id, item) => { setCustId(id); setCustLabel(`${item.name} (${item.code})`); }}
                fetchFn={searchCustomersPage}
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
                getLabel={(s) => `${s.name} — ${s.ltv}% LTV @ ${s.rate}%`}
                getId={(s) => s.id}
                placeholder="Search active schemes…"
              /></div>
          </div>
          <div className="frow c2">
            <div><label className="f">Branch</label>
              {/* Non-admins are confined to their own branch — the backend
                  already scopes GET /branches to it, so this is a locked
                  single-option field for them; admins get the full themed
                  search like Customer/Scheme above. */}
              <SearchableSelect<BranchView>
                value={branchLabel}
                onChange={(id, item) => { setBranchId(+id); setBranchLabel(item.name); }}
                fetchFn={searchBranchesLocal}
                getLabel={(b) => b.name}
                getId={(b) => String(b.id)}
                placeholder={branches.length === 0 ? "Loading branches…" : "Search branch…"}
                disabled={!isAdmin}
              /></div>
            <div><label className="f">Locker / Storage</label>
              <SearchableSelect<LockerView>
                value={lockerLabel}
                onChange={(id, item) => { setLockerId(+id); setLockerLabel(`${item.code} — ${item.branchName} (${item.occupied}/${item.capacity} packets)`); }}
                fetchFn={searchLockersLocal}
                getLabel={(k) => `${k.code} — ${k.branchName} (${k.occupied}/${k.capacity} packets)`}
                getId={(k) => String(k.id)}
                placeholder="— Assign later — or search locker…"
              /></div>
          </div>
          <div className="frow c2">
            <div><label className="f">Loan No (auto)</label><input className="inp" value={provId} disabled /></div>
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
              is hidden below 1350px, `.orn-cards-view` shown instead. The
              table's own hidden file `<input>`/ref stays the single source
              of truth for
              a row's photo picker either way (see the card's Upload/Replace
              buttons below, which reuse `fileRefs.current[i]` rather than
              mounting a second file input for the same row — two <input
              type="file"> elements sharing one ref array index would race
              on which one `fileRefs.current[i]` actually points to). */}
          {/* minWidth:900 is a real, computed floor — not an organic
              "however wide the content happens to need" guess. Purity's
              own column (20%) is the binding constraint: its content needs
              at least ~176px (the toggle's own 130px floor + 6px row gap +
              the search field's 34px floor + ~6px cell padding), and 20%
              of 176/0.20 = 880px, plus headroom for rounding — 900px.
              table-layout:fixed does NOT reallocate a tight column's
              shortfall from another column's slack, so these 9 <col>
              percentages are kept summing to exactly 100 (not left to
              silently normalize down) — a sum over 100 shrinks EVERY
              column's real rendered share, including Purity's, which is
              exactly what caused it to clip against Gross/Net Wt after
              those two were last widened. Below this width Purity's
              content no longer fits its own <td> and spills into the
              column beside it instead of the table falling back to
              .page's horizontal scroll the way it's meant to. */}
          <div className="orn-table-view" style={{ width: "100%", minWidth: 900, paddingBottom: 6 }}><table className="tbl orn-table" style={{ width: "100%", tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "11%" }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "10%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "8%" }} />
              <col style={{ width: "11%" }} />
              <col style={{ width: "13%" }} />
              <col style={{ width: "7%" }} />
            </colgroup>
            <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Gross Wt (g)</th><th className="num">Net Wt (g)</th><th className="num">Qty</th><th className="num">Total Wt (g)</th><th className="num">Value</th><th style={{ textAlign: "center" }}>Photo</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="empty">No ornaments added yet — click &quot;Add Ornament&quot; below.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  {/* height:31 matches the Purity/weight/Qty cells beside it */}
                  <td className="orn-type-td">
                    <SearchableSelect<BackendOrnamentType>
                      value={r.n}
                      onChange={(_id, item) => updOrn(i, "n", item.name)}
                      fetchFn={searchOrnamentTypesPage}
                      getLabel={(t) => t.name}
                      getId={(t) => String(t.id)}
                      placeholder="Ornament type…"
                      allowCreate
                      onCreate={createOrnamentType}
                    />
                  </td>
                  <td><PurityPicker value={r.p} onChange={(v) => updOrn(i, "p", v)} dropdownMinWidth={70} /></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 70, height: 31, textAlign: "right", boxSizing: "border-box" }} type="number" min={0} value={r.w === 0 ? "" : r.w} onChange={(e) => updOrn(i, "w", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 70, height: 31, textAlign: "right", boxSizing: "border-box" }} type="number" min={0} max={r.w || undefined} value={r.netW === 0 ? "" : r.netW} onChange={(e) => updOrn(i, "netW", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: "100%", minWidth: 70, height: 31, textAlign: "right", boxSizing: "border-box" }} type="number" min={0} value={r.q} onChange={(e) => updOrn(i, "q", Math.max(0, +e.target.value || 0))} /></td>
                  <td className="num">{(r.netW * r.q).toFixed(2)}</td>
                  <td className="num">{fmt(rowVals[i])}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <input type="file" accept="image/*" ref={(el) => { fileRefs.current[i] = el; }} style={{ display: "none" }} onChange={(e) => ornImgPicked(i, e.target)} />
                    {r.img ? (
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center", justifyContent: "center" }}>
                        <img src={r.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title="View photo" onClick={() => viewOrnImg(i)} />
                        <button className="btn plain sm" style={{ padding: "0 7px", height: 31 }} title="Replace photo" onClick={() => fileRefs.current[i]?.click()}>↺</button>
                        <button className="btn plain sm" style={{ padding: "0 7px", height: 31 }} title="Remove photo" onClick={() => delOrnImg(i)}>✕</button>
                      </div>
                    ) : (
                      <button className="btn plain sm" style={{ padding: "0 9px", height: 31 }} title="Upload ornament photo" onClick={() => fileRefs.current[i]?.click()}>📷 Upload</button>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}>
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
                      getLabel={(t) => t.name}
                      getId={(t) => String(t.id)}
                      placeholder="Ornament type…"
                      allowCreate
                      onCreate={createOrnamentType}
                    />
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
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} type="number" min={0} value={r.w === 0 ? "" : r.w} onChange={(e) => updOrn(i, "w", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label className="f">Net Wt (g)</label>
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} type="number" min={0} max={r.w || undefined} value={r.netW === 0 ? "" : r.netW} onChange={(e) => updOrn(i, "netW", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} />
                  </div>
                  <div style={{ flex: 1, minWidth: 70 }}>
                    <label className="f">Qty</label>
                    <input className="inp" style={{ padding: "6px 8px", width: "100%", height: 31, boxSizing: "border-box" }} type="number" min={0} value={r.q} onChange={(e) => updOrn(i, "q", Math.max(0, +e.target.value || 0))} />
                  </div>
                </div>
                <div className="orn-card-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Total Wt (g)</span>
                  <b>{(r.netW * r.q).toFixed(2)}</b>
                </div>
                <div className="orn-card-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Value</span>
                  <b>{fmt(rowVals[i])}</b>
                </div>
                <div className="orn-card-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--muted)" }}>Photo</span>
                  {/* Reuses the table view's own hidden file <input>/ref for
                      this row — see the comment above the table wrapper. */}
                  {r.img ? (
                    <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                      <img src={r.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer" }} title="View photo" onClick={() => viewOrnImg(i)} />
                      <button className="btn plain sm" style={{ padding: "0 7px", height: 31 }} title="Replace photo" onClick={() => fileRefs.current[i]?.click()}>↺</button>
                      <button className="btn plain sm" style={{ padding: "0 7px", height: 31 }} title="Remove photo" onClick={() => delOrnImg(i)}>✕</button>
                    </div>
                  ) : (
                    <button className="btn plain sm" style={{ padding: "0 9px", height: 31 }} title="Upload ornament photo" onClick={() => fileRefs.current[i]?.click()}>📷 Upload</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button className="btn plain sm" style={{ marginTop: 10 }} onClick={() => addOrnRow()}><Icon name="plus" /> Add Ornament</button>
        </div>
          <div className="ft" style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", padding: "14px 18px" }}>
            <button className="btn ghost" onClick={printPacketLabel}>🏷 Print Label</button>
            <button className="btn ghost" onClick={printPledgeSlip}>🖨 Print Slip</button>
            {/* Pledge agreement print dropdown — replaces the old 2-button
              * toggle + print button with a single dropdown matching
              * LoanDetail.tsx's Documents menu, picking between English and
              * Malayalam on the fly. */}
            <div className="docs-dd" ref={bondMenuRef}>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setBondMenuOpen((v) => !v)}
                title="Print pledge agreement in English or Malayalam"
              >
                🖨 Pledge Agreement <Icon name="chevronDown" className="docs-dd-chev" />
              </button>
              {/* Generated from the business's granted languages rather than
                * two hand-written entries. The pair used to be duplicated
                * here and in EsignLanguageModal, so adding a language meant
                * editing both and the labels could drift. */}
              {bondMenuOpen && (
                <div className="docs-dd-menu" style={{ minWidth: 230, right: 0 }}>
                  {bondLangOptions.map((o) => (
                    <a
                      key={o.value}
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setBondMenuOpen(false);
                        setBondLang(o.value);
                        printIndemnity(o.value);
                      }}
                    >
                      <Icon name="doc" />
                      <span className="tx">
                        {o.label}
                        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{o.native}</span>
                      </span>
                    </a>
                  ))}
                </div>
              )}
            </div>
            <button className="btn ghost" onClick={saveDraftNow} disabled={savingDraft}>
              {savingDraft ? "Saving…" : draftId ? "Update Draft" : "Save Draft"}
            </button>
            <button className="btn" onClick={submitNewLoan} disabled={submitting || !isTodaySet} title={!isTodaySet ? "Today's gold rate must be set before creating a loan." : undefined}>
              <Icon name="check" /> {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
          </div>
        </div>

        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Valuation</h3></div>
            <div className="bd" style={{ fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Total net weight</span><b>{totalWeight.toFixed(1)} g</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Gross gold value</span><b>{fmt(totalGross)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Scheme LTV</span><b>{sch ? sch.ltv + "%" : "—"}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}>
                <span>Eligible loan amount</span><b>{fmt(eligible)}</b></div>
              <div style={{ padding: "10px 0 2px", borderTop: "1px dashed var(--line)", marginTop: 8 }}>
                <label className="f" htmlFor="loan-amount-input">Loan amount to disburse (₹)</label>
                <input
                  id="loan-amount-input"
                  className="inp"
                  type="number"
                  min={1}
                  placeholder={String(Math.round(eligible))}
                  value={principalOverride}
                  onChange={(e) => setPrincipalOverride(e.target.value)}
                  style={{ fontWeight: 600, color: "var(--brand-deep)", fontSize: 16 }}
                />
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
            <div className="ft">Uses today&apos;s published rates (22K {fmt(rates.k22)}/g) — defaults to the eligible amount but can be overridden</div></div>
          {/* Saved drafts. Only rendered when there are any — an empty card
              on every visit would be noise on a page staff use constantly.
              Drafts are this employee's own (scoped server-side from the
              JWT), so this is a personal work-in-progress list, not a
              branch queue. */}
          {drafts.length > 0 && (
            <div className="card gtop"><div className="hd"><h3>Saved drafts</h3></div>
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
                        {new Date(d.updatedAt).toLocaleString("en-IN")}
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
          <div className="notice"><Icon name="shield" /> Every loan is verified by the Loan Operator, approved by the Branch Manager, then finally sanctioned by Management.</div>
        </div>
      </div>
    </div>
  );
}
