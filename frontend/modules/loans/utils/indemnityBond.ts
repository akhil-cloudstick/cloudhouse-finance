import { openPrintWindow } from "@/common/utils/print";
import { numberToIndianWords } from "@/common/utils/numberToWords";
import { tenantLenderProfile } from "@/common/config/brand";

/* Printable Agreement of Pledge of Movable — the branch's standard pledge
 * deed. Lives here rather than inside NewLoan.tsx because it is needed at
 * two different points in a loan's life: before submission (the New Loan
 * wizard's print button) and afterwards from Loan Details, where staff
 * re-print it for offline wet-ink signing whenever Aadhaar eSign is not
 * used or not available.
 *
 * Every field is optional — the wizard calls this against an unsaved draft
 * whose customer details may still be blank, and a blank renders as the
 * underscore rule a signer fills in by hand.
 *
 * Two languages: English (the original branch paper form's formal numbered-
 * clause pledge deed) and Malayalam (a simpler promissory-pledge letter —
 * ownership declaration + loan request, then a repayment promise with a
 * sale-on-default clause, transcribed verbatim from the branch's own actual
 * reference letter and ending in a built-in release-acknowledgment
 * section — replaces the old Gujarati form, which belonged to an unrelated
 * business). Mirrors backend/internal/loan/indemnitybond.go's
 * bondHTMLEnglish/bondHTMLMalayalam so the printed paper copy and the PDF
 * sent to Setu for eSign read identically. */
export type BondLang = "en" | "ml" | "gu";

/* Shared label set — the same options wherever a bond-language picker
 * appears (NewLoan.tsx's print toggle, LoanDetail.tsx's eSign modal).
 *
 * This is the full catalogue, mirroring tenant.KnownLanguages. It is NOT
 * what a picker should render: which of these a business may actually issue
 * is a per-business grant, so pickers call bondLangOptionsFor() below. */
export const BOND_LANG_OPTIONS: { value: BondLang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "Indemnity Bond" },
  { value: "ml", label: "Malayalam", native: "ആഭരണ പണയ കരാർ" },
  { value: "gu", label: "Gujarati", native: "ગીરો કરાર" },
];

/* bondLangOptionsFor narrows the catalogue to what this business has been
 * granted. English is always present — tenant.Tenant.HasLanguage guarantees
 * it server-side, and a picker with nothing in it would be worse than a
 * picker with one option.
 *
 * Only what is OFFERED. The server independently refuses a language a
 * business does not hold (loan.Service.StartIndemnityBondSign), so a crafted
 * request gains nothing.
 *
 * All three templates now exist here and in the backend, so a granted
 * language always renders in that language rather than silently falling back
 * to English. Note the Gujarati one is a DIFFERENT DOCUMENT, not a third
 * translation: English and Malayalam are the Kerala promissory-pledge letter,
 * Gujarati is the Gujarat branch's formal deed. See loan.bondHTMLGujarati. */
export function bondLangOptionsFor(languages: string[]): typeof BOND_LANG_OPTIONS {
  const allowed = new Set(languages.length ? languages : ["en"]);
  allowed.add("en");
  return BOND_LANG_OPTIONS.filter((o) => allowed.has(o.value));
}

export type IndemnityBondOrnament = {
  name: string;
  purity?: string;
  grossWeight: number;
  netWeight: number;
  value: number;
};

export type IndemnityBondParty = {
  /* Loan number, or the wizard's provisional id before submission. */
  loanNumber: string;
  name?: string;
  dob?: string;
  address?: string;
  branchName?: string;
  phone?: string;
  pan?: string;
  /* Full 12-digit Aadhaar number — fetched separately via
   * getCustomerAadhaarFull() (GET /customers/:id/aadhaar-full), the one
   * endpoint that decrypts it. Every other customer read stops at
   * AadhaarLast4, so callers must fetch this on demand rather than
   * pulling it off a CustomerView. */
  aadhaar?: string;
  principalAmount?: number;
  interestRate?: number;
  ornaments?: IndemnityBondOrnament[];
  /* Loan due date ("YYYY-MM-DD"), e.g. LoanView.due — fills the "repay the
   * said loan on or before ___" clause below, which previously always
   * rendered as a blank underscore line regardless of the loan's actual
   * due date. */
  dueDate?: string;
};

