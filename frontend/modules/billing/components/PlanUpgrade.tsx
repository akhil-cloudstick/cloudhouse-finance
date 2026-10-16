"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { useAuth } from "@/common/providers/AuthProvider";
import {
  BILLING_PLANS,
  findPlanIndex,
  formatRupees,
} from "@/common/config/features";
import type { BillingStatus } from "@/modules/billing/types/billing-types";
import { getBranchQuota } from "@/modules/branches/services/branchService";
import { type BranchQuota } from "@/modules/branches/types/branch-types";
import { UpgradePlanModal } from "./UpgradePlanModal";

type PlanUpgradeProps = { status: BillingStatus };

/* The plan ladder, shown on Billing when NEXT_PUBLIC_ENABLE_PLAN_UPGRADE is
 * on. Plans come from the env file (common/config/features.ts) and are branch-count
 * tiers with a one-time price; moving up a tier pays only the difference. The
 * upgrade is simulated, so the new plan lives in local state until the page
 * is reloaded. */
export function PlanUpgrade({ status }: PlanUpgradeProps) {
  const { openModal } = useModal();
  const canViewBranches = useAuth().can("Branch_Management", "can_view_branch_module");
  const [quota, setQuota] = useState<BranchQuota | null>(null);
  const [cur, setCur] = useState(() => findPlanIndex(status.tierName));
  const [justUpgraded, setJustUpgraded] = useState(-1);

  useEffect(() => {
    // The branch quota pins the current plan and feeds the upgrade modal's
    // usage line; a role that can't read branches just goes without it.
    if (!canViewBranches) return;
    getBranchQuota()
      .then((q) => {
        setQuota(q);
        setCur(findPlanIndex(status.tierName, q.quota));
      })
      .catch(() => setQuota(null));
  }, [status.tierName, canViewBranches]);

  const plan = BILLING_PLANS[cur];
  const used = quota?.used ?? null;
  const onTop = cur === BILLING_PLANS.length - 1;

  function openUpgrade(target: number) {
    openModal(
      <UpgradePlanModal
        from={plan}
        to={BILLING_PLANS[target]}
        used={used}
        onUpgraded={() => {
          setCur(target);
          setJustUpgraded(target);
          window.setTimeout(() => setJustUpgraded(-1), 1700);
        }}
      />
    );
  }

  return (
    <>
      <div className="bill-plans-h">
        <h2>Plans</h2>
        <span>{onTop ? "You're on the highest plan." : "Pay once to move up a tier. You only pay the difference."}</span>
      </div>
      <div className="bill-ladder">
        {BILLING_PLANS.map((p, i) => {
          const isCur = i === cur;
          // Plans below the current one stay listed but offer no action — a
          // business never moves down a tier.
          const lower = i < cur;
          const extra = p.branches === 0 ? "No limit" : `+${Math.max(0, p.branches - plan.branches)} branches`;
          return (
            <div key={p.id} className={`bill-plan${isCur ? " cur" : ""}${lower ? " low" : ""}${justUpgraded === i ? " just" : ""}`}>
              <div className="bill-plan-top">
                <span className="bill-tier">Tier {i + 1}</span>
                {isCur ? <span className="chip brand">Current plan</span>
                  : lower ? null
                  : <span className="chip green">{extra}</span>}
              </div>
              <div className="bill-plan-name">{p.name}</div>
              <div className="bill-plan-br">
                <b>{p.branches === 0 ? "∞" : p.branches}</b>
                <span>{p.branches === 0 ? "branches · no limit" : p.branches === 1 ? "branch" : "branches"}</span>
              </div>
              <div className="bill-plan-price"><b>{formatRupees(p.price)}</b> <small>one-time</small></div>
              {p.features.length > 0 && (
                <ul>
                  {p.features.map((f) => <li key={f}><Icon name="check" />{f}</li>)}
                </ul>
              )}
              {isCur ? <button className="btn" disabled>Your plan</button>
                : lower ? null
                : <button className="btn" onClick={() => openUpgrade(i)}>Upgrade · pay {formatRupees(Math.max(0, p.price - plan.price))}</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
