// Mobile port of frontend/common/utils/print.ts + frontend/modules/loans/
// utils/indemnityBond.ts's document bodies. The web versions open a new
// browser tab and drive window.print() — there's no such thing on mobile,
// so this wraps the same HTML/CSS in Print.printAsync, which raises the
// OS's own print/share sheet directly. Unlike the web versions (which fetch
// the customer separately via getCustomer), everything needed is already on
// the `Loan` the caller has in hand — the backend embeds the full customer/
// scheme/branch rows on every loan response; src/types/loan.ts just didn't
// declare them until now.
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { fmt } from "../lib/format";
import { rupeesInWords } from "../lib/numberToWords";
import { Loan } from "../types/loan";
import { listPackets } from "../api/packets";
import { getCustomerAadhaarFull } from "../api/customers";
import { API_BASE_URL, API_ORIGIN } from "../api/config";
import { getToken } from "../auth/tokenStorage";
import { BRAND, BRAND_PHONES, PRINT_COLORS as C } from "../config/brand";

// Same CSS as openPrintWindow (frontend/common/utils/print.ts) — kept
// byte-for-byte so a printed slip/statement/bond looks the same whichever
// app produced it.
const DOC_STYLE = `
  body{font-family:'Inter','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:${C.ink};margin:40px auto;max-width:760px;line-height:1.55;font-size:14px;padding:0 20px}
  h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
  h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:${C.muted}}
  .brandhead{text-align:center;margin:0 0 20px}
  .brandhead .bh-name{font-family:'Montserrat','Segoe UI',sans-serif;font-size:17px;font-weight:800;letter-spacing:.06em;color:${C.brandDeep}}
  .brandhead .bh-desc{font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:${C.brand};margin-top:3px}
  .brandhead .bh-meta{font-size:10.5px;color:${C.muted};margin-top:5px}
  .brandhead .bh-rule{height:2px;background:${C.accent};width:96px;margin:12px auto 14px}
  .brandhead h2{margin:0}
  table{width:100%;border-collapse:collapse;margin:14px 0}
  th,td{border:1px solid ${C.line};padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
  th{background:${C.tint};color:${C.brandDeep};font-weight:600}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  ol li{margin-bottom:10px;text-align:justify}
  .sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
  .sig div{flex:1;text-align:center}
  .sig span{display:block;border-top:1px solid ${C.ink};padding-top:6px;margin-top:44px;font-size:12.5px}
  .muted{color:${C.muted};font-size:12.5px}
`;

/** Mirrors brandHeader() in frontend/common/utils/print.ts. */
function brandHeader(docTitle?: string): string {
  return `<header class="brandhead">
    <div class="bh-name">${BRAND.legalName.toUpperCase()}</div>
    <div class="bh-desc">${BRAND.descriptor}</div>
    <div class="bh-meta">${BRAND.kmlRegLabel} &nbsp;·&nbsp; ${BRAND_PHONES}</div>
    <div class="bh-rule"></div>
    ${docTitle ? `<h2>${docTitle}</h2>` : ""}
  </header>`;
}