/* The lender's own signature image (an authorized signatory's captured
 * signature, not a per-loan/customer signature) — stamped on every
 * printed/eSign'd bond next to LENDER_NAME below, same way the packet
 * label's QR code resolves against `location.origin` rather than a
 * relative path (this HTML is written into a blank popup window via
 * openPrintWindow, whose own location is about:blank — a relative src
 * would 404 there). Lives in public/assets so it's served as a plain
 * static file. */
const LENDER_SIGNATURE_URL = () => `${location.origin}/assets/lender-signature.svg`;

const B = "________________";
// These are now the FALLBACK only. The lender's particulars come from the
// business's own tenant profile (set by the vendor in the superadmin
// console, resolved here by tenantLenderProfile) — see printIndemnityBond.
//
// They stay as the fallback rather than being deleted because this
// deployment has been printing them on real customer paperwork; switching a
// live business's agreement to the platform name the moment this shipped
// would be a worse outcome than a stale default. Note the backend's own
// fallback (indemnitybond.go's lenderName) is DIFFERENT — that mismatch is
// exactly what filling in the tenant profile resolves, since both sides then
// read the same source.
const FALLBACK_LENDER_NAME = "Chittilapilly Thommana Financiers and Investments";
const FALLBACK_LENDER_ADDRESS_SHORT = "XXI/118-BLOCK JUNCTION, VELLANGALLUR, 680662";
const FALLBACK_LENDER_KML_REG_NO = "32080354468";

/* The Gujarati deed, unlike the English/Malayalam letter, names the LENDER's
 * own age, Aadhaar and PAN as a party to the contract. These three have no
 * tenant-profile equivalent yet (the superadmin console collects a legal
 * name, address and registration number only), so they are placeholders —
 * and deliberately non-resolvable ones, exactly as the backend's lenderAge/
 * lenderAadhaar/lenderPAN are. Values kept CHARACTER-IDENTICAL to those Go
 * constants so the printed copy and the eSigned PDF cannot disagree. Replace
 * all three with the licensee's real particulars before any Gujarati
 * agreement is executed for real. */
const LENDER_AGE = "—";
const LENDER_AADHAAR = "XXXX XXXX XXXX";
const LENDER_PAN = "AAAAA0000A";

function fmtINR(n?: number) {
  return n != null ? n.toLocaleString("en-IN") : "";
}

