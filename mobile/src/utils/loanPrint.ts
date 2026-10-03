// Mobile port of frontend/common/utils/print.ts's slip/statement/label
// bodies. The web versions open a new browser tab and drive window.print()
// — there's no such thing on mobile, so this wraps the same HTML/CSS in
// Print.printAsync, which raises the OS's own print/share sheet directly.
// The pledge and release agreements are NOT built here: they come from the
// backend's per-language templates (see printServerPdf below).
import * as Print from "expo-print";
import * as FileSystem from "expo-file-system/legacy";
import { fmt } from "../lib/format";
import { rupeesInWords } from "../lib/numberToWords";
import { Loan, LoanTopUp } from "../types/loan";
import { listTopUps } from "../api/loans";
import { listPackets } from "../api/packets";
import { API_BASE_URL, API_ORIGIN } from "../api/config";
import { getToken } from "../auth/tokenStorage";
import { ApiError } from "../api/client";
import { withPrintProgress } from "../components/ui/PrintProgress";
import { BRAND, printBrand, printColors } from "../config/brand";

// Same CSS as openPrintWindow (frontend/common/utils/print.ts) — kept
// byte-for-byte so a printed slip/statement/bond looks the same whichever
// app produced it.
// A function, not a constant: the colours are the signed-in business's own
// (printColors), which are only known at runtime and can change.
function docStyle(): string {
  const C = printColors();
  return `
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
}

// Business particulars come from the backend, so escape them before they go
// into the HTML (a legal name like "… Financiers & Investments" is common).
function esc(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Mirrors brandHeader() in frontend/common/utils/print.ts — the signed-in
 * business's own particulars, falling back to the platform brand field by
 * field (see printBrand). */
function brandHeader(docTitle?: string): string {
  const B = printBrand();
  const meta = [B.kmlRegLabel, B.phones].filter(Boolean).map(esc).join(" &nbsp;·&nbsp; ");
  return `<header class="brandhead">
    <div class="bh-name">${esc(B.legalName.toUpperCase())}</div>
    <div class="bh-desc">${esc(BRAND.descriptor)}</div>
    <div class="bh-meta">${meta}</div>${B.addressLine ? `
    <div class="bh-meta">${esc(B.addressLine)}</div>` : ""}
    <div class="bh-rule"></div>
    ${docTitle ? `<h2>${docTitle}</h2>` : ""}
  </header>`;
}

async function printDoc(title: string, body: string) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>${docStyle()}</style></head><body>${body}</body></html>`;
  await Print.printAsync({ html });
}

function fmtDate(d?: string | null) {
  return d ? new Date(d).toLocaleDateString("en-IN") : "—";
}

// Ported from frontend/modules/loans/components/LoanDetail.tsx's
// printPledgeSlip.
export async function printPledgeSlip(l: Loan) {
  const topUps = await listTopUps(l.id).catch(() => [] as LoanTopUp[]);
  await printDoc(`Pledge Slip — ${l.loanNumber}`, pledgeSlipBody(l, topUps));
}

// How the principal was advanced — the initial amount on the opening date,
// then each later additional amount (paid-out top-ups), oldest first. Same
// table as the web slip; empty when the loan was advanced in one go.
function amountDistribution(l: Loan, topUps: LoanTopUp[]): string {
  const extra = topUps
    .filter((t) => t.status === "Active")
    .sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id - b.id);
  if (!extra.length) return "";
  const initial = Math.max(l.principalAmount - extra.reduce((s, t) => s + t.amount, 0), 0);
  const rows = [
    `<tr><td>${fmtDate(l.openedDate)}</td><td>Initial loan amount</td><td class="num">${fmt(initial)}</td></tr>`,
    ...extra.map((t) => `<tr><td>${fmtDate(t.occurredOn)}</td><td>Additional loan amount</td><td class="num">${fmt(t.amount)}</td></tr>`),
  ].join("");
  return `<table>
      <thead><tr><th>Date</th><th>Amount Distribution</th><th class="num">Amount</th></tr></thead>
      <tbody>${rows}<tr><th colspan="2">Total</th><th class="num">${fmt(l.principalAmount)}</th></tr></tbody>
    </table>`;
}

