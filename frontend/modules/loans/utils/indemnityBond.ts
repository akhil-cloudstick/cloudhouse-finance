import { openPrintWindow } from "@/common/utils/print";

/* Printable Agreement of Pledge of Movable — the branch's standard pledge
 * deed, replacing the old indemnity bond. Lives here rather than inside
 * NewLoan.tsx because it is needed at two different points in a loan's
 * life: before submission (the New Loan wizard's print button) and
 * afterwards from Loan Details, where staff re-print it for offline
 * wet-ink signing whenever Aadhaar eSign is not used or not available.
 *
 * Every field is optional — the wizard calls this against an unsaved draft
 * whose customer details may still be blank, and a blank renders as the
 * underscore rule a signer fills in by hand. English only: the branch's
 * paper form (and the eSign copy sent to Setu) has never been translated,
 * unlike the old indemnity bond. */
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

function fmtINR(n?: number) {
  return n != null ? n.toLocaleString("en-IN") : "";
}

export function printIndemnityBond(p: IndemnityBondParty, onBlocked: (msg: string) => void) {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const monthName = now.toLocaleString("en-IN", { month: "long" });
  const yyyy = now.getFullYear();
  const age = p.dob ? Math.floor((now.getTime() - new Date(p.dob).getTime()) / 31557600000) : "____";
  const aadhaar = p.aadhaar || B;
  const ornaments = p.ornaments ?? [];
  const totalValue = ornaments.reduce((s, o) => s + (o.value || 0), 0);

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
      Age :- ${B}, business :- ${B}<br>
      Aadhar Card No. ${B}<br>
      Pan Card No. ${B}<br>
      Residing at :- ${B}
    </p>
    <p>(Hereinafter called "the lander") of the other part.</p>
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
      <li><b>Lender's Liability for Losses</b><br>The Lander shall not liable to the borrower for any involuntary losses which may occur during his custody of the said articles (goods) or by reason of the sale thereof.</li>
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
      <div>The Lander<span>${LENDER_NAME}</span></div>
    </div>
    <p style="margin-top:20px"><b>IN WITNESS WHEREOF Etc.</b></p>
    <div class="sig">
      <div><span>Name: ${B}<br>Residing at</span></div>
      <div><span>Name: ${B}<br>Residing at</span></div>
    </div>`,
    onBlocked
  );
}
