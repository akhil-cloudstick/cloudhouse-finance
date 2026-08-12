"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { useData } from "@/lib/DataProvider";
import { useCustomers } from "@/lib/CustomersProvider";
import { useSchemes } from "@/lib/SchemesProvider";
import { useLoans } from "@/lib/LoansProvider";
import { useGoldRates } from "@/lib/GoldRatesProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { useAuth } from "@/lib/auth-context";
import { Icon } from "@/lib/icons";
import { fmt, custOf, schemeOf } from "@/lib/format";
import { uploadFile, searchCustomersPage, type CustomerView } from "@/lib/customersApi";
import { searchActiveSchemesPage, type SchemeView } from "@/lib/schemesApi";
import { searchOrnamentTypesPage, createOrnamentType, type BackendOrnamentType } from "@/lib/ornamentTypesApi";
import { createLoan, addOrnamentImage } from "@/lib/loansApi";
import { listPackets } from "@/lib/packetApi";
import { publishGoldRate } from "@/lib/goldRateApi";
import { listActiveBranches, type BranchView } from "@/lib/branchApi";
import { listLockers, type LockerView } from "@/lib/lockerApi";
import { SearchableSelect } from "@/components/SearchableSelect";
import { PurityPicker } from "@/components/PurityPicker";
import { rateForPurityString } from "@/lib/purity";
import { openPrintWindow } from "@/lib/print";
import { ApiError } from "@/lib/api";
import type { Ornament } from "@/lib/data";

// Purity is now a plain unit-suffixed string ("22K" / "91.6%", see
// lib/purity.ts) rather than a fixed k24/k22/k18 bucket — PURITY_LABEL is
// gone since the string itself is already the display label.
type OrnRow = { n: string; p: string; w: number; q: number; img?: string; imgName?: string };

/* Ported from legacy/app.js's `renderNewLoan()` (legacy/app.js:845-1151).
 * Customer/scheme/ornament-type pickers now hit the real backend search
 * endpoints (via SearchableSelect) instead of filtering an in-memory mock
 * list or a localStorage-backed type list. */