function pledgeSlipBody(l: Loan, topUps: LoanTopUp[]): string {
  const c = l.customer;
  const ornaments = l.ornaments ?? [];
  return (
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
    ${amountDistribution(l, topUps)}
    <div class="sig"><div><span>Customer Signature</span></div><div><span>Cashier</span></div><div><span>Branch Manager</span></div></div>`
  );
}

/** Packet label and pledge slip on ONE A4 page: the label at its real size in
 * a dashed cut-out box at the top, the full slip below — a single print job. */
export async function printLabelAndSlipOnePage(l: Loan) {
  const C = printColors();
  const [label, topUps] = await Promise.all([
    packetLabelParts(l),
    listTopUps(l.id).catch(() => [] as LoanTopUp[]),
  ]);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Label &amp; Slip — ${l.loanNumber}</title><style>
    @page{size:A4;margin:12mm}
    ${docStyle()}
    body{margin:0 auto}
    ${label.css}
    .cutout{display:flex;align-items:center;gap:4mm;margin-bottom:8mm}
    .cutout .hint{font-size:11px;color:${C.muted}}
  </style></head><body>
    <div class="cutout">${label.html}<div class="hint">✂ Cut along the dashed line and attach to the packet</div></div>
    ${pledgeSlipBody(l, topUps)}
  </body></html>`;
  await Print.printAsync({ html });
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

// --- Server-rendered agreements -------------------------------------------
// The pledge agreement (indemnity bond) and release agreement are rendered
// by the backend from its own per-language templates (backend/internal/loan/
// indemnitybond.go, releaseagreement.go) — same PDFs the web downloads.
// Languages each endpoint accepts (?lang=); anything else is a 400.
export type DocLang = "en" | "ml" | "gu";
export const DOC_LANG_LABELS: Record<DocLang, string> = { en: "English", ml: "Malayalam", gu: "Gujarati" };
export const PLEDGE_AGREEMENT_LANGS: DocLang[] = ["en", "ml", "gu"];
export const RELEASE_AGREEMENT_LANGS: DocLang[] = ["en", "ml"];

// Downloads an authenticated PDF into the cache dir and opens the OS print
// preview. A failed download leaves the JSON error envelope in the target
// file, so its message is surfaced as an ApiError.
async function printServerPdf(path: string, filename: string): Promise<void> {
  const token = await getToken();
  const targetUri = `${FileSystem.cacheDirectory}${filename.replace(/[^\w.-]+/g, "-")}`;
  // The render takes a few seconds server-side — show the overlay for it.
  const result = await withPrintProgress(() =>
    FileSystem.downloadAsync(`${API_BASE_URL}${path}`, targetUri, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  );
  if (result.status < 200 || result.status >= 300) {
    let message = "";
    let body: unknown = null;
    try {
      body = JSON.parse(await FileSystem.readAsStringAsync(result.uri));
      const b = body as { error?: string; message?: string };
      if (typeof (b.error || b.message) === "string") message = (b.error || b.message) as string;
    } catch {
      // not JSON — keep the generic message
    }
    FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(() => undefined);
    throw new ApiError(result.status, message, body);
  }
  await Print.printAsync({ uri: result.uri });
}

// GET /loans/:id/indemnity-bond/pdf?lang=en|ml|gu
export function printPledgeAgreementPdf(loanId: number, loanNumber: string, lang: DocLang) {
  return printServerPdf(`/loans/${loanId}/indemnity-bond/pdf?lang=${lang}`, `pledge-agreement-${lang}-${loanNumber}.pdf`);
}

// GET /loans/:id/release-agreement/pdf?lang=en|ml — full release (FORM 7).
export function printReleaseAgreementPdf(loanId: number, loanNumber: string, lang: DocLang) {
  return printServerPdf(`/loans/${loanId}/release-agreement/pdf?lang=${lang}`, `release-agreement-${lang}-${loanNumber}.pdf`);
}

// GET /loans/requests/:requestId/partial-release-receipt/pdf — the partial
// release counterpart; the backend renders it in English only.
export function printPartialReleaseReceiptPdf(requestId: number) {
  return printServerPdf(`/loans/requests/${requestId}/partial-release-receipt/pdf`, `partial-release-receipt-${requestId}.pdf`);
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
  const label = await packetLabelParts(l);
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packet Label — ${l.loanNumber}</title><style>
    @page{size:81mm 12mm;margin:0}
    body{margin:0;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact}
    ${label.css}
  </style></head><body>
    ${label.html}
  </body></html>`;
  await Print.printAsync({ html });
}

// The label's CSS and markup, shared by the label-stock print and the
// one-page Label & Slip print.
async function packetLabelParts(l: Loan): Promise<{ css: string; html: string }> {
  const C = printColors();
  const packets = await listPackets({ loanId: l.id }).catch(() => []);
  const packet = packets[0];
  const packetLabel = packet?.code || `PKT-${l.id}`;
  const url = packet ? `${API_ORIGIN}/app#packet/${packet.code}` : `${API_ORIGIN}/app#loan/${l.loanNumber}`;
  const qr = await fetchQrDataUri(url, 256);
  const css = `
    .label{width:50mm;height:30mm;box-sizing:border-box;padding:1.6mm;display:flex;align-items:center;gap:1.8mm;
      border:0.3mm dashed #aaa;overflow:hidden;page-break-inside:avoid;font-family:Arial,Helvetica,sans-serif;-webkit-print-color-adjust:exact;flex:none}
    .label img{width:25mm;height:25mm;flex:none}
    .label .t{font-size:2.5mm;line-height:1.45;min-width:0}
    .label .t .brand{font-size:2mm;letter-spacing:0.3mm;color:${C.brand}}
    .label .t .id{font-size:3.4mm;font-weight:bold}
    .label .t div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`;
  const html = `
    <div class="label">
      <img src="${qr}" alt="QR">
      <div class="t">
        <div class="brand">${esc(printBrand().name.toUpperCase())}</div>
        <div class="id">${l.loanNumber} · ${packetLabel}</div>
        <div>${l.customer?.name || "—"}</div>
        <div>${l.customer?.code || l.customer?.id || "—"} · ${l.customer?.phone || ""}</div>
        <div>${new Date().toLocaleDateString("en-IN")} · ${(l.totalNetWeight ?? 0).toFixed(1)} g · ${(l.ornaments ?? []).length} item(s)</div>
      </div>
      <div class="strap"></div>
    </div>`;
  return { css, html };
}