function fmtDueDate(dueDate?: string) {
  if (!dueDate) return "";
  const d = new Date(dueDate);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

export function printIndemnityBond(p: IndemnityBondParty, onBlocked: (msg: string) => void, lang: BondLang = "en") {
  // Resolved per call, not at module load: which business is signed in can
  // change within one browser session, and this module is imported once.
  const profile = tenantLenderProfile();
  const LENDER_NAME = profile.legalName || FALLBACK_LENDER_NAME;
  const LENDER_ADDRESS_SHORT = profile.addressLine || FALLBACK_LENDER_ADDRESS_SHORT;
  const LENDER_KML_REG_NO = profile.kmlRegNo || FALLBACK_LENDER_KML_REG_NO;

  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = now.getFullYear();
  const ornaments = p.ornaments ?? [];

  if (lang === "ml") {
    const MONTHS_ABBR = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const dateDisplay = `${dd} ${MONTHS_ABBR[now.getMonth()]} ${yyyy}`;
    const itemNames = ornaments.length ? ornaments.map((o) => o.name).join(", ") : B;
    const itemWeights = ornaments.length ? ornaments.map((o) => `${o.netWeight.toFixed(2)} GM`).join(", ") : B;
    const amount = p.principalAmount;
    const amountWords = amount != null ? numberToIndianWords(amount) : "";

    openPrintWindow(
      LENDER_NAME + " — " + p.loanNumber,
      `<style>
        @page{size:A4;margin:20mm 15mm}
        body{font-family:'Noto Sans Malayalam','Nirmala UI',Georgia,serif}
        .hd-table{border:none;margin-bottom:10px}
        .hd-table td{border:none;padding:2px 0;vertical-align:top}
      </style>
      <h1>${LENDER_NAME}</h1>
      <h2>${LENDER_ADDRESS_SHORT}<br>KML Reg No: ${LENDER_KML_REG_NO}</h2>

      <table class="hd-table">
        <tr>
          <td style="width:50%">ITEM NAME: ${itemNames}<br>ITEM Weight: ${itemWeights}</td>
          <td>Loan No. ${p.loanNumber}<br>Date: ${dateDisplay}</td>
        </tr>
      </table>

      <p>CUSTOMER NAME: ${p.name || B}<br>CUSTOMER MOB NO: ${p.phone || B}</p>
      <p>AMOUNT: ${fmtINR(amount) || B}</p>

      <p>
      ഞാൻ <b>${p.name || B}</b> മുകളിൽ കാണിച്ചിട്ടുള്ള സ്വർണ്ണാഭരണങ്ങൾ എന്റെ സ്വന്തമാണ്. ഇതിന് വേറെ അവകാശികളില്ല. ഈ ആഭരണങ്ങൾ നിങ്ങളുടെ <b>${LENDER_NAME}</b> എന്ന സ്ഥാപനത്തിൽ പണയംസ്വീകരിച്ച് ആഭരണത്തിൻ്റെ മതിപ്പുവിലയായ <b>${fmtINR(amount) || B}</b> രൂപ ( ${amountWords || B} only ) മാസപലിശയ്ക്ക് വായ്‌പയായി തരണമെന്ന് വിനീതമായി അപേക്ഷിക്കുന്നു.
      </p>
      <p>Name: ${p.name || B}<br>Signature: ${B}</p>

      <h3 style="text-align:center;margin-top:30px">വാഗ്‌തദത്തം</h3>

      <p>
      ഞാൻ <b>${p.name || B}</b> വായ്‌പയായി വാങ്ങിയ <b>${fmtINR(amount) || B}</b> രൂപയുടെ പലിശ മാസാമാസം അടച്ചുതീർത്തു കൊള്ളാമെന്നും, ഒരു വർഷത്തിനുള്ളിൽ മുഴുവൻ തുകയും പലിശയും അടച്ചുതീർത്ത് വായ്‌പ അവസാനിപ്പിക്കുമെന്ന് ഉറപ്പുതരുന്നു. ഏതെങ്കിലും കാരണവശാൽ വായ്‌പവാങ്ങിയ പണം പലിശയോടുകൂടി തിരിച്ചടക്കാൻ എനിക്കു സാധിക്കാതെവന്നാൽ നിങ്ങളുടെ <b>${LENDER_NAME}</b> എന്ന സ്ഥാപനത്തിനുവരുന്ന കഷ്ടനഷ്ടങ്ങൾ തീർക്കാൻ, ഈ ആഭരണങ്ങൾ ലേലത്തിൽ വയ്ക്കുകയോ അല്ലെങ്കിൽ വിൽക്കുകയോ ചെയ്ത് സ്ഥാപനത്തിന്റെ നഷ്ടം തീർക്കാൻ സ്ഥാപന ഉടമയ്ക്ക് അവകാശമുണ്ടെന്നും പിന്നീട് ഇതുമായി ഒരു അവകാശവാദവും ഉന്നയിക്കില്ലെന്നും ഞാൻ ഇതിനാൽ വാഗ്ദാനം ചെയ്യുന്നു.
      </p>

      <p>Name: ${p.name || B}<br>Signature: ${B}</p>
      <p style="margin-top:18px"><b>Loan Sanctioned.</b></p>
      <p>Date: ${dateDisplay}</p>

      <hr style="margin-top:40px;border:none;border-top:1px solid #999">
      <p style="margin-top:24px"><b>Signature of the person who receives the jewellery back</b></p>
      <p>കേടുപാടുകളില്ലാതെ ആഭരണങ്ങൾ തിരികെ ലഭിച്ചു</p>
      <p>Date: ${B}<br>Name: ${p.name || B}<br>Signature: ${B}</p>`,
      onBlocked
    );
    return;
  }

  if (lang === "gu") {
    // Locals the deed needs that the two letter templates do not: it names
    // BOTH parties' particulars, not just the borrower's.
    const monthName = now.toLocaleString("gu-IN", { month: "long" });
    // Age from the date of birth on file, blank when there is none — a
    // fabricated age on a document the borrower signs is worse than a gap
    // left for manual completion.
    const age = (() => {
      if (!p.dob) return B;
      const d = new Date(p.dob);
      if (Number.isNaN(d.getTime())) return B;
      let a = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
      return a > 0 ? String(a) : B;
    })();
    const aadhaar = p.aadhaar || B;
    // The deed states the appraised total separately from the amount lent.
    // Same sum the backend computes in renderBondHTML, so the two agree.
    const totalValue = ornaments.reduce((s, o) => s + (o.value ?? 0), 0);

    const rowsGu = ornaments.length
      ? ornaments
          .map(
            (o, i) =>
              `<tr><td>${i + 1}</td><td>${o.name}</td><td>${o.purity || "—"}</td>
              <td class="num">${o.grossWeight.toFixed(1)}</td><td class="num">${o.netWeight.toFixed(1)}</td>
              <td class="num">${fmtINR(o.value)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="6" style="text-align:center;color:#777">${B}</td></tr>`;

    openPrintWindow(
      "ચલ મિલકતનો આડગીરો કરાર — " + p.loanNumber,
      `<style>
        @page{size:A4;margin:35mm 20mm 30mm 20mm}
        /* See the English template's identical body-margin comment above
         * bondHTMLEnglish's own @page rule — same fix, Gujarati template. */
        body{font-family:'Noto Sans Gujarati','Shruti','Nirmala UI',Georgia,serif;margin-top:130px !important;padding-bottom:110px !important}
      </style>
      <h1>ચલ મિલકતનો આડગીરો કરાર</h1>
      <p style="text-align:center;color:#555">ગોલ્ડ લોન એકાઉન્ટ નંબર ${p.loanNumber}</p>
      <p>આ આડગીરો કરાર તારીખ <b>${dd}</b>, માસ <b>${monthName}</b>, વર્ષ <b>${yyyy}</b> ના રોજ નીચેના પક્ષકારો વચ્ચે કરવામાં આવે છે:</p>
      <p>
        <b>${p.name || B}</b><br>
        ઉ.આ.વ. :- <b>${age}</b>, ધંધો:- ${B}<br>
        આધાર કાર્ડ નંબર :- <b>${aadhaar}</b><br>
        પાનકાર્ડ નંબર :- <b>${p.pan || B}</b><br>
        રહે. :- <b>${p.address || B}</b>
      </p>
      <p>( હવેથી આ કરારમાં પહેલા પક્ષને "આડગીરો મૂકનાર", "દેણદાર", "આડમાં મૂકનાર" જેવી સંજ્ઞાઓથી સંબોધવામાં આવશે. )</p>
      <p>અને</p>
      <p>
        <b>${LENDER_NAME}</b><br>
        ઉ.આ.વ. :- <b>${LENDER_AGE}</b>, ધંધો:- <b>${LENDER_NAME}</b><br>
        આધાર કાર્ડ નંબર :- <b>${LENDER_AADHAAR}</b><br>
        પાનકાર્ડ નંબર :- <b>${LENDER_PAN}</b><br>
        રહે. :- <b>${LENDER_ADDRESS_SHORT}</b>
      </p>
      <p>( હવેથી આ કરારમાં બીજા પક્ષને "આડગીરો લેનાર", "નાણાં ધીરનાર", "આડમાં લેનાર" જેવી સંજ્ઞાઓથી સંબોધવામાં આવશે. )</p>
      <p>"આડગીરો મૂકનાર" અને "આડગીરો લેનાર" સંયુક્ત રીતે "પક્ષકારો" તરીકે સંબોધવામાં આવશે.</p>
      <p>આડગીરો લેનાર <b>${p.branchName || B}</b> ગામે નોંધણી પ્રમાણપત્ર નંબર <b>${LENDER_KML_REG_NO}</b> હેઠળ નાણાં ધિરાણનો વ્યવસાય કરે છે.</p>
      <p><b>આથી નીચે મુજબ સંમતિ કરવામાં આવે છે:</b></p>
      <ol>
        <li><b>ચૂકવણી કરવાનો કરાર</b><br>આડમાં લેનાર દ્વારા આડમાં મૂકનારને આપવામાં આવેલ રૂપિયા <b>${fmtINR(p.principalAmount) || B}</b> ના ઋણના બદલામાં, આડમાં મૂકનાર સંમત થાય છે કે, ઉપરોક્ત ઋણ તારીખ ${fmtDueDate(p.dueDate) || B} ના રોજ અથવા તે પહેલાં, આ કરારના અમલની તારીખથી <b>${p.interestRate != null ? p.interestRate + "%" : B}</b> પ્રતિ વર્ષના વ્યાજ સાથે પરત ચૂકવશે.</li>
        <li><b>આડગીરોની જોગવાઈ</b><br>આડમાં લેનારે રૂ. <b>${fmtINR(p.principalAmount) || B}</b> ની રકમ ધિરાણ આપી છે, જેની પ્રાપ્તિ આડમાં મૂકનાર સ્વીકારે છે. આડમાં મૂકનારે પોતાની માલિકીની આ કરારની અનુસૂચિમાં દર્શાવેલી માલ ઉપરોક્ત ઋણની ચૂકવણી કરવા માટે જામીનગીરી તરીકે સુરક્ષા તરીકે આડમાં લેનારને નિક્ષેપ કરેલ છે. આ વસ્તુઓ આ કરારમાં નક્કી કરેલ રીતે આડમાં લેનાર પાસે જામીનગીરી તરીકે રાખવામાં આવશે.
          <ol type="a">
            <li><b>અસાધારણ ખર્ચ અંગે આડમાં લેનારનો હક્ક</b> — આડમાં લેનાર આડમાં મૂકેલા માલની જાળવણી માટે પોતાને થયેલો અસાધારણ ખર્ચ, આડમાં મૂકનાર પાસેથી મેળવવા હક્કદાર રહેશે.</li>
            <li><b>સમારકામનો ખર્ચ</b> — અનુસૂચિમાં દર્શાવેલ માલને સારી સ્થિતિમાં અને યોગ્ય કાર્યક્ષમ સ્થિતિમાં રાખવા માટેના ખર્ચ મેળવવા આડગીરો લેનાર હક્કદાર રહેશે.</li>
            <li><b>અન્ય ખર્ચ</b> — અન્ય તમામ ખર્ચ, ફી અને ખર્ચાઓ (જો કોઈ હોય તો), જેને કાયદા હેઠળ આડગીરો લેનાર પોતાની સુરક્ષા રકમમાં ઉમેરવા માટે હકદાર રહેશે.</li>
          </ol>
        </li>
        <li><b>નુકસાન માટે આડગીરો લેનારની જવાબદારી</b><br>આડગીરો લેનારની કસ્ટડીમાં અનુસૂચિમાં દર્શાવેલ માલને થનારા કોઈપણ અનૈચ્છિક નુકસાન અથવા તેમની વેચાણ પ્રક્રિયાના કારણે થનારા નુકસાન માટે આડગીરો લેનાર આડગીરો આપનાર પ્રત્યે જવાબદાર રહેશે નહીં.</li>
        <li><b>આડગીરો લેનારના અધિકાર</b><br>આ કરાર હેઠળ ચૂકવવાપાત્ર કોઈપણ વ્યાજની રકમ નિયત તારીખથી 30 દિવસની અંદર ચૂકવવામાં નહીં આવે, તો આ કરાર દ્વારા સુરક્ષિત સમગ્ર રકમ તરત જ ચૂકવવાપાત્ર બની જશે. મૂળ રકમ અને તેના પરના વ્યાજની ચૂકવણીમાં કસૂર કરે અથવા આડમાં મૂકનાર આ કરારમાંની કોઈ શરતનું પાલન ન કરે, તો આડમાં મૂકનારને કાયદા હેઠળ આડગીરો લેનાર તરીકે ઉપલબ્ધ કોઈપણ અથવા તમામ ઉપાયો અમલમાં મૂકવાનો અધિકાર રહેશે. આડમાં મૂકનાર વેચાણની ૨ મહિના પહેલા અગાઉથી નોટિસ આપી આડમાં મુકેલ વસ્તુ તે વેચી શકશે.</li>
        <li><b>વેચાણનો અધિકાર</b>
          <ol type="a">
            <li>કાયદા હેઠળ આડ લેનારને મળેલ વેચાણનો અધિકાર જાહેર હરાજી અથવા ખાનગી કરાર દ્વારા, આડમાં લેનારની વિવેકબુદ્ધિ મુજબ, તમામ વસ્તુઓને એક જ લોટમાં અથવા અનેક લોટમાં વેચીને અમલમાં મૂકી શકાય છે.</li>
            <li>ઉપરોક્ત વેચાણનો અધિકાર અમલમાં મૂકતા પહેલાં આડમાં લેનારે આડમાં મૂકનારને ઓછામાં ઓછા બે મહિનાની નોટિસ આપવાની રહેશે.</li>
          </ol>
        </li>
        <li><b>અર્થઘટનની જોગવાઈ</b><br>આથી બંને પક્ષકારો સંમત થાય છે કે આ કરારમાં સમાવિષ્ટ કોઈપણ જોગવાઈને કાયદેસર રીતે શક્ય તેટલી સંપૂર્ણ અસર આપવા માટે જ્યાં આવી વ્યાખ્યા જરૂરી હોય, ત્યાં "આડગીરો લેનાર" અને "આડગીરો મૂકનાર" શબ્દોમાં તેમના સંબંધિત વારસદારો, વહીવટદારો, એક્ઝિક્યુટર્સ, એડમિનિસ્ટ્રેટર્સ અને અધિકાર સોંપવામાં આવેલ વ્યક્તિઓનો પણ સમાવેશ થશે.</li>
      </ol>
      <p style="text-align:center"><b>-:: અનુસૂચિ ::-</b></p>
      <table>
        <thead><tr><th>અનુ.</th><th>વસ્તુનું વર્ણન</th><th>કેરેટ</th><th class="num">કુલ વજન (ગ્રામ)</th><th class="num">ચોખ્ખું વજન (ગ્રામ)</th><th class="num">અંદાજિત કિંમત (રૂ.)</th></tr></thead>
        <tbody>${rowsGu}</tbody>
      </table>
      <p><b>કુલ અંદાજિત રકમ :- રૂ. ${fmtINR(totalValue) || B}/-</b></p>
      <p><b>કુલ ધિરાણ રકમ :- રૂ. ${fmtINR(p.principalAmount) || B}/-</b></p>
      <p>સ્થળ: ${p.branchName || B}</p>
      <p>તારીખ: ${dd} / ${monthName} / ${yyyy}</p>
      <div class="sig">
        <div><span>સાક્ષી<br>નામ: ${B}</span></div>
        <div><span>સાક્ષી<br>નામ: ${B}</span></div>
      </div>
      <div class="sig">
        <div>આડગીરો મૂકનાર<span>નામ: ${p.name || B}</span></div>
        <div>આડગીરો લેનાર<img src="${LENDER_SIGNATURE_URL()}" class="lender-sig" alt="Lender signature" /><span>${LENDER_NAME}</span></div>
      </div>`,
      onBlocked
    );
    return;
  }

  // English translation of the "ml" branch's own letter above (same
  // wording/structure, just in English) — not the old formal "MEMORANDUM
  // OF AGREEMENT... BETWEEN" numbered-clause deed this used to be. See
  // backend/internal/loan/indemnitybond.go's bondTemplate doc comment for
  // why that older document was replaced outright rather than kept
  // alongside this one.
  // Locals the English deed needs (the two letter templates above do not):
  // it names BOTH parties' particulars and prints an appraised total, the
  // same way the Gujarati branch above does — see those locals' comments.
  const monthName = now.toLocaleString("en-IN", { month: "long" });
  const age = (() => {
    if (!p.dob) return B;
    const d = new Date(p.dob);
    if (Number.isNaN(d.getTime())) return B;
    let a = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
    return a > 0 ? String(a) : B;
  })();
  const aadhaar = p.aadhaar || B;
  const totalValue = ornaments.reduce((s, o) => s + (o.value ?? 0), 0);
  const rows = ornaments.length
    ? ornaments
        .map(
          (o, i) =>
            `<tr><td>${i + 1}</td><td>${o.name}</td><td>${o.purity || "—"}</td>
            <td class="num">${o.grossWeight.toFixed(1)}</td><td class="num">${o.netWeight.toFixed(1)}</td>
            <td class="num">${fmtINR(o.value)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center;color:#777">${B}</td></tr>`;

  openPrintWindow(
    LENDER_NAME + " — " + p.loanNumber,
    `<style>
      @page{size:A4;margin:20mm 15mm}
      .hd-table{border:none;margin-bottom:10px}
      .hd-table td{border:none;padding:2px 0;vertical-align:top}
      /* @page above only controls the printable area when the browser's
       * own print-dialog "Margins" setting is left on "Default" — picking
       * "None" there forces the page margin to zero and there is no CSS
       * way to override that browser-level choice once it's picked. Real,
       * content-level body margin/padding (unlike @page) can't be zeroed
       * out that way, so it's the only header/footer space guaranteed to
       * survive regardless of that dropdown — sized to roughly match
       * @page's own 35mm/30mm so the two agree when Margins IS left on
       * Default (in which case this stacks additively with @page rather
       * than replacing it — still fine, just extra breathing room). */
      body{margin-top:130px !important;padding-bottom:110px !important}
    </style>
    <h1>AGREEMENT OF PLEDGE OF MOVABLE</h1>
    <p style="text-align:center;color:#555">Gold Loan Account No. ${p.loanNumber}</p>
    <p>MEMORANDUM OF AGREEMENT, made the <b>${dd}</b> day of <b>${monthName}, ${yyyy}</b> BETWEEN</p>
    <p>
      <b>${p.name || B}</b><br>
      Age :- <b>${age}</b>, business :- ${B}<br>
      Aadhar Card No. <b>${aadhaar}</b><br>
      Pan Card No. <b>${p.pan || B}</b><br>
      Residing at :- <b>${p.address || B}</b>
    </p>
    <p>(Hereinafter called "the borrower") of the one part.</p>
    <p>AND</p>
    <p>
      <b>${LENDER_NAME}</b><br>
      Age :- <b>${LENDER_AGE}</b>, business :- <b>${LENDER_NAME}</b><br>
      Aadhar Card No. <b>${LENDER_AADHAAR}</b><br>
      Pan Card No. <b>${LENDER_PAN}</b><br>
      Residing at :- <b>${LENDER_ADDRESS_SHORT}</b>
    </p>
    <p>(Hereinafter called "the lender") of the other part.</p>
    <p>The lender carrying on business of money-lending under certificate of registration number <b>${LENDER_KML_REG_NO}</b> of the other part.</p>
    <p>The Money lender and borrower are collectively referred to as the "Parties".</p>
    <p><b>WHEREBY IT IS AGREED AS FOLLOWS</b></p>
    <ol>
      <li><b>Covenant to pay</b><br>In Consideration of the loan of Rs <b>${fmtINR(p.principalAmount) || B}</b> advance by the lender to the borrower, the borrower hereby covenants with the lender that he will repay the said loan on or before ${fmtDueDate(p.dueDate) || B} with interest at <b>${p.interestRate != null ? p.interestRate + "%" : B}</b> percent per annum from the date of execution of this agreement.</li>
      <li><b>Pledge Clause</b><br>The Lender has lent the sum of Rs <b>${fmtINR(p.principalAmount) || B}</b> (the receipt of which the borrower hereby acknowledges) and borrower has delivered to the lender article belonging to the borrower and specified in the schedule hereto to be held by him as security for the repayment of the aforesaid loan in the manner herein provided,
        <ol type="a">
          <li><b>Right to Extraordinary Expenses</b> — The lender is entitled to receive from the borrower extraordinary expenses incurred by him for the preservation of the good pledged.</li>
          <li><b>Expenses of Repairs</b> — The Expenses of keeping the said articles in a good state of repair and in proper working order.</li>
          <li><b>Other Costs</b> — All other costs, charges and expenses (if any) which the lender may be entitled by law to add to his security.</li>
        </ol>
      </li>
      <li><b>Lender's Liability for Losses</b><br>The Lender shall not be liable to the borrower for any involuntary losses which may occur during his custody of the said articles (goods) or by reason of the sale thereof.</li>
      <li><b>Right of Lender</b><br>The Borrower further covenants with the lender that in case any interest payable hereunder is not paid within 30 days after the due date, the whole sum hereby secured shall become payable at once, and in case of default in the payment of the principal money hereby secured with interest thereon on the aforesaid or in the performance of any of the covenants by the borrower hereinbefore contained the lender may enforce all or any of the remedies of a Pawnee provided by law provided that in case of sale of any part of the pledged property, a previous notice of two months shall be given to the borrower.</li>
      <li><b>Power of Sale</b>
        <ol type="a">
          <li>The power of sale conferred by law on the lender shall be exercisable by public auction or private contract in respect of the entire articles in one lot or in several lots at the discretion of the lender;</li>
          <li>Before exercising such power of sale as aforesaid the lender shall give at least two months' notice to the borrower.</li>
        </ol>
      </li>
      <li><b>Interpretation clause</b><br>It is hereby agreed that wherever such an interpretation would be requisite in order to give the fullest scope and effect legally possible to any covenant herein contained, the expression "the borrower" and "the lender" hereinbefore used include their respective heirs, executors, administrators, and assigns.</li>
    </ol>
    <p><b>The Schedule herein referred to</b></p>
    <table>
      <thead><tr><th>Sr. no</th><th>Description of the Article</th><th>Carat</th><th class="num">Gross Weight</th><th class="num">Net Weight</th><th class="num">Estimated Value</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p><b>Total Estimated Value :- Rs. ${fmtINR(totalValue) || B}/-</b></p>
    <p><b>Total Loan Advanced :- Rs. ${fmtINR(p.principalAmount) || B}/-</b></p>
    <p>Place :- ${p.branchName || B}</p>
    <p>Date :- ${dd} / ${monthName} / ${yyyy}</p>
    <p><b>IN WITNESS WHEREOF Etc.</b></p>
    <div class="sig">
      <div><span>Name: ${B}<br>Residing at</span></div>
      <div><span>Name: ${B}<br>Residing at</span></div>
    </div>
    <div class="sig">
      <div>The Borrower<span>Name: ${p.name || B}</span></div>
      <div>The Lender<img src="${LENDER_SIGNATURE_URL()}" class="lender-sig" alt="Lender signature" /><span>${LENDER_NAME}</span></div>
    </div>`,
    onBlocked
  );
}
