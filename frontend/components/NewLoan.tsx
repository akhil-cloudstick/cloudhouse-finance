"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toDataURL } from "qrcode";
import { useData } from "@/lib/DataProvider";
import { useModal } from "@/components/Modal";
import { useToast } from "@/components/Toast";
import { Icon } from "@/lib/icons";
import { fmt, custOf, schemeOf } from "@/lib/format";
import { shrinkImage } from "@/lib/shrinkImage";
import { openPrintWindow } from "@/lib/print";
import type { Ornament } from "@/lib/data";

const ORN_TYPES_KEY = "agf_ornament_types";
const DEFAULT_ORN_TYPES = ["Gold Chain", "Necklace", "Bangle", "Ring", "Earring Set", "Bracelet", "Pendant"];
const PURITY_LABEL: Record<string, string> = { k24: "24K", k22: "22K", k18: "18K" };

type OrnRow = { n: string; p: "k24" | "k22" | "k18"; w: number; q: number; img?: string; imgName?: string };

/* Ported from legacy/app.js's `renderNewLoan()` (legacy/app.js:845-1151). */
export function NewLoan() {
  const { db, refresh } = useData();
  const { openModal, closeModal } = useModal();
  const toast = useToast();

  const provId = useMemo(
    () => "GL-" + (Math.max(0, ...db.loans.map((l) => +String(l.id).slice(3) || 0)) + 1),
    [db.loans]
  );

  const verifiedCustomers = db.customers.filter((c) => c.kyc === "Verified");
  const activeSchemes = db.schemes.filter((s) => s.active);
  const activeLockers = db.lockers.filter((k) => k.status === "Active");

  const [custId, setCustId] = useState(verifiedCustomers[0]?.id || "");
  const [schemeId, setSchemeId] = useState(activeSchemes[0]?.id || "");
  const [lockerId, setLockerId] = useState("");
  const [rows, setRows] = useState<OrnRow[]>([
    { n: "Gold Chain", p: "k22", w: 12.5, q: 1 },
    { n: "Bangle", p: "k22", w: 8.2, q: 2 },
  ]);
  const [ornTypes, setOrnTypes] = useState<string[]>(DEFAULT_ORN_TYPES);
  const fileRefs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(ORN_TYPES_KEY) || "null");
      if (Array.isArray(stored) && stored.length) setOrnTypes(stored);
    } catch { /* ignore */ }
  }, []);

  const sch = db.schemes.find((s) => s.id === schemeId);

  const rowVals = rows.map((r) => r.w * r.q * db.rates[r.p]);
  const totalWeight = rows.reduce((s, r) => s + r.w * r.q, 0);
  const totalGross = rowVals.reduce((s, v) => s + v, 0);
  const eligible = sch ? (totalGross * sch.ltv) / 100 : 0;

  function addOrnRow(pre?: OrnRow) {
    setRows((rs) => [...rs, pre || { n: "Gold Chain", p: "k22", w: 10, q: 1 }]);
  }
  function delOrnRow(i: number) {
    setRows((rs) => rs.filter((_, idx) => idx !== i));
  }
  function updOrn<K extends keyof OrnRow>(i: number, k: K, v: OrnRow[K]) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [k]: v } : r)));
  }

  function ornTypeChanged(i: number, value: string) {
    if (value !== "__add__") { updOrn(i, "n", value); return; }
    const name = (window.prompt("New ornament type:") || "").trim();
    if (!name) return;
    const existing = ornTypes.find((t) => t.toLowerCase() === name.toLowerCase());
    if (existing) {
      toast(`"${existing}" already exists`);
      updOrn(i, "n", existing);
    } else {
      const next = [...ornTypes, name];
      setOrnTypes(next);
      window.localStorage.setItem(ORN_TYPES_KEY, JSON.stringify(next));
      updOrn(i, "n", name);
      toast(`Ornament type "${name}" added`);
    }
  }

  async function ornImgPicked(i: number, input: HTMLInputElement) {
    const f = input.files?.[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) { toast("Please choose an image file"); input.value = ""; return; }
    const url = await shrinkImage(f);
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, img: url, imgName: f.name } : r)));
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

  function buildDraft() {
    const c = custOf(db, custId);
    const s = schemeOf(db, schemeId);
    let weight = 0, gross = 0;
    const orns: Ornament[] = rows.filter((r) => r.w > 0 && r.q > 0).map((r) => {
      const v = r.w * r.q * db.rates[r.p];
      weight += r.w * r.q; gross += v;
      return { n: r.n, purity: PURITY_LABEL[r.p], gross: r.w, net: r.w, qty: r.q, val: Math.round(v), img: r.img };
    });
    const locker = db.lockers.find((k) => k.id === lockerId);
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
        <tr><th>Address</th><td>${"addr" in d.c ? d.c.addr : "—"}</td><th>Branch</th><td>${"branch" in d.c ? d.c.branch : "—"}</td></tr>
        <tr><th>Scheme</th><td>${d.sch.name} @ ${d.sch.rate}% p.a. (LTV ${d.sch.ltv}%)</td>
            <th>Locker</th><td>${d.locker ? d.locker.id + " — " + d.locker.branch : "Not assigned"}</td></tr>
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
      <p><b>Eligible loan amount: ${fmt(d.eligible)}</b> &nbsp;<span class="muted">(at today's published rates — 22K ${fmt(db.rates.k22)}/g)</span></p>
      <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`,
      toast);
  }

  function printIndemnity(lang: "en" | "gu" | "hi") {
    const d = buildDraft();
    const c = d.c as { name?: string; dob?: string; addr?: string; branch?: string; phone?: string };
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
        <p>પ્રતિ,<br>શાખા વ્યવસ્થાપકશ્રી,<br>અંબિકા ગોલ્ડ ફાઇનાન્સ (NBFC)<br>${c.branch || B} શાખા</p>
        <p><b>વિષય: ગોલ્ડ લોન એકાઉન્ટ નં. ${provId} અંગે વળતર બોન્ડ</b></p>
        <p>હું/અમે, શ્રી/શ્રીમતી <b>${c.name || B}</b>, ઉંમર <b>${age}</b> વર્ષ, રહેવાસી <b>${c.addr || B}</b>, આથી સોગંદપૂર્વક જાહેર કરું/કરીએ છું/છીએ અને બાંહેધરી આપું/આપીએ છીએ કે:</p>
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
        <p>નામ: <b>${c.name || B}</b><br><br>સરનામું: <b>${c.addr || B}</b></p>
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
        <p>सेवा में,<br>शाखा प्रबंधक,<br>अंबिका गोल्ड फाइनेंस (NBFC)<br>${c.branch || B} शाखा</p>
        <p><b>विषय: गोल्ड लोन खाता संख्या ${provId} के संबंध में क्षतिपूर्ति बंधपत्र</b></p>
        <p>मैं/हम, श्री/श्रीमती <b>${c.name || B}</b>, आयु <b>${age}</b> वर्ष, निवासी <b>${c.addr || B}</b>, एतद्द्वारा गंभीरतापूर्वक घोषणा करता/करती हूँ/करते हैं और वचन देता/देती हूँ/देते हैं कि:</p>
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
        <p>नाम: <b>${c.name || B}</b><br><br>पता: <b>${c.addr || B}</b></p>
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
      <p>To<br>The Branch Manager<br>Ambika Gold Finance (NBFC)<br>${c.branch || B} Branch</p>
      <p><b>Subject: Indemnity Bond in respect of Gold Loan Account No. ${provId}</b></p>
      <p>I/We, Mr./Ms. <b>${c.name || B}</b>, aged <b>${age}</b> years, residing at <b>${c.addr || B}</b>, do hereby solemnly affirm, declare and undertake as under:</p>
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
      <p>Name: <b>${c.name || B}</b><br><br>Address: <b>${c.addr || B}</b></p>
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
    const url = location.origin + "/app#loan/" + provId;
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
          <div class="id">${provId} · PKT-${provId.slice(3)}</div>
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

  function submitNewLoan() {
    const validRows = rows.filter((r) => r.w > 0 && r.q > 0);
    if (!validRows.length) { toast("Add at least one ornament with weight and qty"); return; }
    const s = db.schemes.find((x) => x.id === schemeId);
    if (!s) { toast("Please select a scheme"); return; }
    const maxN = Math.max(0, ...db.loans.map((l) => +String(l.id).slice(3) || 0));
    const id = "GL-" + (maxN + 1);
    let weight = 0, gross = 0;
    const orns: Ornament[] = validRows.map((r) => {
      const v = r.w * r.q * db.rates[r.p];
      weight += r.w * r.q; gross += v;
      return { n: r.n, purity: PURITY_LABEL[r.p], gross: r.w, net: r.w, qty: r.q, val: Math.round(v), img: r.img };
    });
    const principal = Math.round((gross * s.ltv) / 100);
    const months = parseInt(s.duration) || 12;
    const opened = new Date();
    const due = new Date(opened);
    due.setMonth(due.getMonth() + months);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const ok = db.addLoan({
      id, cust: custId, scheme: s.id, opened: iso(opened), due: iso(due),
      principal, outstanding: principal, weight: +weight.toFixed(1), status: "Pending Approval",
      pledge: "Not Pledged", packet: lockerId ? "PKT-" + (maxN + 1) : "—", locker: lockerId || "—",
    }, orns);
    refresh();
    toast(ok ? `Loan ${id} submitted for approval` : `Loan ${id} created, but browser storage is full — photos may not persist`);
    location.hash = "loan/" + id;
  }

  return (
    <>
      <div className="page-h"><div><h1>New Gold Loan</h1><p>Select a verified customer, choose a scheme, and record pledged ornaments</p></div></div>
      <hr className="gold-rule" />
      <div className="grid cols21">
        <div className="card gtop"><div className="bd">
          <div className="frow c2">
            <div><label className="f">Customer (verified only)</label>
              <select className="inp" value={custId} onChange={(e) => setCustId(e.target.value)}>
                {verifiedCustomers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.id}</option>)}
              </select></div>
            <div><label className="f">Scheme</label>
              <select className="inp" value={schemeId} onChange={(e) => setSchemeId(e.target.value)}>
                {activeSchemes.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.ltv}% LTV @ {s.rate}%</option>)}
              </select></div>
          </div>
          <div className="frow c2">
            <div><label className="f">Locker / Storage</label>
              <select className="inp" value={lockerId} onChange={(e) => setLockerId(e.target.value)}>
                <option value="">— Assign later —</option>
                {activeLockers.map((k) => <option key={k.id} value={k.id}>{k.id} — {k.branch} ({k.packets}/{k.cap} packets)</option>)}
              </select></div>
            <div><label className="f">Loan No (auto)</label><input className="inp" value={provId} disabled /></div>
          </div>
          <label className="f" style={{ marginTop: 6 }}>Pledged Ornaments</label>
          <div className="tbl-wrap"><table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Ornament</th><th>Purity</th><th className="num">Net Wt (g)</th><th className="num">Qty</th><th className="num">Value</th><th style={{ textAlign: "center" }}>Photo</th><th></th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><select className="inp" style={{ padding: "6px 8px" }} value={r.n} onChange={(e) => ornTypeChanged(i, e.target.value)}>
                    {ornTypes.map((o) => <option key={o}>{o}</option>)}
                    <option value="__add__">＋ Add new type…</option>
                  </select></td>
                  <td><select className="inp" style={{ padding: "6px 8px", width: 82 }} value={r.p} onChange={(e) => updOrn(i, "p", e.target.value as OrnRow["p"])}>
                    <option value="k24">24K</option><option value="k22">22K</option><option value="k18">18K</option>
                  </select></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: 84, textAlign: "right" }} type="number" value={r.w} onChange={(e) => updOrn(i, "w", +e.target.value || 0)} /></td>
                  <td className="num"><input className="inp" style={{ padding: "6px 8px", width: 64, textAlign: "right" }} type="number" value={r.q} onChange={(e) => updOrn(i, "q", +e.target.value || 0)} /></td>
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
            <button className="btn" onClick={submitNewLoan}><Icon name="check" /> Submit for Approval</button>
          </div>
        </div>

        <div className="grid">
          <div className="card gtop"><div className="hd"><h3>Valuation</h3></div>
            <div className="bd" style={{ fontSize: 13.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Total net weight</span><b>{totalWeight.toFixed(1)} g</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Gross gold value</span><b>{fmt(totalGross)}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0" }}><span>Scheme LTV</span><b>{sch ? sch.ltv + "%" : "—"}</b></div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 0 2px", borderTop: "1px dashed var(--line)", marginTop: 8 }}>
                <span style={{ fontWeight: 600 }}>Eligible loan amount</span><b style={{ color: "var(--gold-deep)", fontSize: 17 }}>{fmt(eligible)}</b></div>
            </div>
            <div className="ft">Uses today&apos;s published rates (22K {fmt(db.rates.k22)}/g)</div></div>
          <div className="notice"><Icon name="shield" /> Loans above ₹2,00,000 require Branch Manager + Management sanction (multi-level approval).</div>
        </div>
      </div>
    </>
  );
}
