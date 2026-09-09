import { openPrintWindow } from "@/common/utils/print";
import { numberToIndianWords } from "@/common/utils/numberToWords";
import { parsePurity } from "@/common/utils/purity";

/* Printable "FORM 7" gold-loan discharge receipt — generated once a loan
 * has actually closed (l.status === "Closed", i.e. after CompleteRelease
 * has run), so staff and the customer both have a signable record that the
 * gold was handed back safe and sound. Wording/layout is transcribed
 * verbatim from the branch's own actual reference Form 7 (a filled
 * specimen for Loan No. A157, "ASHOKAN P V"), parameterized here for the
 * current loan/customer — same establishment identity as indemnityBond.ts
 * (Chittilapilly Thommana Financiers and Investments, MLL No.
 * 32080354468). Mirrors indemnityBond.ts's client-side print-window
 * pattern rather than a backend-rendered PDF — no new document infra
 * needed for one more document type.
 *
 * Two languages, same field-for-field layout in both — English (the
 * branch's own reference form, verbatim) and Malayalam (a translation of
 * the same form, not a different document), same convention as
 * indemnityBond.ts's en/ml bond letter. */
export type ReleaseAgreementLang = "en" | "ml";

export type ReleaseAgreementOrnament = {
  name: string;
  purity?: string; // "22K" | "91.6%" — parsed to derive FNWT (fine weight)
  quantity: number;
  grossWeight: number;
  netWeight: number;
  value: number; // valuation at pledge time
};

export type ReleaseAgreementParty = {
  loanNumber: string;
  branchName?: string;
  customerName?: string;
  customerAddress?: string;
  customerCareOf?: string; // "c/o <guardian/relative name>", if on file
  /* Date the loan was originally opened/disbursed — "has borrowed money
   * ... on date <borrowedDate>". */
  borrowedDate?: string; // "YYYY-MM-DD"
  borrowedAmount?: number; // principal
  /* Date the loan was actually repaid/settled and gold released — the
   * release request's decidedAt, or today if there was no formal request
   * (e.g. paid off in full and closed directly). */
  returnedDate?: string; // "YYYY-MM-DD"
  returnedAmount?: number; // total paid to close the loan
  totalInterest?: number;
  ornaments?: ReleaseAgreementOrnament[];
};

const B = "________________";
// Same establishment identity as indemnityBond.ts's LENDER_NAME/
// LENDER_REG_NO and backend/internal/loan/indemnitybond.go's lenderName/
// lenderKMLRegNo.
const LENDER_NAME = "CHITTILAPILLY THOMMANA FINANCIERS AND INVESTMENTS";
const LENDER_ADDRESS = "XXI/118 - BLOCK JUNCTION, VELLANGALLUR, 680662";
const LENDER_PHONE = "+919037374004";
const LENDER_EMAIL = "chittilapillythommanafinancier@gmail.com";
const LENDER_KML_REG_NO = "32080354468";

const MONTHS_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const MONTHS_ML = [
  "ജനുവരി", "ഫെബ്രുവരി", "മാർച്ച്", "ഏപ്രിൽ", "മേയ്", "ജൂൺ",
  "ജൂലൈ", "ഓഗസ്റ്റ്", "സെപ്റ്റംബർ", "ഒക്ടോബർ", "നവംബർ", "ഡിസംബർ",
];