export function NewLoan() {
  const { role } = useAuth();
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

  async function saveTodayRate() {
    const k24 = +rateR24;
    if (!(k24 > 0)) {
      setRateErr("The 24K rate must be greater than zero.");
      return;
    }
    setRateErr("");
    setRateSaving(true);
    try {
      await publishGoldRate({ k24, setBy: rates.setBy && rates.setBy !== "—" ? rates.setBy : "Admin" });
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
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  // NewLoan.tsx has no branch/session context of its own — there's no
  // auth/session provider anywhere in this codebase yet (see other
  // components' `listActiveBranches()` + "pick the first one" pattern in
  // EmployeeModal.tsx/ExpenseModal.tsx/LockerModal.tsx). Mirroring that,
  // this defaults to the first active branch; a real branch/session
  // context should replace this once one exists.
  const [branches, setBranches] = useState<BranchView[]>([]);
  const [branchId, setBranchId] = useState<number | "">("");
  const [submitting, setSubmitting] = useState(false);
  // Real Packet.Code, fetched right after loan creation succeeds (the
  // backend auto-creates the loan's tracking packet — see
  // loan.PacketCreator) — printPacketLabel() prefers this over the
  // provisional provId-based URL once it's known.
  const [createdPacketCode, setCreatedPacketCode] = useState<string | null>(null);

  useEffect(() => {
    listActiveBranches()
      .then((list) => {
        setBranches(list);
        if (list.length) setBranchId((cur) => (cur === "" ? list[0].id : cur));
      })
      .catch(() => toast("Could not load branches — try again later."));
    listLockers()
      .then(setLockers)
      .catch(() => toast("Could not load lockers — try again later."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function searchVerifiedCustomers(q: string, page: number): Promise<{ items: CustomerView[]; hasMore: boolean }> {
    const result = await searchCustomersPage(q, page);
    // Filtering verified-only client-side after the page loads means a
    // page can legitimately come back short (or empty) even when hasMore
    // is true — that's fine, the next scroll-triggered page keeps going.
    return { items: result.items.filter((c) => c.panStatus === "Verified" && c.aadhaarStatus === "Verified"), hasMore: result.hasMore };
  }

  const sch = schemes.find((s) => s.id === schemeId);

  const rowVals = rows.map((r) => r.w * r.q * (rateForPurityString(rates.k24, r.p) ?? 0));
  const totalWeight = rows.reduce((s, r) => s + r.w * r.q, 0);
  const totalGross = rowVals.reduce((s, v) => s + v, 0);
  const eligible = sch ? (totalGross * sch.ltv) / 100 : 0;
  const principal = principalOverride.trim() ? Math.max(0, +principalOverride) : Math.round(eligible);

  // Clear a stale manual override whenever the eligible amount it was based
  // on changes (ornaments edited, scheme swapped, rates refreshed) — the
  // field falls back to showing the new eligible amount as a placeholder
  // rather than silently keeping an amount computed against different gold.
  const roundedEligible = Math.round(eligible);
  useEffect(() => {
    setPrincipalOverride("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundedEligible]);

  function addOrnRow(pre?: OrnRow) {
    // Ornament type starts blank — it must be explicitly picked (or created)
    // via the SearchableSelect below, never silently defaulted.
    setRows((rs) => [...rs, pre || { n: "", p: "22K", w: 0, q: 1 }]);
  }
  function delOrnRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }
  function updOrn<K extends keyof OrnRow>(i: number, k: K, v: OrnRow[K]) {
    // Weight/qty can never go negative, however the value arrives (native
    // spinner decrement past 0, typed "-", pasted value, etc.) — clamp here
    // centrally rather than trusting each call site.
    const clamped = (k === "w" || k === "q") && typeof v === "number" ? (Math.max(0, v) as OrnRow[K]) : v;
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

  // TODO: buildDraft()/print* functions build their own Ornament shape
  // straight from `rows` (not from any backend response), so they stay
  // consistent even though submitNewLoan() now posts to the real loan API —
  // no rewrite needed here, but note this if createLoan()'s ornament shape
  // ever changes and rows are adjusted to match it more closely.
  function buildDraft() {
    const c = custOf(customers, custId);
    const s = schemeOf(schemes, schemeId);
    let weight = 0, gross = 0;
    const orns: Ornament[] = rows.filter((r) => r.w > 0 && r.q > 0).map((r) => {
      const v = r.w * r.q * (rateForPurityString(rates.k24, r.p) ?? 0);
      weight += r.w * r.q; gross += v;
      return { n: r.n, purity: r.p, gross: r.w, net: r.w, qty: r.q, val: Math.round(v), img: r.img };
    });
    const locker = lockers.find((k) => k.id === lockerId);
    return { c, sch: s, orns, weight, gross, eligible: Math.round((gross * s.ltv) / 100), locker };
  }

  function printPledgeSlip() {
    const d = buildDraft();
    if (!d.orns.length) { toast("Add at least one ornament with weight and qty first"); return; }
    openPrintWindow("Pledge Slip — " + provId, `
      <h1>AMBIKA GOLD FINANCE</h1><h2>Gold Loan Pledge Slip</h2>
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

  function printIndemnity(lang: "en" | "gu" | "hi") {
    const d = buildDraft();
    const c = d.c as { name?: string; dob?: string; address?: string; branchName?: string; phone?: string };
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(2);
    const monthName = now.toLocaleString("en-IN", { month: "long" });
    const age = c.dob ? Math.floor((now.getTime() - new Date(c.dob).getTime()) / 31557600000) : "____";
    const B = "________________";

    if (lang === "gu") {
      openPrintWindow("વળતર બોન્ડ — " + provId, `
        <h1>વળતર બોન્ડ (INDEMNITY BOND)</h1>
        <p>તારીખ: ${dd} / ${mm} / 20${yy}</p>
        <p>પ્રતિ,<br>શાખા વ્યવસ્થાપકશ્રી,<br>અંબિકા ગોલ્ડ ફાઇનાન્સ (NBFC)<br>${c.branchName || B} શાખા</p>
        <p><b>વિષય: ગોલ્ડ લોન એકાઉન્ટ નં. ${provId} અંગે વળતર બોન્ડ</b></p>
        <p>હું/અમે, શ્રી/શ્રીમતી <b>${c.name || B}</b>, ઉંમર <b>${age}</b> વર્ષ, રહેવાસી <b>${c.address || B}</b>, આથી સોગંદપૂર્વક જાહેર કરું/કરીએ છું/છીએ અને બાંહેધરી આપું/આપીએ છીએ કે:</p>
        <ol>
          <li>હું/અમે ઉપરોક્ત ગોલ્ડ લોન એકાઉન્ટના કાયદેસર લોનધારક (Borrower) છીએ.</li>
          <li>ઉપરોક્ત ગોલ્ડ લોનની સુરક્ષા (Security) તરીકે મેં/અમે બેંક/NBFC પાસે સોનાના દાગીના/વસ્તુઓ ગીરવે મૂકેલ છે.</li>
          <li>હું/અમે આથી જાહેર કરું/કરીએ છીએ કે બેંક/NBFC પાસે ગીરવે મૂકવામાં આવેલ તમામ સોનાના દાગીના/વસ્તુઓ મારા/અમારા કાયદેસરના અને સંપૂર્ણ માલિકીના છે. આ સોના પર અન્ય કોઈપણ વ્યક્તિનો માલિકી હક, હિત, દાવો, ગીરો, અધિકાર અથવા અન્ય કોઈ પ્રકારનો હક નથી.</li>
          <li>હું/અમે વધુમાં જાહેર કરું/કરીએ છીએ કે ગીરવે મૂકવામાં આવેલ સોનું કાયદેસર રીતે પ્રાપ્ત કરાયેલ છે અને તે કોઈપણ ગેરકાયદેસર પ્રવૃત્તિ, ચોરી, છેતરપિંડી, ગુનાહિત કૃત્ય, મની લોન્ડરિંગ અથવા અન્ય કોઈ ગેરકાયદેસર સ્ત્રોતમાંથી પ્રાપ્ત થયેલ નથી.</li>
          <li>ઉપરોક્ત સોનાની માલિકી, સ્ત્રોત, ગીરો અથવા તેની મુક્તિ સંબંધિત કોઈપણ પ્રકારના દાવા, વિવાદ, નુકસાન, જવાબદારી, ખર્ચ, કાનૂની કાર્યવાહી અથવા અન્ય પરિણામો માટે હું/અમે સંપૂર્ણપણે જવાબદાર રહીશ/રહીશું અને બેંક/NBFC તથા તેના અધિકારીઓ, કર્મચારીઓ અને પ્રતિનિધિઓને આવા તમામ નુકસાન, ખર્ચ અને જવાબદારીઓ સામે સંપૂર્ણ વળતર (Indemnity) આપવા તથા તેમને નિર્દોષ રાખવા સંમત છીએ.</li>
          <li>જો ભવિષ્યમાં કોઈપણ વ્યક્તિ અથવા સંસ્થા ઉપરોક્ત સોનાની માલિકી, કબજો અથવા તેના સ્ત્રોત અંગે કોઈ દાવો, વાંધો અથવા કાનૂની કાર્યવાહી કરે, તો તે અંગેનો સંપૂર્ણ ખર્ચ, જવાબદારી અને તેનો નિકાલ હું/અમે મારી/અમારી જવાબદારી પર કરીશ/કરીશું અને તેનાથી બેંક/NBFCને થનારા તમામ નુકસાન, ખર્ચ અથવા જવાબદારીઓ માટે હું/અમે સંપૂર્ણ વળતર આપીશ/આપીશું.</li>
          <li>હું/અમે જાહેર કરું/કરીએ છીએ કે આ બોન્ડમાં દર્શાવેલ તમામ વિગતો મારી/અમારી જાણ અને માન્યતા મુજબ સાચી, સંપૂર્ણ અને યથાર્થ છે. બેંક/NBFC આ ઘોષણા પર વિશ્વાસ રાખીને ગોલ્ડ લોન મંજૂર કરે છે અથવા ચાલુ રાખે છે તે બાબત મને/અમને સંપૂર્ણ જાણ છે.</li>
          <li>આ વળતર બોન્ડ મારા/અમારા તેમજ મારા/અમારા કાનૂની વારસદારો, પ્રતિનિધિઓ, વહીવટદારો અને ઉત્તરાધિકારીઓ પર બંધનકર્તા રહેશે અને આ બોન્ડ હેઠળની તમામ જવાબદારીઓ પૂર્ણ ન થાય ત્યાં સુધી અમલમાં રહેશે.</li>
        </ol>
        <p>આથી હું/અમે આ વળતર બોન્ડ આજ રોજ <b>${dd} / ${mm} / 20${yy}</b> ના રોજ સ્વેચ્છાએ અને કોઈપણ દબાણ વિના હસ્તાક્ષર કરીને અમલમાં મૂકીએ છીએ.</p>
        <p style="margin-top:56px">લોનધારકની સહી: ${B}</p>
        <p>નામ: <b>${c.name || B}</b><br><br>સરનામું: <b>${c.address || B}</b></p>
        <hr style="margin:24px 0">
        <p>મોબાઇલ નં.: <b>${c.phone || B}</b></p>
        <p><b>સાક્ષીઓ</b></p>
        <p><b>સાક્ષી – ૧</b><br><br>નામ: ${B}<br><br>સરનામું: ${B}<br><br>સહી: ${B}</p>
        <p style="margin-top:28px"><b>સાક્ષી – ૨</b><br><br>નામ: ${B}<br><br>સરનામું: ${B}<br><br>સહી: ${B}</p>`,
        toast);
      return;
    }

    if (lang === "hi") {
      openPrintWindow("क्षतिपूर्ति बंधपत्र — " + provId, `
        <h1>क्षतिपूर्ति बंधपत्र (INDEMNITY BOND)</h1>
        <p>दिनांक: ${dd} / ${mm} / 20${yy}</p>
        <p>सेवा में,<br>शाखा प्रबंधक,<br>अंबिका गोल्ड फाइनेंस (NBFC)<br>${c.branchName || B} शाखा</p>
        <p><b>विषय: गोल्ड लोन खाता संख्या ${provId} के संबंध में क्षतिपूर्ति बंधपत्र</b></p>
        <p>मैं/हम, श्री/श्रीमती <b>${c.name || B}</b>, आयु <b>${age}</b> वर्ष, निवासी <b>${c.address || B}</b>, एतद्द्वारा गंभीरतापूर्वक घोषणा करता/करती हूँ/करते हैं और वचन देता/देती हूँ/देते हैं कि:</p>
        <ol>
          <li>मैं/हम उपर्युक्त गोल्ड लोन खाता संख्या ${provId} के अंतर्गत बैंक/NBFC के कानूनी ऋणी (Borrower) हूँ/हैं।</li>
          <li>उक्त गोल्ड लोन की सुरक्षा (Security) के रूप में मैंने/हमने बैंक/NBFC के पास सोने के आभूषण/वस्तुएं गिरवी रखी हैं।</li>
          <li>मैं/हम एतद्द्वारा घोषणा करता/करती हूँ/करते हैं कि बैंक/NBFC के पास गिरवी रखे गए सभी सोने के आभूषण/वस्तुएं मेरी/हमारी वैध संपत्ति हैं तथा मैं/हम ही उनके एकमात्र और पूर्ण स्वामी हूँ/हैं। उक्त सोने पर किसी अन्य व्यक्ति का कोई स्वामित्व, हक, हित, दावा, गिरवी अथवा किसी भी प्रकार का अधिकार नहीं है।</li>
          <li>मैं/हम आगे घोषणा करता/करती हूँ/करते हैं कि उक्त सोना वैध साधनों से प्राप्त किया गया है तथा यह किसी भी अवैध गतिविधि, आपराधिक कृत्य, चोरी, धोखाधड़ी, मनी लॉन्ड्रिंग अथवा किसी अन्य अवैध स्रोत से प्राप्त नहीं हुआ है।</li>
          <li>मैं/हम एतद्द्वारा बैंक/NBFC, उसके अधिकारियों, कर्मचारियों, उत्तराधिकारियों तथा समनुदेशितियों को उक्त गिरवी रखे गए सोने के आभूषणों/वस्तुओं के स्वामित्व, हक, स्रोत, गिरवी अथवा मुक्ति से संबंधित किसी भी हानि, दावे, माँग, दायित्व, नुकसान, लागत, व्यय, कानूनी कार्यवाही अथवा परिणाम के विरुद्ध क्षतिपूर्ति देने तथा उन्हें निर्दोष रखने हेतु सहमत हूँ/हैं।</li>
          <li>यदि भविष्य में कोई तीसरा पक्ष गिरवी रखे गए सोने के स्वामित्व, कब्जे अथवा स्रोत के संबंध में कोई दावा, आपत्ति अथवा कानूनी कार्यवाही करता है, तो मैं/हम स्वयं अपने खर्च पर उसका निपटारा करने हेतु पूर्णतः उत्तरदायी होऊँगा/होंगे तथा इससे उत्पन्न होने वाली समस्त हानि, नुकसान, लागत, व्यय एवं दायित्वों के विरुद्ध बैंक/NBFC को पूर्ण रूप से क्षतिपूर्ति दूंगा/देंगे।</li>
          <li>मैं/हम घोषणा करता/करती हूँ/करते हैं कि इस बंधपत्र में दी गई समस्त जानकारी मेरी/हमारी जानकारी एवं विश्वास के अनुसार सत्य, सही एवं पूर्ण है। मैं/हम समझता/समझती हूँ/समझते हैं कि बैंक/NBFC इस घोषणा पर विश्वास करते हुए उक्त गोल्ड लोन स्वीकृत करता है अथवा जारी रखता है।</li>
          <li>यह क्षतिपूर्ति बंधपत्र अपरिवर्तनीय होगा तथा मुझ पर/हम पर एवं मेरे/हमारे कानूनी उत्तराधिकारियों, निष्पादकों, प्रशासकों तथा प्रतिनिधियों पर तब तक वैध, बाध्यकारी एवं प्रवर्तनीय रहेगा जब तक इसके अंतर्गत उत्पन्न सभी दायित्वों का पूर्ण निर्वहन नहीं हो जाता।</li>
        </ol>
        <p>इसके साक्ष्य स्वरूप, मैंने/हमने यह क्षतिपूर्ति बंधपत्र आज <b>${now.getDate()}</b> ${monthName}, 20${yy} को स्वेच्छा से एवं बिना किसी दबाव के निष्पादित किया है।</p>
        <p style="margin-top:56px"><b>ऋणी के हस्ताक्षर</b></p>
        <p>नाम: <b>${c.name || B}</b><br><br>पता: <b>${c.address || B}</b></p>
        <hr style="margin:24px 0">
        <p>मोबाइल नं.: <b>${c.phone || B}</b></p>
        <p><b>साक्षीगण</b></p>
        <p><b>साक्षी संख्या 1</b><br><br>नाम: ${B}<br><br>पता: ${B}<br><br>हस्ताक्षर: ${B}</p>
        <p style="margin-top:28px"><b>साक्षी संख्या 2</b><br><br>नाम: ${B}<br><br>पता: ${B}<br><br>हस्ताक्षर: ${B}</p>`,
        toast);
      return;
    }

    openPrintWindow("Indemnity Bond — " + provId, `
      <h1>INDEMNITY BOND</h1>
      <p>Date: ${dd} / ${mm} / 20${yy}</p>
      <p>To<br>The Branch Manager<br>Ambika Gold Finance (NBFC)<br>${c.branchName || B} Branch</p>
      <p><b>Subject: Indemnity Bond in respect of Gold Loan Account No. ${provId}</b></p>
      <p>I/We, Mr./Ms. <b>${c.name || B}</b>, aged <b>${age}</b> years, residing at <b>${c.address || B}</b>, do hereby solemnly affirm, declare and undertake as under:</p>
      <ol>
        <li>That I/we am/are the borrower(s) under Gold Loan Account No. <b>${provId}</b> with your Bank/NBFC.</li>
        <li>That I/we have pledged certain gold ornaments/articles with the Bank/NBFC as security for the above-mentioned gold loan.</li>
        <li>I/We hereby declare that the gold ornaments/articles pledged with the Bank/NBFC are my/our lawful property and that I/we am/are the sole and absolute owner(s) thereof. No other person has any ownership, title, interest, claim, lien or right of any nature whatsoever in respect of the said gold.</li>
        <li>I/We further declare that the said gold has been acquired through lawful means and has not been obtained, purchased, possessed, or derived from any illegal activity, criminal offence, theft, fraud, money laundering, or any other unlawful source.</li>
        <li>I/We hereby agree to indemnify and keep indemnified the Bank/NBFC, its officers, employees, successors and assigns against any loss, claim, demand, liability, damage, cost, expense, legal proceedings or consequences whatsoever arising out of or in connection with the ownership, title, source, pledge or release of the said gold ornaments/articles.</li>
        <li>In the event that any third party raises any claim, objection, dispute or legal proceedings regarding the ownership, possession or source of the pledged gold, I/we shall be solely responsible for resolving the same at my/our own cost and shall fully indemnify and hold harmless the Bank/NBFC against all losses, damages, costs, expenses and liabilities arising therefrom.</li>
        <li>I/We declare that all statements made herein are true, correct and complete to the best of my/our knowledge and belief. I/We understand that this declaration is being relied upon by the Bank/NBFC for the purpose of granting and/or continuing the above-mentioned gold loan.</li>
        <li>This Indemnity Bond shall be irrevocable and shall remain valid, binding and enforceable upon me/us and my/our legal heirs, executors, administrators and representatives until all obligations arising hereunder have been fully discharged.</li>
      </ol>
      <p>IN WITNESS WHEREOF, I/we have executed this Indemnity Bond on this <b>${now.getDate()}</b> day of <b>${monthName}</b>, 20${yy}.</p>
      <p style="margin-top:56px"><b>Signature of Borrower</b></p>
      <p>Name: <b>${c.name || B}</b><br><br>Address: <b>${c.address || B}</b></p>
      <hr style="margin:24px 0">
      <p>Mobile No.: <b>${c.phone || B}</b></p>
      <p><b>Witnesses</b></p>
      <p><b>Witness No. 1</b><br><br>Name: ${B}<br><br>Address: ${B}<br><br>Signature: ${B}</p>
      <p style="margin-top:28px"><b>Witness No. 2</b><br><br>Name: ${B}<br><br>Address: ${B}<br><br>Signature: ${B}</p>`,
      toast);
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
    const url = createdPacketCode
      ? location.origin + "/app#packet/" + createdPacketCode
      : location.origin + "/app#loan/" + provId;
    let qr: string;
    try {
      qr = await toDataURL(url, { width: 256, errorCorrectionLevel: "M" });
    } catch {
      toast("Could not generate QR code");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) { toast("Popup blocked — please allow popups for this site to print"); return; }
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${provId}</title><style>
      @page{size:50mm 30mm;margin:0}
      body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
      .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
        border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid}
      .label img{width:25mm;height:25mm;flex:none}
      .t{font-size:2.5mm;line-height:1.45;min-width:0}
      .t .brand{font-size:2mm;letter-spacing:0.3mm;color:#7a5c14}
      .t .id{font-size:3.4mm;font-weight:bold}
      .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .noprint{text-align:center;margin:8mm;font-family:Arial}
      @media print{.noprint{display:none} .label{border:none}}
    </style></head><body>
      <div class="label">
        <img src="${qr}" alt="QR">
        <div class="t">
          <div class="brand">AMBIKA GOLD FINANCE</div>
          <div class="id">${provId} · ${packetLabel}</div>
          <div>${c.name || "—"}</div>
          <div>${c.id || "—"} · ${c.phone || ""}</div>
          <div>${new Date().toLocaleDateString("en-IN")} · ${d.weight.toFixed(1)} g · ${d.orns.length} item(s)</div>
        </div>
      </div>
      <div class="noprint">
        <p style="font-size:13px;color:#555">50mm × 30mm packet label — scanning the QR opens ${url}</p>
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
    const s = schemes.find((x) => x.id === schemeId);
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
          deductionWeight: 0,
          quantity: r.q,
        })),
        ...(lockerId !== "" ? { lockerId: Number(lockerId) } : {}),
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

  // Cashier is outside the loan creation/approval flow — the backend
  // already 403s a Cashier's POST /loans (see authz's Cashier/loans/create
  // override). This catches direct navigation to #newloan (e.g. a bookmark
  // or a stale link) even though every entry-point button/nav-item is
  // already hidden for this role.
  if (role === "Cashier") {
    return (
      <div className="empty">
        You don&apos;t have permission to create a loan. Contact a Loan Operator, Branch Manager, or Administrator.
      </div>
    );
  }

  return (
    <>
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
        <div className="card gtop"><div className="bd">
          <div className="frow c2">
            <div><label className="f">Customer (verified only)</label>
              <SearchableSelect<CustomerView>
                value={custLabel}
                onChange={(id, item) => { setCustId(id); setCustLabel(`${item.name} — ${item.id}`); }}
                fetchFn={searchVerifiedCustomers}
                getLabel={(c) => `${c.name} — ${c.id}`}
                getId={(c) => c.id}
                placeholder="Search verified customers…"
              /></div>
            <div><label className="f">Scheme</label>
              <SearchableSelect<SchemeView>
                value={schemeLabel}
                onChange={(id, item) => { setSchemeId(id); setSchemeLabel(`${item.name} — ${item.ltv}% LTV @ ${item.rate}%`); }}
                fetchFn={searchActiveSchemesPage}
                getLabel={(s) => `${s.name} — ${s.ltv}% LTV @ ${s.rate}%`}
                getId={(s) => s.id}
                placeholder="Search active schemes…"
              /></div>
          </div>
          <div className="frow c2">
            <div><label className="f">Branch</label>
              <select className="inp" value={branchId} onChange={(e) => setBranchId(+e.target.value)}>
                {branches.length === 0 && <option value="">Loading branches…</option>}
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div><label className="f">Locker / Storage</label>
              <select className="inp" value={lockerId} onChange={(e) => setLockerId(e.target.value ? +e.target.value : "")}>
                <option value="">— Assign later —</option>
                {activeLockers.map((k) => (
                  <option key={k.id} value={k.id} disabled={k.occupied >= k.capacity}>
                    {k.code} — {k.branchName} ({k.occupied}/{k.capacity} packets){k.occupied >= k.capacity ? " · Full" : ""}
                  </option>
                ))}
              </select></div>
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
              very narrow viewports instead. */}
          <div><table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Net Wt (g)</th><th className="num">Qty</th><th className="num">Value</th><th style={{ textAlign: "center" }}>Photo</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7} className="empty">No ornaments added yet — click &quot;Add Ornament&quot; below.</td></tr>
              )}
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ minWidth: 180 }}>
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
                  <td style={{ minWidth: 150 }}><PurityPicker value={r.p} onChange={(v) => updOrn(i, "p", v)} /></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: 84, textAlign: "right" }} type="number" min={0} value={r.w === 0 ? "" : r.w} onChange={(e) => updOrn(i, "w", e.target.value === "" ? 0 : Math.max(0, +e.target.value || 0))} /></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: 64, textAlign: "right" }} type="number" min={0} value={r.q} onChange={(e) => updOrn(i, "q", Math.max(0, +e.target.value || 0))} /></td>
                  <td className="num">{fmt(rowVals[i])}</td>
                  <td style={{ textAlign: "center", whiteSpace: "nowrap" }}>
                    <input type="file" accept="image/*" ref={(el) => { fileRefs.current[i] = el; }} style={{ display: "none" }} onChange={(e) => ornImgPicked(i, e.target)} />
                    {r.img ? (
                      <>
                        <img src={r.img} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, border: "1px solid var(--line)", cursor: "pointer", verticalAlign: "middle" }} title="View photo" onClick={() => viewOrnImg(i)} />
                        <button className="btn plain sm" style={{ padding: "4px 7px" }} title="Replace photo" onClick={() => fileRefs.current[i]?.click()}>↺</button>
                        <button className="btn plain sm" style={{ padding: "4px 7px" }} title="Remove photo" onClick={() => delOrnImg(i)}>✕</button>
                      </>
                    ) : (
                      <button className="btn plain sm" style={{ padding: "4px 9px" }} title="Upload ornament photo" onClick={() => fileRefs.current[i]?.click()}>📷 Upload</button>
                    )}
                  </td>
                  <td style={{ textAlign: "center" }}><button className="btn danger sm" onClick={() => delOrnRow(i)}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <button className="btn plain sm" style={{ marginTop: 10 }} onClick={() => addOrnRow()}><Icon name="plus" /> Add Ornament</button>
        </div>
          <div className="ft" style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", padding: "14px 18px" }}>
            <button className="btn ghost" onClick={printPacketLabel}>🏷 Print Label</button>
            <button className="btn ghost" onClick={printPledgeSlip}>🖨 Print Slip</button>
            <button className="btn ghost" onClick={() => printIndemnity("en")}>🖨 Indemnity Bond</button>
            <button className="btn ghost" onClick={() => printIndemnity("hi")}>🖨 क्षतिपूर्ति बॉन्ड (हिन्दी)</button>
            <button className="btn ghost" onClick={() => printIndemnity("gu")}>🖨 વળતર બોન્ડ (ગુજરાતી)</button>
            <button className="btn ghost" onClick={() => toast("Draft saved (demo)")}>Save Draft</button>
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
                  style={{ fontWeight: 600, color: "var(--gold-deep)", fontSize: 16 }}
                />
              </div>
            </div>
            <div className="ft">Uses today&apos;s published rates (22K {fmt(rates.k22)}/g) — defaults to the eligible amount but can be overridden</div></div>
          <div className="notice"><Icon name="shield" /> Loans above ₹2,00,000 require Branch Manager + Management sanction (multi-level approval).</div>
        </div>
      </div>
    </>
  );
}
