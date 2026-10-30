"use client";

import { fmt } from "@/common/utils/format";
import { useAuth, useApprovalWorkflow } from "@/common/providers/AuthProvider";
import { canActAtStage, firstStage } from "@/common/services/approvalWorkflowService";
import { getAuctionHistory, resolveAuctionDecision } from "@/modules/loans/services/loanService";

export type ShortfallChoice = { decision: "" | "PursueBalance" | "WriteOff"; remarks: string };

/* Whether this role may decide a post-auction shortfall — the same rule the Auction Management card uses. */
export function useCanDecideShortfall(): boolean {
  const { can, role, isSystem } = useAuth();
  const { config: workflow } = useApprovalWorkflow();
  return can("Loan_Management", "can_update_loan") && (canActAtStage({ role, isSystem }, firstStage(workflow, "auction_shortfall")) || isSystem);
}

/* A shortfall that already has a decision (balance pursued or written off) keeps it through an edit; only a new or
 * still-pending one is asked for here. */
export function hasDecidedShortfall(rec: { decisionRequests: { kind: string; status: string }[] } | null | undefined): boolean {
  return !!rec?.decisionRequests.some((d) => d.kind === "Shortfall" && (d.status === "PursueBalance" || d.status === "WriteOff"));
}

type Props = {
  shortfall: number;
  value: ShortfallChoice;
  onChange: (v: ShortfallChoice) => void;
  canDecide: boolean;
};

/* Shown in an auction edit when the edited sale no longer covers what was owed: the shortfall can be decided right
 * here (pursue the balance from the customer, or write it off) instead of going to Auction Management afterwards.
 * "Decide later" keeps today's behaviour — the decision waits in Auction Management. */
export function ShortfallDecisionPicker({ shortfall, value, onChange, canDecide }: Props) {
  return (
    <div style={{ marginTop: 14 }}>
      <label className="f">Shortfall of {fmt(shortfall)} — decision</label>
      {!canDecide ? (
        <p className="ccheck-hint" style={{ margin: "4px 0 0" }}>A manager decides the shortfall from Auction Management after this is saved.</p>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
            {([
              ["", "Decide later", "The decision waits in Auction Management."],
              ["PursueBalance", "Pursue the balance", "The loan stays open and the customer owes the shortfall."],
              ["WriteOff", "Write off the shortfall", "The balance is waived and the loan is closed."],
            ] as const).map(([v, title, detail]) => (
              <label key={v || "later"} className="cradio" style={{ fontSize: 13 }}>
                <input type="radio" name="shortfall-decision" checked={value.decision === v} onChange={() => onChange({ ...value, decision: v })} />
                <span className="mark" />
                <span>
                  <strong className="cradio-title">{title}</strong>
                  <span className="cradio-detail">{detail}</span>
                </span>
              </label>
            ))}
          </div>
          {value.decision && (
            <div style={{ marginTop: 8 }}>
              <label className="f">Reason *</label>
              <input className="inp" value={value.remarks} placeholder="Why this decision" onChange={(e) => onChange({ ...value, remarks: e.target.value })} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* Records the chosen decision once the edit is saved: finds the shortfall decision the edit left waiting and resolves
 * it through the normal decision endpoint (same rules and permissions as deciding it from Auction Management). */
export async function applyShortfallChoice(loanId: number, choice: ShortfallChoice): Promise<void> {
  if (!choice.decision) return;
  const history = await getAuctionHistory(loanId);
  const pending = history.flatMap((r) => r.decisionRequests).find((d) => d.kind === "Shortfall" && d.status === "Pending");
  if (!pending) return; // nothing waiting (e.g. shortfalls are pursued automatically in this business)
  await resolveAuctionDecision(loanId, pending.id, choice.decision, choice.remarks.trim());
}
