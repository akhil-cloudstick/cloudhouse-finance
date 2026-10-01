import React, { useState } from "react";
import { AccBtn, C, Card, EmptyText, PledgeItem } from "../../ui";
import { normalizeSanctionStage } from "../../../api/loans";
import { DEFAULT_WORKFLOW, stageByKey, useApprovalWorkflow, type WorkflowConfig } from "../../../api/approvalWorkflow";
import { dmy, inr } from "../../../lib/format";
import type { Loan, LoanRequest } from "../../../types/loan";

type Ev = { key: string; at: string; order: number; icon: string; iconBg?: string; iconColor?: string; title: string; sub?: string };

const PAGE = 10;

/** Builds the loan page's History tab: pledge, approvals, rejection, bank
 * pledges and extension / release requests. Money movements (disbursement,
 * top-ups, payments) live in the Payment Ledger tab instead (LoanLedger.tsx).
 * Oldest first, as in the prototype. */
export function buildLoanEvents(l: Loan, requests: LoanRequest[], wf: WorkflowConfig = DEFAULT_WORKFLOW): Ev[] {
  const ev: Ev[] = [];
  const weight = l.totalNetWeight ?? (l.ornaments ?? []).reduce((s, o) => s + o.netWeight * (o.quantity || 1), 0);
  const value = l.totalGoldValue ?? (l.ornaments ?? []).reduce((s, o) => s + o.goldValue, 0);
  const count = (l.ornaments ?? []).length;

  ev.push({
    key: "pledged",
    at: l.openedDate,
    order: 0,
    icon: "coin",
    title: "Gold pledged & appraised",
    sub: `${count} ornament${count === 1 ? "" : "s"} · ${weight.toFixed(2)} g · valued at ${inr(value)}`,
  });

  // Which stage disburses is per-tenant (the last enabled "loan_sanction"
  // stage), so "Loan sanctioned" marks the LAST approval row of a loan whose
  // chain has completed, whichever stage that was.
  const approvals = l.approvals ?? [];
  const lastApprovalId = [...approvals].reverse().find((a) => a.action !== "Rejected")?.id;
  for (const a of approvals) {
    const stage = normalizeSanctionStage(a.stage);
    const def = stageByKey(wf, "loan_sanction", stage);
    const label = def ? `${a.action === "Verified" ? "Verified" : "Approved"} by ${def.role}` : a.stage;
    const rejected = a.action === "Rejected";
    const sanctioned = !rejected && a.id === lastApprovalId && l.approvalStage === "Approved";
    ev.push({
      key: `ap-${a.id}`,
      at: a.createdAt,
      order: 1,
      icon: rejected ? "close" : "check",
      iconBg: rejected ? C.redBg : sanctioned ? C.brandPale : undefined,
      iconColor: rejected ? C.red : undefined,
      title: rejected ? `Rejected — ${label}` : sanctioned ? "Loan sanctioned" : label,
      sub: [sanctioned ? `${l.scheme?.name ?? "Scheme"} · ${inr(l.sanctionedAmount || l.principalAmount)} approved` : a.actorRole, a.remarks].filter(Boolean).join(" · "),
    });
  }

  if (l.status === "Rejected" && l.rejectedAt && !(l.approvals ?? []).some((a) => a.action === "Rejected")) {
    ev.push({
      key: "rejected",
      at: l.rejectedAt,
      order: 1,
      icon: "close",
      iconBg: C.redBg,
      iconColor: C.red,
      title: "Loan rejected",
      sub: [l.rejectedByName ? `by ${l.rejectedByName}` : "", l.rejectionRemarks].filter(Boolean).join(" · "),
    });
  }

  for (const b of l.bankPledges ?? []) {
    ev.push({
      key: `bp-${b.id}`,
      at: b.pledgeDate,
      order: 4,
      icon: "shield",
      title: b.status === "Voided" ? `Bank pledge deleted — ${b.bankName}` : `Repledged to ${b.bankName}`,
      sub: `${inr(b.pledgedAmount)}${b.referenceNumber ? ` · Ref ${b.referenceNumber}` : ""}${b.status === "Voided" && b.voidReason ? ` · ${b.voidReason}` : ""}`,
    });
    if (b.releaseDate && b.status === "Released") {
      ev.push({ key: `bpr-${b.id}`, at: b.releaseDate, order: 4, icon: "check", title: `Released from ${b.bankName}`, sub: inr(b.pledgedAmount) });
    }
  }

  for (const r of requests) {
    const amber = r.status === "Pending";
    const tone = amber ? { iconBg: C.amberBg, iconColor: C.amber } : r.status === "Rejected" ? { iconBg: C.redBg, iconColor: C.red } : { iconBg: C.greenBg, iconColor: C.green };
    const verb = r.status === "Pending" ? "requested" : r.status === "Approved" ? "approved" : "rejected";
    if (r.type === "Waiver" || r.type === "Adjustment") {
      ev.push({
        key: `rq-${r.id}`,
        at: r.decidedAt && r.status !== "Pending" ? r.decidedAt : r.requestedAt || r.createdAt,
        order: 5,
        icon: "coin",
        ...tone,
        title: `${r.type} ${verb}`,
        sub: [inr(r.amount ?? 0), r.detail, r.status === "Pending" ? "pending approval" : ""].filter(Boolean).join(" · "),
      });
    } else if (r.type === "Extension") {
      const m = r.requestedExtensionMonths;
      ev.push({
        key: `rq-${r.id}`,
        at: r.decidedAt && r.status !== "Pending" ? r.decidedAt : r.requestedAt || r.createdAt,
        order: 5,
        icon: "calendar",
        ...tone,
        title: `Extension ${verb}`,
        sub: `Requested +${m ?? "?"} month${m === 1 ? "" : "s"}${r.status === "Pending" ? ", pending approval" : r.newDueDate ? ` · new due ${dmy(r.newDueDate)}` : ""}`,
      });
    } else {
      const n = r.ornamentSelections?.length ?? 0;
      ev.push({
        key: `rq-${r.id}`,
        at: r.decidedAt && r.status !== "Pending" ? r.decidedAt : r.requestedAt || r.createdAt,
        order: 5,
        icon: "coin",
        ...tone,
        title: `${r.isPartial ? "Partial release" : "Release"} ${verb}`,
        sub: [r.isPartial ? `${n} ornament${n === 1 ? "" : "s"}` : "All ornaments", r.detail, r.status === "Pending" ? "pending approval" : ""].filter(Boolean).join(" · "),
      });
    }
  }

  return ev.sort((a, b) => (a.at || "").localeCompare(b.at || "") || a.order - b.order);
}

export function LoanTimeline({ loan, requests }: { loan: Loan; requests: LoanRequest[] }) {
  const wf = useApprovalWorkflow();
  const events = buildLoanEvents(loan, requests, wf);
  // Oldest first; long histories start collapsed to the latest PAGE entries.
  const [shown, setShown] = useState(PAGE);
  const hidden = Math.max(0, events.length - shown);
  const visible = events.slice(hidden);
  return (
    <Card>
      {hidden > 0 ? <AccBtn label={`Show ${Math.min(PAGE, hidden)} earlier (${hidden} more)`} onPress={() => setShown((s) => s + PAGE)} style={{ marginBottom: 6 }} /> : null}
      {visible.length === 0 ? <EmptyText>No history yet.</EmptyText> : null}
      {visible.map((e, i) => (
        <PledgeItem key={e.key} first={i === 0} icon={e.icon} iconBg={e.iconBg} iconColor={e.iconColor} title={e.title} sub={e.sub} date={dmy(e.at)} />
      ))}
    </Card>
  );
}
