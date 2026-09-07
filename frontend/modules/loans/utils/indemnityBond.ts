import { openPrintWindow } from "@/common/utils/print";

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
 * Two languages: English (the original branch paper form) and Gujarati
 * (ચલ મિલકતનો આડગીરો કરાર — the branch's Gujarati form), same clause
 * structure and field set in both, mirroring backend/internal/loan/
 * indemnitybond.go's bondHTMLEnglish/bondHTMLGujarati so the printed paper
 * copy and the PDF sent to Setu for eSign read identically. */
export type BondLang = "en" | "gu";

/* Shared label set — same two options wherever a bond-language picker
 * appears (NewLoan.tsx's print toggle, LoanDetail.tsx's eSign modal). */
export const BOND_LANG_OPTIONS: { value: BondLang; label: string; native: string }[] = [
  { value: "en", label: "English", native: "Indemnity Bond" },
  { value: "gu", label: "Gujarati", native: "ચલ મિલકતનો આડગીરો કરાર" },
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
const LENDER_NAME = "Rinkesh Lalitbhai Soni";
const LENDER_REG_NO = "GMLVAL2627000029";
const LENDER_AGE = "22";
const LENDER_BUSINESS = "Rinkesh Lalitbhai Soni";
const LENDER_AADHAAR = "415534095954";
const LENDER_PAN = "KQMPS7359E";
const LENDER_ADDRESS = "At post Khattalwada, Main Bazar, Tal. Umargam, Dist. Valsad, State Gujarat, PIN code 396120";

function fmtINR(n?: number) {
  return n != null ? n.toLocaleString("en-IN") : "";
}

export function printIndemnityBond(p: IndemnityBondParty, onBlocked: (msg: string) => void, lang: BondLang = "en") {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const yyyy = now.getFullYear();
  const monthName = now.toLocaleString(lang === "gu" ? "gu-IN" : "en-IN", { month: "long" });
  const age = p.dob ? Math.floor((now.getTime() - new Date(p.dob).getTime()) / 31557600000) : "____";
  const aadhaar = p.aadhaar || B;
  const ornaments = p.ornaments ?? [];
  const totalValue = ornaments.reduce((s, o) => s + (o.value || 0), 0);

  if (lang === "gu") {
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
        body{font-family:'Noto Sans Gujarati','Shruti','Nirmala UI',Georgia,serif}
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
        ઉ.આ.વ. :- <b>${LENDER_AGE}</b>, ધંધો:- <b>${LENDER_BUSINESS}</b><br>
        આધાર કાર્ડ નંબર :- <b>${LENDER_AADHAAR}</b><br>
        પાનકાર્ડ નંબર :- <b>${LENDER_PAN}</b><br>
        રહે. :- <b>${LENDER_ADDRESS}</b>
      </p>
      <p>( હવેથી આ કરારમાં બીજા પક્ષને "આડગીરો લેનાર", "નાણાં ધીરનાર", "આડમાં લેનાર" જેવી સંજ્ઞાઓથી સંબોધવામાં આવશે. )</p>
      <p>"આડગીરો મૂકનાર" અને "આડગીરો લેનાર" સંયુક્ત રીતે "પક્ષકારો" તરીકે સંબોધવામાં આવશે.</p>
      <p>આડગીરો લેનાર <b>${p.branchName || B}</b> ગામે નોંધણી પ્રમાણપત્ર નંબર <b>${LENDER_REG_NO}</b> હેઠળ નાણાં ધિરાણનો વ્યવસાય કરે છે.</p>
      <p><b>આથી નીચે મુજબ સંમતિ કરવામાં આવે છે:</b></p>
      <ol>
        <li><b>ચૂકવણી કરવાનો કરાર</b><br>આડમાં લેનાર દ્વારા આડમાં મૂકનારને આપવામાં આવેલ રૂપિયા <b>${fmtINR(p.principalAmount) || B}</b> ના ઋણના બદલામાં, આડમાં મૂકનાર સંમત થાય છે કે, ઉપરોક્ત ઋણ તારીખ ${B} ના રોજ અથવા તે પહેલાં, આ કરારના અમલની તારીખથી <b>${p.interestRate != null ? p.interestRate + "%" : B}</b> પ્રતિ વર્ષના વ્યાજ સાથે પરત ચૂકવશે.</li>
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
        <div>આડગીરો મૂકનાર<span>નામ: ${p.name || B}</span></div>
        <div>આડગીરો લેનાર<span>${LENDER_NAME}</span></div>
      </div>
      <div class="sig">
        <div><span>સાક્ષી<br>નામ: ${B}</span></div>
        <div><span>સાક્ષી<br>નામ: ${B}</span></div>
      </div>`,
      onBlocked
    );
    return;
  }

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
    "Agreement of Pledge of Movable — " + p.loanNumber,
    `<style>
      /* A4, with generous top/bottom margins reserving blank header/footer
       * space on every printed page (e.g. for a pre-printed letterhead) —
       * bond-only, doesn't touch the slip/statement's own page setup. */
      @page{size:A4;margin:35mm 20mm 30mm 20mm}
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
      Age :- <b>${LENDER_AGE}</b>, business :- <b>${LENDER_BUSINESS}</b><br>
      Aadhar Card No. <b>${LENDER_AADHAAR}</b><br>
      Pan Card No. <b>${LENDER_PAN}</b><br>
      Residing at :- <b>${LENDER_ADDRESS}</b>
    </p>
    <p>(Hereinafter called "the lender") of the other part.</p>
    <p>The lender carrying on business of money-lending under certificate of registration number <b>${LENDER_REG_NO}</b> of the other part.</p>
    <p>The Money lender and borrower are collectively referred to as the "Parties".</p>
    <p><b>WHEREBY IT IS AGREED AS FOLLOWS</b></p>
    <ol>
      <li><b>Covenant to pay</b><br>In Consideration of the loan of Rs <b>${fmtINR(p.principalAmount) || B}</b> advance by the lender to the borrower, the borrower hereby covenants with the lender that he will repay the said loan on or before ${B} with interest at <b>${p.interestRate != null ? p.interestRate + "%" : B}</b> percent per annum from the date of execution of this agreement.</li>
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
    <div class="sig">
      <div>The Borrower<span>Name: ${p.name || B}</span></div>
      <div>The Lender<span>${LENDER_NAME}</span></div>
    </div>
    <p style="margin-top:20px"><b>IN WITNESS WHEREOF Etc.</b></p>
    <div class="sig">
      <div><span>Name: ${B}<br>Residing at</span></div>
      <div><span>Name: ${B}<br>Residing at</span></div>
    </div>`,
    onBlocked
  );
}
