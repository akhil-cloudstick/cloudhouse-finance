/* Ported from legacy/app.js's `printDoc(title, body)` (legacy/app.js:48-70) —
 * opens a print-friendly popup window with the given document body and
 * triggers the browser print dialog. Same styles, same behavior, same
 * popup-blocked handling (now reported via a `toast` callback instead of
 * a global `toast()` function). */
export function openPrintWindow(title: string, body: string, onBlocked: (msg: string) => void) {
  const w = window.open("", "_blank");
  if (!w) {
    onBlocked("Popup blocked — please allow popups for this site to print");
    return;
  }
  w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title><style>
    body{font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;margin:40px auto;max-width:760px;line-height:1.55;font-size:14px;padding:0 20px}
    h1{font-size:20px;text-align:center;margin:0 0 2px;letter-spacing:1px}
    h2{font-size:15px;text-align:center;margin:0 0 18px;font-weight:normal;color:#555}
    table{width:100%;border-collapse:collapse;margin:14px 0}
    th,td{border:1px solid #999;padding:6px 8px;font-size:13px;text-align:left;vertical-align:middle}
    th{background:#f3ede1} .num{text-align:right}
    ol li{margin-bottom:10px;text-align:justify}
    .sig{display:flex;justify-content:space-between;gap:20px;margin-top:60px}
    .sig div{flex:1;text-align:center}
    .sig span{display:block;border-top:1px solid #333;padding-top:6px;margin-top:44px;font-size:12.5px}
    .muted{color:#666;font-size:12.5px}
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