async function printDoc(title: string, body: string) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${DOC_STYLE}</style></head><body>${body}</body></html>`;
  await Print.printAsync({ html });
}

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString("en-IN") : "—";
}

// Ported from frontend/modules/loans/components/LoanDetail.tsx's
// printPledgeSlip.
export async function printPledgeSlip(l: Loan) {
  const c = l.customer;
  const ornaments = l.ornaments ?? [];
  await printDoc(
    `Pledge Slip — ${l.loanNumber}`,
    `${brandHeader("Gold Loan Pledge Slip")}
    <table>
      <tr><th style="width:110px">Loan No</th><td>${l.loanNumber}</td><th style="width:110px">Date</th><td>${fmtDate(new Date().toISOString())}</td></tr>
      <tr><th>Customer</th><td>${c?.name ?? "—"} (${c?.code || c?.id || "—"})</td><th>Phone</th><td>${c?.phone || "—"}</td></tr>
      <tr><th>Address</th><td>${c?.address || "—"}</td><th>Branch</th><td>${l.branch?.name || "—"}</td></tr>
      <tr><th>Scheme</th><td>${l.scheme?.name ?? "—"} @ ${l.scheme?.interestRate ?? "—"}% p.a. (LTV ${l.scheme?.ltvPercent ?? "—"}%)</td>
          <th>Opened</th><td>${fmtDate(l.openedDate)}</td></tr>
    </table>
    <table>
      <thead><tr><th>#</th><th>Ornament</th><th>Purity</th><th class="num">Net Wt (g)</th><th class="num">Qty</th><th class="num">Value</th></tr></thead>
      <tbody>
        ${ornaments
          .map(
            (o, i) =>
              `<tr><td>${i + 1}</td><td>${o.name}</td><td>${o.purity}</td>
              <td class="num">${o.netWeight.toFixed(1)}</td><td class="num">${o.quantity}</td><td class="num">${fmt(o.goldValue)}</td></tr>`
          )
          .join("")}
        <tr><th colspan="3">Total</th><th class="num">${(l.totalNetWeight ?? 0).toFixed(1)}</th><th></th><th class="num">${fmt(l.totalGoldValue ?? 0)}</th></tr>
      </tbody>
    </table>
    <p><b>Principal disbursed: ${fmt(l.principalAmount)}</b> <span class="muted">(eligible amount at pledge time: ${fmt(l.eligibleLoanAmount ?? 0)})</span></p>
    <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`
  );
}

// Ported from frontend/modules/loans/components/LoanDetail.tsx's
// printStatement — same Statement of Account particulars (true account of
// the transaction, amount in words/figures, dates, security, interest
// rate, debtor name/address), plus l.additionalInfo — whatever staff added
// when the loan was created, just carried through here.
export async function printStatement(l: Loan) {
  const c = l.customer;
  const additionalInfo = l.additionalInfo || "";
  const payments = l.payments ?? [];
  const ornaments = l.ornaments ?? [];
  const security = ornaments.length
    ? ornaments.map((o) => `${o.quantity} × ${o.name} (${o.purity}, net ${o.netWeight.toFixed(1)}g)`).join("; ") +
      ` — total net weight ${(l.totalNetWeight ?? 0).toFixed(1)} g`
    : "—";
  const rows = payments.length
    ? payments
        .map((p) => {
          const isCash = p.type !== "Adjustment" && p.type !== "Waiver";
          const breakdown = [
            p.processingFeeApplied > 0 && `Fee ${fmt(p.processingFeeApplied)}`,
            p.penalInterestApplied > 0 && `Penal ${fmt(p.penalInterestApplied)}`,
            p.interestApplied > 0 && `Interest ${fmt(p.interestApplied)}`,
            p.principalApplied > 0 && `Principal ${fmt(p.principalApplied)}`,
          ]
            .filter(Boolean)
            .join(" · ");
          return `<tr>
            <td>${fmtDate(p.paidOn)}</td>
            <td>${p.type}${p.description ? " — " + p.description : ""}${breakdown ? `<br><span class="muted">${breakdown}</span>` : ""}</td>
            <td>${isCash ? p.method || "—" : "Non-cash"}</td>
            <td>${p.reference || "—"}</td>
            <td class="num">${fmt(p.amount)}</td>
            <td class="num">${fmt(p.runningBalance)}</td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="6" style="text-align:center;color:#777">No ledger entries yet.</td></tr>`;
  await printDoc(
    `Statement — ${l.loanNumber}`,
    `${brandHeader("Statement of Account")}
    <table>
      <tr><th style="width:150px">Loan No</th><td>${l.loanNumber}</td><th style="width:150px">Statement Date</th><td>${fmtDate(new Date().toISOString())}</td></tr>
      <tr><th>Debtor Name</th><td colspan="3">${c?.name ?? "—"}</td></tr>
      <tr><th>Debtor Address</th><td colspan="3">${c?.address || "—"}</td></tr>
      <tr><th>Amount of Loan</th><td>${fmt(l.principalAmount)}</td><th>Amount in Words</th><td>${rupeesInWords(l.principalAmount)}</td></tr>
      <tr><th>Date of Loan</th><td>${fmtDate(l.openedDate)}</td><th>Date of Maturity</th><td>${fmtDate(l.dueDate)}</td></tr>
      <tr><th>Rate of Interest</th><td>${l.scheme?.interestRate ?? "—"}% p.a.</td><th>Status</th><td>${l.status}</td></tr>
      <tr><th>Nature of Security</th><td colspan="3">${security}</td></tr>
      ${additionalInfo ? `<tr><th>Additional Information</th><td colspan="3">${additionalInfo}</td></tr>` : ""}
    </table>
    <p><b>True account of the transaction with the debtor:</b></p>
    <table>
      <thead><tr><th>Date</th><th>Description</th><th>Method</th><th>Reference</th><th class="num">Amount</th><th class="num">Running Balance</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><th colspan="4">Outstanding Principal</th><th class="num">${fmt(l.outstandingAmount)}</th><th></th></tr></tfoot>
    </table>
    <p class="muted">Running balance = outstanding principal + outstanding interest + outstanding penal interest, immediately after each entry.</p>`
  );
}

// Ported from frontend/modules/loans/utils/indemnityBond.ts — same
// "Agreement of Pledge of Movable" template, verbatim, English only (the
// branch's paper form has never been translated).
const LENDER_NAME = "Rinkesh Lalitbhai Soni";
const LENDER_REG_NO = "GMLVAL2627000029";

function fmtINR(n?: number) {
  return n != null ? n.toLocaleString("en-IN") : "";
}

export async function printIndemnityBond(l: Loan) {
  const c = l.customer;
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const monthName = now.toLocaleString("en-IN", { month: "long" });
  const yyyy = now.getFullYear();
  const age = c?.dob ? Math.floor((now.getTime() - new Date(c.dob).getTime()) / 31557600000) : "____";
  const B = "________________";
  const name = c?.name || B;
  const address = c?.address || B;
  const branchName = l.branch?.name || B;
  const pan = c?.pan || B;
  // Full Aadhaar is decrypted server-side on demand (GET /customers/:id/
  // aadhaar-full) — the Loan payload itself only ever carries other fields,
  // never the plaintext number.
  const aadhaarFull = c ? await getCustomerAadhaarFull(c.id).then((r) => r.aadhaar).catch(() => "") : "";
  const aadhaar = aadhaarFull || B;
  const loanNumber = l.loanNumber;
  const principal = l.principalAmount;
  const interestRate = l.scheme?.interestRate;
  const ornaments = l.ornaments ?? [];
  const totalValue = ornaments.reduce((s, o) => s + (o.goldValue || 0), 0);

  const rows = ornaments.length
    ? ornaments
        .map(
          (o, i) =>
            `<tr><td>${i + 1}</td><td>${o.name}</td><td>${o.purity}</td>
            <td class="num">${o.grossWeight.toFixed(1)}</td><td class="num">${o.netWeight.toFixed(1)}</td>
            <td class="num">${fmtINR(o.goldValue)}</td></tr>`
        )
        .join("")
    : `<tr><td colspan="6" style="text-align:center;color:#777">${B}</td></tr>`;

  await printDoc(
    `Agreement of Pledge of Movable — ${loanNumber}`,
    `<style>
      /* A4, with generous top/bottom margins reserving blank header/footer
       * space on every printed page (e.g. for a pre-printed letterhead) —
       * bond-only, doesn't touch the slip/statement's own page setup. */
      @page{size:A4;margin:35mm 20mm 30mm 20mm}
    </style>
    <h1>AGREEMENT OF PLEDGE OF MOVABLE</h1>
    <p style="text-align:center;color:#555">Gold Loan Account No. ${loanNumber}</p>
    <p>MEMORANDUM OF AGREEMENT, made the <b>${dd}</b> day of <b>${monthName}, ${yyyy}</b> BETWEEN</p>
    <p>
      <b>${name}</b><br>
      Age :- <b>${age}</b>, business :- ${B}<br>
      Aadhar Card No. <b>${aadhaar}</b><br>
      Pan Card No. <b>${pan}</b><br>
      Residing at :- <b>${address}</b>
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
    <p>(Hereinafter called "the lender") of the other part.</p>
    <p>The lender carrying on business of money-lending under certificate of registration number <b>${LENDER_REG_NO}</b> of the other part.</p>
    <p>The Money lender and borrower are collectively referred to as the "Parties".</p>
    <p><b>WHEREBY IT IS AGREED AS FOLLOWS</b></p>
    <ol>
      <li><b>Covenant to pay</b><br>In Consideration of the loan of Rs <b>${fmtINR(principal) || B}</b> advance by the lender to the borrower, the borrower hereby covenants with the lender that he will repay the said loan on or before ${B} with interest at <b>${interestRate != null ? interestRate + "%" : B}</b> percent per annum from the date of execution of this agreement.</li>
      <li><b>Pledge Clause</b><br>The Lender has lent the sum of Rs <b>${fmtINR(principal) || B}</b> (the receipt of which the borrower hereby acknowledges) and borrower has delivered to the lender article belonging to the borrower and specified in the schedule hereto to be held by him as security for the repayment of the aforesaid loan in the manner herein provided,
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
    <p><b>Total Loan Advanced :- Rs. ${fmtINR(principal) || B}/-</b></p>
    <p>Place :- ${branchName}</p>
    <p>Date :- ${dd} / ${monthName} / ${yyyy}</p>
    <div class="sig">
      <div>The Borrower<span>Name: ${name}</span></div>
      <div>The Lender<span>${LENDER_NAME}</span></div>
    </div>
    <p style="margin-top:20px"><b>IN WITNESS WHEREOF Etc.</b></p>
    <div class="sig">
      <div><span>Name: ${B}<br>Residing at</span></div>
      <div><span>Name: ${B}<br>Residing at</span></div>
    </div>`
  );
}

// Fetches a QR PNG from the backend's internal/qr package (no QR-generation
// library on the mobile side — see the "continue" conversation this was
// built from) and returns it as a data: URI ready to drop straight into an
// <img src>. Downloads to a temp cache file rather than reading the fetch
// response as an ArrayBuffer/base64 in JS — same pattern reports.tsx's xlsx
// export already uses, and it sidesteps React Native's unreliable binary
// string handling for a raw PNG response.
async function fetchQrDataUri(data: string, size = 256): Promise<string> {
  const token = await getToken();
  const targetUri = `${FileSystem.cacheDirectory}qr_${Date.now()}.png`;
  const result = await FileSystem.downloadAsync(
    `${API_BASE_URL}/qr?data=${encodeURIComponent(data)}&size=${size}`,
    targetUri,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Could not generate QR code (${result.status})`);
  }
  const base64 = await FileSystem.readAsStringAsync(result.uri, { encoding: FileSystem.EncodingType.Base64 });
  FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
  return `data:image/png;base64,${base64}`;
}

