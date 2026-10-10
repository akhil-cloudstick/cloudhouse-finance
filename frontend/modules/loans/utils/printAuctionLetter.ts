import { fmt, fmtDate } from "@/common/utils/format";
import { openPrintWindow, brandHeader } from "@/common/utils/print";
import { BRAND } from "@/common/config/brand";
import { type LoanView } from "@/modules/loans/types/loan-types";

/* Who may decide each kind of escalation, and who may run each auction
 * process step, is now driven by the "Auction Workflow" permissions (see
 * internal/authz.Catalogue) instead of a hardcoded role-name list — an admin
 * grants/revokes these per-role from the Roles & Permissions screen, the
 * same way every other can(...) check in this app works. Hiding a button
 * here is a convenience; the backend (loan.Service.checkStagePermission) is
 * the actual control and rejects the call either way. */

/* Ported from legacy/app.js's `printAuctionLetter()`. The mock version read
 * a separate `db.auctions` list (always empty in this codebase — no
 * seed data and no way to add rows to it, only `updateAuction()` for
 * already-existing ones) plus notice/venue fields that have no backend
 * equivalent. Now works directly off a real loan. */
export function printAuctionLetter(loan: LoanView, toast: (m: string) => void) {
  const today = new Date().toISOString().slice(0, 10);
  const venue = `${BRAND.legalName}, Head Office`;

  openPrintWindow("Auction Letter — " + loan.id, `
    ${brandHeader()}
    <p class="muted">Ref: CHGF/AUC/${loan.id.replace("LN-", "")} · Date: ${today}</p>
    <p><b>To,</b><br>${loan.customerName}</p>
    <p><b>Subject: Final notice — public auction of gold ornaments pledged against loan ${loan.id}</b></p>
    <p>Dear Sir/Madam,</p>
    <ol>
      <li>Despite our repeated reminders, the dues against your gold loan <b>${loan.id}</b>
        (outstanding <b>${fmt(loan.outstanding)}</b> as on date) remain unpaid.</li>
      <li>You are hereby given final notice that the gold ornaments pledged against the said loan will be sold in
        <b>PUBLIC AUCTION</b>${loan.auctionDate ? ` on <b>${fmtDate(loan.auctionDate)}</b>` : ""} at <b>${venue}</b>,
        if the entire dues are not settled before the auction date.</li>
      <li>Details of the pledged ornaments to be auctioned:</li>
    </ol>
    <table>
      <tr><th>Ornament</th><th>Purity</th><th class="num">Gross (g)</th><th class="num">Net (g)</th><th class="num">Qty</th></tr>
      ${loan.ornaments.length
      ? loan.ornaments.map((o) => `<tr><td>${o.name}</td><td>${o.purity}</td><td class="num">${o.grossWeight.toFixed(1)}</td><td class="num">${o.netWeight.toFixed(1)}</td><td class="num">${o.quantity}</td></tr>`).join("")
      : `<tr><td colspan="5">Pledged gold — ${loan.totalNetWeight.toFixed(1)} g total</td></tr>`}
    </table>
    <ol start="4">
      <li>Any surplus from the auction sale after adjusting the principal, interest, penal charges and auction
        expenses will be refunded to you; any shortfall shall remain recoverable from you.</li>
      <li>You may redeem the ornaments by settling the full outstanding with charges at our branch on any working
        day before the auction date.</li>
    </ol>
    <p>This notice is issued as per the terms of the loan agreement and applicable regulations.</p>
    <div class="sig"><div><span>Authorized Signatory</span></div><div><span>Branch Manager</span></div></div>`,
    toast);
}