function fmtDate(iso: string | undefined, lang: ReleaseAgreementLang) {
  if (!iso) return B;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return B;
  const months = lang === "ml" ? MONTHS_ML : MONTHS_EN;
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtAmount(n?: number) {
  return n != null ? n.toLocaleString("en-IN") : B;
}

/* Fine weight (FNWT) — net weight × purity fraction (the actual pure-gold
 * content), computed client-side same as loan/purity.go's karat/24 or
 * fineness/100 ratio; not a separately stored field on Ornament. */
function fineWeight(netWeight: number, purity?: string): number {
  const parsed = purity ? parsePurity(purity) : null;
  if (!parsed) return netWeight;
  const fraction = parsed.unit === "karat" ? parsed.value / 24 : parsed.value / 100;
  return netWeight * fraction;
}

const SHARED_STYLE = `
  @page{size:A4;margin:18mm 15mm}
  body{font-family:'Mona Sans','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5}
  h1{font-size:20px;letter-spacing:2px;margin:0 0 16px}
  p{margin:8px 0}
  .hd-table{border:none;margin-bottom:10px}
  .hd-table td{border:none;padding:0;vertical-align:top}
  .amt-table{width:auto;margin-left:auto;border:none;margin-top:6px}
  .amt-table td{border:none;padding:1px 0 1px 24px}
  .amt-table td:first-child{padding-left:0}
  table:not(.hd-table):not(.amt-table){margin-top:14px}
  table:not(.hd-table):not(.amt-table) th{background:#ececec;font-size:12px}
  .terms{font-size:11px;color:#444;margin-top:16px}
  .sig-row{display:flex;justify-content:space-between;margin-top:44px}
  .sig-row div{text-align:left}
  .sig-line{display:inline-block;border-top:1px solid #333;padding-top:4px;min-width:170px;margin-top:34px}
`;

const MALAYALAM_FONT_STYLE = `body{font-family:'Noto Sans Malayalam','Nirmala UI','Mona Sans','Segoe UI',ui-sans-serif,system-ui,sans-serif}`;

export function printReleaseAgreement(p: ReleaseAgreementParty, onBlocked: (msg: string) => void, lang: ReleaseAgreementLang = "en") {
  const today = new Date().toISOString();
  const returnedDate = fmtDate(p.returnedDate || today, lang);
  const borrowedDate = fmtDate(p.borrowedDate, lang);
  const ornaments = p.ornaments ?? [];
  const totalAmount = p.returnedAmount;
  const amountWords = totalAmount != null ? numberToIndianWords(totalAmount) : "";

  if (lang === "ml") {
    const rows = ornaments.length
      ? ornaments
          .map(
            (o) =>
              `<tr><td>${o.name}</td><td class="num">${o.quantity}</td><td>സ്വർണ്ണം</td>
              <td class="num">${o.grossWeight.toFixed(2)} GM</td><td class="num">${o.netWeight.toFixed(2)} GM</td>
              <td class="num">${fineWeight(o.netWeight, o.purity).toFixed(2)} GM</td><td class="num">${fmtAmount(o.value)}</td></tr>`
          )
          .join("")
      : `<tr><td colspan="7" style="text-align:center;color:#777">${B}</td></tr>`;

    const customerLine = [
      p.customerName ? `ഉപഭോക്താവ് <b>${p.customerName}</b>` : `ഉപഭോക്താവ് <b>${B}</b>`,
      p.customerCareOf ? `c/o <b>${p.customerCareOf}</b>` : "",
      p.customerAddress ? `വിലാസം <b>${p.customerAddress}</b>` : "",
    ]
      .filter(Boolean)
      .join(" ");

    openPrintWindow(
      "FORM 7 — Release — " + p.loanNumber,
      `<style>${SHARED_STYLE}${MALAYALAM_FONT_STYLE}</style>
      <h1>FORM 7</h1>
      <table class="hd-table">
        <tr>
          <td style="width:65%">
            <b style="font-size:15px">${LENDER_NAME}</b><br>
            ${LENDER_ADDRESS}<br>
            PHONE: ${LENDER_PHONE} &nbsp; EMAIL: ${LENDER_EMAIL}<br>
            KML Reg No: ${LENDER_KML_REG_NO}
          </td>
          <td style="text-align:right">
            <b>സ്വർണ്ണ വായ്പ</b><br>
            തിയ്യതി: ${returnedDate}
          </td>
        </tr>
      </table>
      <p><b>ക്രമ നമ്പർ:</b> ${p.loanNumber}</p>

      <p>
        ${customerLine} <b>${fmtAmount(p.borrowedAmount)}</b> രൂപ <b>${borrowedDate}</b> തിയ്യതി വായ്പയായി വാങ്ങിയിട്ടുണ്ട്.
        ഉപഭോക്താവ് <b>${fmtAmount(p.returnedAmount)}</b> രൂപ <b>${returnedDate}</b> തിയ്യതി തിരികെ അടച്ചിട്ടുണ്ട്.
      </p>

      <table class="amt-table">
        <tr><td><b>മുതൽ തുക:</b></td><td class="num">${fmtAmount(p.borrowedAmount)}/-</td></tr>
        <tr><td><b>മൊത്തം പലിശ:</b></td><td class="num">${fmtAmount(p.totalInterest)}/-</td></tr>
        <tr><td><b>ആകെ തുക:</b></td><td class="num">${fmtAmount(totalAmount)}/-</td></tr>
      </table>
      <p>(${totalAmount != null ? amountWords + " മാത്രം" : B})</p>

      <table>
        <thead><tr><th>ഇനത്തിന്റെ പേര്</th><th class="num">എണ്ണം</th><th>ലോഹം</th><th class="num">GSWT</th><th class="num">NTWT</th><th class="num">FNWT</th><th class="num">വിലയിരുത്തൽ</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>

      <p class="terms">
        <b>നിബന്ധനകൾ:</b> ഈ ആഭരണങ്ങൾ പരിശോധിച്ച് തൂക്കം കൃത്യമാണെന്ന് ഉറപ്പുവരുത്തിയ ശേഷം മാത്രം ഒപ്പ് വെക്കുക.
        ഒപ്പ് വെച്ചതിനുശേഷം ഉള്ള ഏതെങ്കിലും അവകാശവാദം സ്വീകരിക്കുന്നതല്ല.
      </p>

      <p style="margin-top:20px">വിരൽ അടയാളം</p>

      <div class="sig-row">
        <div><span class="sig-line">&nbsp;</span><br>ഉപഭോക്താവിന്റെ ഒപ്പ്</div>
        <div><span class="sig-line">&nbsp;</span><br>സാക്ഷി</div>
      </div>
      <div class="sig-row">
        <div><span class="sig-line">&nbsp;</span><br>ഉടമയുടെ ഒപ്പ്</div>
      </div>`,
      onBlocked
    );
    return;
  }

  const rows = ornaments.length
    ? ornaments
        .map(
          (o) =>
            `<tr><td>${o.name}</td><td class="num">${o.quantity}</td><td>Gold</td>
            <td class="num">${o.grossWeight.toFixed(2)} GM</td><td class="num">${o.netWeight.toFixed(2)} GM</td>
            <td class="num">${fineWeight(o.netWeight, o.purity).toFixed(2)} GM</td><td class="num">${fmtAmount(o.value)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="7" style="text-align:center;color:#777">${B}</td></tr>`;

  const customerLine = [
    p.customerName ? `Customer <b>${p.customerName}</b>` : `Customer <b>${B}</b>`,
    p.customerCareOf ? `c/o <b>${p.customerCareOf}</b>` : "",
    p.customerAddress ? `address <b>${p.customerAddress}</b>` : "",
  ]
    .filter(Boolean)
    .join(" ");

  openPrintWindow(
    "Form 7 — Release — " + p.loanNumber,
    `<style>${SHARED_STYLE}</style>
    <h1>FORM 7</h1>
    <table class="hd-table">
      <tr>
        <td style="width:65%">
          <b style="font-size:15px">${LENDER_NAME}</b><br>
          ${LENDER_ADDRESS}<br>
          PHONE: ${LENDER_PHONE} &nbsp; EMAIL: ${LENDER_EMAIL}<br>
          KML Reg No: ${LENDER_KML_REG_NO}
        </td>
        <td style="text-align:right">
          <b>GOLD LOAN</b><br>
          DATE: ${returnedDate}
        </td>
      </tr>
    </table>
    <p><b>S. NO.</b> ${p.loanNumber}</p>

    <p>
      ${customerLine} has borrowed money Rs. <b>${fmtAmount(p.borrowedAmount)}</b> on date <b>${borrowedDate}</b>.
      Customer has returned Rs. <b>${fmtAmount(p.returnedAmount)}</b> on date <b>${returnedDate}</b>.
    </p>

    <table class="amt-table">
      <tr><td><b>PRINCIPAL AMOUNT:</b></td><td class="num">${fmtAmount(p.borrowedAmount)}/-</td></tr>
      <tr><td><b>TOTAL INTEREST:</b></td><td class="num">${fmtAmount(p.totalInterest)}/-</td></tr>
      <tr><td><b>TOTAL AMOUNT:</b></td><td class="num">${fmtAmount(totalAmount)}/-</td></tr>
    </table>
    <p>(${totalAmount != null ? amountWords + " Only" : B})</p>

    <table>
      <thead><tr><th>Item Name</th><th class="num">Qty</th><th>Metal type</th><th class="num">GSWT</th><th class="num">NTWT</th><th class="num">FNWT</th><th class="num">Valuation</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <p class="terms">
      <b>Terms &amp; Conditions:</b> ഈ ആഭരണങ്ങൾ പരിശോധിച്ച് തൂക്കം കൃത്യമാണെന്ന് ഉറപ്പുവരുത്തിയ ശേഷം മാത്രം ഒപ്പ് വെക്കുക.
      ഒപ്പ് വെച്ചതിനുശേഷം ഉള്ള ഏതെങ്കിലും അവകാശവാദം സ്വീകരിക്കുന്നതല്ല.
    </p>

    <p style="margin-top:20px">FINGER RING</p>

    <div class="sig-row">
      <div><span class="sig-line">&nbsp;</span><br>CUSTOMER SIGNATURE</div>
      <div><span class="sig-line">&nbsp;</span><br>Witness</div>
    </div>
    <div class="sig-row">
      <div><span class="sig-line">&nbsp;</span><br>OWNER SIGNATURE</div>
    </div>`,
    onBlocked
  );
}