// Ported from frontend/modules/loans/components/NewLoan.tsx's
// printPacketLabel — same die-cut "flag tag" stock: 81mm total, a
// 56mm×12mm head (perforated at the 28mm midpoint) plus a blank 25mm×3mm
// strap for wrapping around/through the item and tearing off (see the
// approved wire diagram, the packet-flag-tag artifact). First 28mm segment
// holds the QR, the second — the half that stays with the item once torn —
// holds the readable identifiers, the strap stays blank. QR-encoded deep
// link is the packet's code if this loan has one checked into a locker,
// otherwise the loan itself, rendered against the same web app origin the
// QR would open (API_ORIGIN — the Go binary serves both the API and the
// built frontend from one origin, see backend/internal/platform/config.go).
export async function printPacketLabel(l: Loan) {
  const packets = await listPackets({ loanId: l.id }).catch(() => []);
  const packet = packets[0];
  const packetLabel = packet?.code || `PKT-${l.id}`;
  const url = packet ? `${API_ORIGIN}/app#packet/${packet.code}` : `${API_ORIGIN}/app#loan/${l.loanNumber}`;
  const qr = await fetchQrDataUri(url, 256);

  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${l.loanNumber}</title><style>
    @page{size:81mm 12mm;margin:0}
    body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
    .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
      border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid}
    .label img{width:25mm;height:25mm;flex:none}
    .t{font-size:2.5mm;line-height:1.45;min-width:0}
    .t .brand{font-size:2mm;letter-spacing:0.3mm;color:${C.brand}}
    .t .id{font-size:3.4mm;font-weight:bold}
    .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body>
    <div class="tag">
      <div class="head">
        <div class="qrcell"><img src="${qr}" alt="QR"></div>
        <div class="infocell">
          <div class="id">${packetLabel}</div>
          <div class="name">${l.customer?.name || "—"}</div>
          <div class="meta">${l.loanNumber} · ${(l.totalNetWeight ?? 0).toFixed(1)}g</div>
          <div class="brand">${BRAND.name.toUpperCase()}</div>
        </div>
      </div>
      <div class="strap"></div>
    </div>
  </body></html>`;
  await Print.printAsync({ html });
}
