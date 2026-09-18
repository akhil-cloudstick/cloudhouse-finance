/* Ported from legacy/app.js's `printDoc(title, body)` (legacy/app.js:48-70) —
 * opens a print-friendly popup window with the given document body and
 * triggers the browser print dialog. Same behavior, same popup-blocked
 * handling (reported via a `toast` callback instead of a global `toast()`).
 *
 * The styles are NOT the same: they were re-themed to the CloudHouse identity along
 * with the rest of the UI. Note that this window is written with
 * document.write into a fresh document, so none of the app's CSS custom
 * properties exist inside it — every colour here has to be a literal, which
 * is why they come from PRINT_COLORS rather than var(). */
import { BRAND, BRAND_PHONES, printBrand, printColors } from "@/common/config/brand";

/** Escapes text interpolated into the print HTML strings. */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* Sends a PDF blob straight to the browser's print dialog instead of
 * downloading it — no visible "preview" tab, just Ctrl+P's picker. Loads
 * the blob into a hidden iframe and calls its contentWindow.print() once
 * the PDF has actually rendered; the iframe (and its object URL) are torn
 * down on the next afterprint/cancel so repeated prints don't leak either.
 * Shared by every server-rendered PDF print flow (indemnity bond, release
 * agreement, personal-loan bond) — moved here from loanService.ts so it's
 * not duplicated per module. */
export function printPdfBlob(blob: Blob): void {
  const url = window.URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;
  document.body.appendChild(iframe);
  iframe.onload = () => {
    const win = iframe.contentWindow;
    if (!win) return;
    const cleanup = () => {
      window.URL.revokeObjectURL(url);
      iframe.remove();
    };
    win.addEventListener("afterprint", cleanup, { once: true });
    // Fallback in case afterprint never fires (e.g. print dialog cancelled
    // in some browsers) — keep the iframe around long enough to print.
    setTimeout(cleanup, 60_000);
    win.focus();
    win.print();
  };
}

/**
 * The masthead every printed document opens with: the legal name, the
 * descriptor, the KML registration number and the contact numbers.
 *
 * This exists because the brand used to be written inline as
 * `<h1>CLOUDHOUSE Finance</h1>` in five separate templates across three
 * files, two of which were copy-pasted duplicates of each other — so the
 * pledge slip and the statement could and did drift apart. Pass the document
 * title (e.g. "Gold Loan Pledge Slip") and it renders beneath the brand.
 */
export function brandHeader(docTitle?: string): string {
  // The signed-in business's own particulars, falling back to the platform
  // brand field by field — see printBrand.
  const B = printBrand();
  return `<header class="brandhead">
    <div class="bh-name">${esc(B.legalName.toUpperCase())}</div>
    <div class="bh-desc">${esc(BRAND.descriptor)}</div>
    <div class="bh-meta">${esc(B.kmlRegLabel)} &nbsp;·&nbsp; ${esc(BRAND_PHONES)}</div>${B.addressLine ? `
    <div class="bh-meta">${esc(B.addressLine)}</div>` : ""}
    <div class="bh-rule"></div>
    ${docTitle ? `<h2>${esc(docTitle)}</h2>` : ""}
  </header>`;
}

export function openPrintWindow(title: string, body: string, onBlocked: (msg: string) => void) {
  // Resolved per call, not at module load: the colour belongs to whichever
  // business is signed in, and this module is imported once for all of them.
  const C = printColors();
  const w = window.open("", "_blank");
  if (!w) {
    onBlocked("Popup blocked — please allow popups for this site to print");
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    /* Print documents cannot rely on next/font, which only injects its faces
       into the app document — so these name the families and fall back to
       system stacks rather than fetching webfonts into a popup. */
    body{font-family:'Inter','Segoe UI',ui-sans-serif,system-ui,-apple-system,Helvetica,Arial,sans-serif;color:${C.ink};margin:40px auto;max-width:760px;line-height:1.55;font-size:14px;padding:0 20px}
    h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
    h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:${C.muted}}
    .brandhead{text-align:center;margin:0 0 20px}
    .brandhead .bh-name{font-family:'Montserrat','Segoe UI',sans-serif;font-size:17px;font-weight:800;letter-spacing:.06em;color:${C.brandDeep}}
    .brandhead .bh-desc{font-size:10.5px;font-weight:600;letter-spacing:.28em;text-transform:uppercase;color:${C.brand};margin-top:3px}
    .brandhead .bh-meta{font-size:10.5px;color:${C.muted};margin-top:5px}
    /* The one gold element on the page, matching the badge in the wordmark. */
    .brandhead .bh-rule{height:2px;background:${C.accent};width:96px;margin:12px auto 14px}
    .brandhead h2{margin:0}
    table{width:100%;border-collapse:collapse;margin:14px 0}
    th,td{border:1px solid ${C.line};padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
    th{background:${C.tint};color:${C.brandDeep};font-weight:600}
    .num{text-align:right;font-variant-numeric:tabular-nums}
    ol li{margin-bottom:10px;text-align:justify}
    .sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
    .sig div{flex:1;text-align:center;position:relative}
    .sig span{display:block;border-top:1px solid ${C.ink};padding-top:6px;margin-top:44px;font-size:12.5px}
    /* Absolutely positioned — sits inside the existing blank gap the 44px
     * margin-top above already reserves, rather than adding its own height
     * to the flow. Only the Lender's side has this image; if it were a
     * normal flow element instead, its line would render lower than the
     * Borrower's identical (image-less) line beside it, since each .sig
     * div sizes independently. */
    .lender-sig{position:absolute;top:18px;left:50%;transform:translateX(-50%);width:110px;height:auto}
    .muted{color:${C.muted};font-size:12.5px}
    @media print{.noprint{display:none}}
  </style></head><body>${body}
  <div class="noprint" style="text-align:center;margin-top:30px">
    <button onclick="window.print()" style="padding:10px 26px;font-size:14px;cursor:pointer">🖨 Print</button></div>
  </body></html>`);
  w.document.close();
  setTimeout(() => {
    try { w.focus(); w.print(); } catch { /* ignore */ }
  }, 400);
}
