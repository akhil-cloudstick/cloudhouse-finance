import { openPrintWindow } from "@/common/utils/print";

/* Printable "Acknowledgment of Safe Receipt and Release of Pledged Gold" —
 * generated once a loan has actually closed (l.status === "Closed", i.e.
 * after CompleteRelease has run), so staff and the customer both have a
 * signable record that the gold was handed back safe and sound. Wording is
 * exactly what was supplied for this form — a generic, RBI-regulation-era
 * release acknowledgment, not tied to any one lender's paperwork the way
 * indemnityBond.ts's Gujarati pledge deed is. Mirrors indemnityBond.ts's
 * client-side print-window pattern rather than a backend-rendered PDF —
 * no new document infra needed for one more document type.
 *
 * Every field is optional/defaulted the same way indemnityBond.ts treats
 * a blank field: an underscore rule the signer fills in by hand. */
export type ReleaseAgreementOrnament = {
  name: string;
  purity?: string;
  quantity: number;
  grossWeight: number;
  netWeight: number;
};

export type ReleaseAgreementParty = {
  loanNumber: string;
  branchName?: string;
  branchCode?: string;
  customerName?: string;
  customerAddress?: string;
  customerId?: string;
  aadhaarLast4?: string;
  pan?: string;
  /* Date the loan was actually repaid/settled — the release request's
   * decidedAt, or today if there was no formal request (e.g. paid off in
   * full and closed directly). */
  closedOn?: string; // "YYYY-MM-DD"
  ornaments?: ReleaseAgreementOrnament[];
};

const B = "________________";
const LENDER_NAME = "Rinkesh Lalitbhai Soni";
const LENDER_REG_NO = "GMLVAL2627000029";

function fmtDate(iso?: string) {
  if (!iso) return B;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return B;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function printReleaseAgreement(p: ReleaseAgreementParty, onBlocked: (msg: string) => void) {
  const today = new Date();
  const deliveryDate = fmtDate(today.toISOString());
  const closureDate = fmtDate(p.closedOn) || deliveryDate;
  const ornaments = p.ornaments ?? [];

  const totalQty = ornaments.reduce((s, o) => s + (o.quantity || 0), 0);
  const totalGross = ornaments.reduce((s, o) => s + (o.grossWeight || 0) * (o.quantity || 1), 0);
  const totalNet = ornaments.reduce((s, o) => s + (o.netWeight || 0) * (o.quantity || 1), 0);

  const rows = ornaments.length
    ? ornaments
        .map(
          (o, i) =>
            `<tr><td>${i + 1}</td><td>${o.name}</td><td class="num">${o.quantity}</td>
            <td class="num">${o.grossWeight.toFixed(2)}</td><td class="num">${o.netWeight.toFixed(2)}</td>
            <td>${o.purity || "—"}</td><td>Sound / Intact</td></tr>`
        )
        .join("")
    : `<tr><td colspan="7" style="text-align:center;color:#777">${B}</td></tr>`;

  const customerIdLine = [p.customerId, p.aadhaarLast4 ? `Aadhaar •••• ${p.aadhaarLast4}` : "", p.pan]
    .filter(Boolean)
    .join(" · ") || B;

  openPrintWindow(
    "Release Agreement — " + p.loanNumber,
    `<style>
      @page{size:A4;margin:30mm 20mm 25mm 20mm}
    </style>
    <h1>ACKNOWLEDGMENT OF SAFE RECEIPT AND RELEASE OF PLEDGED GOLD</h1>
    <p><b>Loan Account Number:</b> ${p.loanNumber}<br>
    <b>Branch Name/Code:</b> ${p.branchName || B}${p.branchCode ? " / " + p.branchCode : ""}<br>
    <b>Lender Name:</b> ${LENDER_NAME} (Reg. No. ${LENDER_REG_NO})<br>
    <b>Borrower Name:</b> ${p.customerName || B}<br>
    <b>Customer ID / Aadhaar / PAN:</b> ${customerIdLine}</p>

    <h2 style="text-align:left;font-weight:bold;font-size:15px;margin-top:22px">PART A: LENDER DISCHARGE DECLARATION</h2>
    <p class="muted">(To be filled by the NBFC)</p>
    <p>We confirm that Loan Account No. <b>${p.loanNumber}</b> availed by Sri/Smt. <b>${p.customerName || B}</b> has been fully repaid and settled on <b>${closureDate}</b>. The pledged collateral detailed below has been unsealed and delivered to the borrower on <b>${deliveryDate}</b>.</p>

    <p><b>Details of Released Collateral:</b></p>
    <table>
      <thead><tr><th>Item No.</th><th>Description of Ornaments</th><th class="num">Quantity</th><th class="num">Gross Wt. (g)</th><th class="num">Net Wt. (g)</th><th>Purity (K)</th><th>Condition</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="2"><b>Total</b></td><td class="num"><b>${totalQty}</b></td><td class="num"><b>${totalGross.toFixed(2)}</b></td><td class="num"><b>${totalNet.toFixed(2)}</b></td><td></td><td></td></tr></tfoot>
    </table>

    <h2 style="text-align:left;font-weight:bold;font-size:15px;margin-top:22px">PART B: BORROWER ACKNOWLEDGMENT</h2>
    <p class="muted">(To be signed by the Borrower)</p>
    <p>I, <b>${p.customerName || B}</b>, residing at <b>${p.customerAddress || B}</b>, hereby acknowledge and declare that:</p>
    <ol>
      <li>I have physically inspected and weighed all the gold items listed above in the presence of the branch official(s).</li>
      <li>The returned ornaments match the exact item description, weight, and purity specified in my original Pledge Receipt / Valuation Certificate.</li>
      <li>I have received all items intact and in satisfactory condition, with no damage, loss, or substitution.</li>
      <li>By signing this document, I confirm full receipt of my pledged collateral and release the Lender from any further custodial liability for this loan account.</li>
    </ol>
    <p><b>Date:</b> ${deliveryDate} &nbsp;&nbsp; <b>Place:</b> ${p.branchName || B}</p>
    <div class="sig">
      <div><span>(Signature / Thumb Impression of Borrower)</span></div>
    </div>

    <h2 style="text-align:left;font-weight:bold;font-size:15px;margin-top:22px">PART C: AUTHORIZED SIGNATORY</h2>
    <p>Delivered in the presence of:</p>
    <div class="sig">
      <div><span>Authorized Signatory / Branch Manager<br>(Seal &amp; Branch Stamp)</span></div>
    </div>

    <h2 style="text-align:left;font-weight:bold;font-size:14px;margin-top:26px">Essential Rules Before Signing</h2>
    <ol>
      <li><b>Inspect First, Sign Second:</b> Always weigh and examine the items on the branch scale before signing. Once signed, proving subsequent loss or alteration is legally difficult.</li>
      <li><b>Cross-Reference:</b> Compare the net weight and item descriptions against your original pledge card or assay certificate.</li>
      <li><b>No Blanket Signatures:</b> Never sign a blank or partially pre-filled receipt form.</li>
    </ol>`,
    onBlocked
  );
}
