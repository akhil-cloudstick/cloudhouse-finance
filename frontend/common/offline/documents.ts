/* Documents made on this PC while the server cannot be reached. The templates the backend uses are bundled in the desktop app
 * (desktop/templates, filled by desktop/documents*.go); a module hands over the data it holds and this prints the result.
 * Online the backend makes every document as before: callers come here only when the server did not answer at all. */

import { ApiError } from "@/common/services/httpClient";
import { offlineDocs } from "@/common/services/desktopBridge";
import { listLocal } from "./localCopy";
import { offlineReady } from "./state";

/* True when this failure is "the server did not answer" and this PC can make the document itself. */
export function canMakeOffline(e: unknown): boolean {
  return offlineReady() && offlineDocs.available() && e instanceof ApiError && e.status === 0;
}

/* Sends finished HTML to the print dialog through a hidden frame. */
export function printHtml(html: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    const cleanup = () => { setTimeout(() => frame.remove(), 1000); resolve(); };
    frame.onload = () => {
      const win = frame.contentWindow;
      if (!win) return cleanup();
      win.addEventListener("afterprint", cleanup);
      setTimeout(() => { win.focus(); win.print(); }, 300);
      // the dialog may be closed without afterprint firing; do not leave the frame behind forever
      setTimeout(cleanup, 5 * 60_000);
    };
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}

export async function renderAndPrint(kind: string, lang: string, input: unknown): Promise<void> {
  await printHtml(await offlineDocs.render(kind, lang, JSON.stringify(input)));
}

/* A customer as this PC holds them, in the shape the document templates read (the same value under either spelling: the local
 * copy is camelCase, the server's own answer snake_case). */
export function localPerson(customerId: number | string | undefined): Record<string, unknown> {
  const c = listLocal("customers").find((r) => r.id === Number(customerId)) as Record<string, unknown> | undefined;
  if (!c) return {};
  const pick = (a: string, b: string) => (c[a] ?? c[b] ?? "") as string;
  return {
    name: pick("name", "name"), fatherName: pick("fatherName", "father_name"), address: pick("address", "address"),
    district: pick("district", "district"), village: pick("village", "village"), taluk: pick("taluk", "taluk"),
    place: pick("place", "place"), pinCode: pick("pinCode", "pin_code"), phone: pick("phone", "phone"), dob: pick("dob", "dob"),
    pan: pick("pan", "pan"), aadhaarLast4: pick("aadhaarLast4", "aadhaar_last4"), age: (c.age as number | undefined) ?? null,
  };
}
