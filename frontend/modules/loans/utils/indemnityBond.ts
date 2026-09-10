import { openPrintWindow } from "@/common/utils/print";
import { numberToIndianWords } from "@/common/utils/numberToWords";

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
export type BondLang = "en" | "ml";

/* Shared label set — same two options wherever a bond-language picker
 * appears (NewLoan.tsx's print toggle, LoanDetail.tsx's eSign modal). */
export const BOND_LANG_OPTIONS: { value: BondLang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "Indemnity Bond" },
  { value: "ml", label: "Malayalam", native: "ആഭരണ പണയ കരാർ" },
];

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
};

const B = "________________";
// Same establishment identity as backend/internal/loan/indemnitybond.go's
// lenderName/lenderAddressShort/lenderKMLRegNo — MLL No. 32080354468,
// registered as "Chittilapilly Thommana Financiers and Investments",
// verbatim from the branch's own reference letter ("XXI/118-BLOCK
// JUNCTION, VELLANGALLUR, 680662" / "KML Reg No:32080354468"). No
// individual proprietor's personal age/Aadhaar/PAN is on file for this
// document — the reference letter identifies the lender by ESTABLISHMENT
// only, so neither language branch below asks for those fields.
const LENDER_NAME = "Chittilapilly Thommana Financiers and Investments";
const LENDER_ADDRESS_SHORT = "XXI/118-BLOCK JUNCTION, VELLANGALLUR, 680662";
const LENDER_KML_REG_NO = "32080354468";

function fmtINR(n?: number) {
  return n != null ? n.toLocaleString("en-IN") : "";
}

export function printIndemnityBond(p: IndemnityBondParty, onBlocked: (msg: string) => void, lang: BondLang = "en") {
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

  // English translation of the "ml" branch's own letter above (same
  // wording/structure, just in English) — not the old formal "MEMORANDUM
  // OF AGREEMENT... BETWEEN" numbered-clause deed this used to be. See
  // backend/internal/loan/indemnitybond.go's bondTemplate doc comment for
  // why that older document was replaced outright rather than kept
  // alongside this one.
  const MONTHS_ABBR_EN = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const dateDisplayEn = `${dd} ${MONTHS_ABBR_EN[now.getMonth()]} ${yyyy}`;
  const itemNamesEn = ornaments.length ? ornaments.map((o) => o.name).join(", ") : B;
  const itemWeightsEn = ornaments.length ? ornaments.map((o) => `${o.netWeight.toFixed(2)} GM`).join(", ") : B;
  const amountEn = p.principalAmount;
  const amountWordsEn = amountEn != null ? numberToIndianWords(amountEn) : "";

  openPrintWindow(
    LENDER_NAME + " — " + p.loanNumber,
    `<style>
      @page{size:A4;margin:20mm 15mm}
      .hd-table{border:none;margin-bottom:10px}
      .hd-table td{border:none;padding:2px 0;vertical-align:top}
    </style>
    <h1>${LENDER_NAME}</h1>
    <h2>${LENDER_ADDRESS_SHORT}<br>KML Reg No: ${LENDER_KML_REG_NO}</h2>

    <table class="hd-table">
      <tr>
        <td style="width:50%">ITEM NAME: ${itemNamesEn}<br>ITEM Weight: ${itemWeightsEn}</td>
        <td>Loan No. ${p.loanNumber}<br>Date: ${dateDisplayEn}</td>
      </tr>
    </table>

    <p>CUSTOMER NAME: ${p.name || B}<br>CUSTOMER MOB NO: ${p.phone || B}</p>
    <p>AMOUNT: ${fmtINR(amountEn) || B}</p>

    <p>
    I, <b>${p.name || B}</b>, declare that the gold ornaments shown above are my own property and no one else has any claim to them. I have pledged these ornaments with your establishment, <b>${LENDER_NAME}</b>, and hereby humbly request that a loan of Rs. <b>${fmtINR(amountEn) || B}</b> ( ${amountWordsEn || B} only ), equal to the appraised value of the ornaments, be granted to me at monthly interest.
    </p>
    <p>Name: ${p.name || B}<br>Signature: ${B}</p>

    <h3 style="text-align:center;margin-top:30px">DECLARATION</h3>

    <p>
    I, <b>${p.name || B}</b>, undertake to pay the interest on the loan of Rs. <b>${fmtINR(amountEn) || B}</b> availed by me every month without fail, and assure that I will close the loan by repaying the full amount along with interest within one year. If for any reason I am unable to repay the borrowed money with interest, I hereby agree that the owner of <b>${LENDER_NAME}</b> shall have the right to auction or sell these ornaments to recover any loss incurred by the establishment, and that I will not raise any claim regarding this thereafter.
    </p>

    <p>Name: ${p.name || B}<br>Signature: ${B}</p>
    <p style="margin-top:18px"><b>Loan Sanctioned.</b></p>
    <p>Date: ${dateDisplayEn}</p>

    <hr style="margin-top:40px;border:none;border-top:1px solid #999">
    <p style="margin-top:24px"><b>Signature of the person who receives the jewellery back</b></p>
    <p>Ornaments received back without any damage.</p>
    <p>Date: ${B}<br>Name: ${p.name || B}<br>Signature: ${B}</p>`,
    onBlocked
  );
}
