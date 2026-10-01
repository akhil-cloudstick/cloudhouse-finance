"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/product/components/Icon";
import { useModal } from "@/product/components/Modal";
import {
  BILLING_PLANS,
  branchLabel,
  findPlanIndex,
  formatRupees,
} from "@/product/config/features";
import type { BillingStatus } from "@/product/pages/billing/services/billingService";
import { getBranchQuota, type BranchQuota } from "@/product/pages/branches/services/branchService";
import { UpgradePlanModal } from "./UpgradePlanModal";

/* The current-plan card and the plan ladder, shown on Billing when
 * NEXT_PUBLIC_ENABLE_PLAN_UPGRADE is on. Plans come from the env file
 * (config/features.ts) and are branch-count tiers with a one-time price;
 * moving up a tier pays only the difference. The upgrade is simulated, so
 * the new plan lives in local state until the page is reloaded.
 *
 * `aside` is rendered beside the current-plan card (Billing passes its
 * sign-in link card) so the two share one row above the ladder. */
export function PlanUpgrade({ status, aside }: { status: BillingStatus; aside?: React.ReactNode }) {
  const { openModal } = useModal();
  const [quota, setQuota] = useState<BranchQuota | null>(null);
  const [cur, setCur] = useState(() => findPlanIndex(status.tierName));
  const [justUpgraded, setJustUpgraded] = useState(-1);
  const ladderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Usage is a nice-to-have: a role that can manage billing but not read
    // branches simply doesn't see the meter.
    getBranchQuota()
      .then((q) => {
        setQuota(q);
        setCur(findPlanIndex(status.tierName, q.quota));
      })
      .catch(() => setQuota(null));
  }, [status.tierName]);

  const plan = BILLING_PLANS[cur];
  const used = quota?.used ?? null;
  const unlimited = plan.branches === 0;
  const atLimit = !unlimited && used !== null && used >= plan.branches;
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
      <div className="bill-top">
        <div className="card">
          <div className="hd">
            <h3>Current plan</h3>
            <span className="sp" />
            <span className="chip green">Active</span>
          </div>
          <div className="bd">
            <div className="bill-cur-name">{plan.name}</div>
            <div className="bill-cur-sub">{unlimited ? "No limit on branches" : `Up to ${branchLabel(plan.branches)}`}</div>
            {used !== null && (
              <>
                <div className="bill-use">
                  <span>Branches in use</span>
                  <b>{unlimited ? `${used} · no limit` : `${Math.min(used, plan.branches)} of ${plan.branches}`}</b>
                </div>
                {unlimited ? (
                  <div className="bill-meter inf" />
                ) : (
                  <div className={`bill-meter${atLimit ? " full" : ""}`}>
                    {Array.from({ length: plan.branches }, (_, i) => (
                      <i key={i} className={i < used ? "f" : ""} />
                    ))}
                  </div>
                )}
              </>
            )}
            <div className="bill-row"><span>Paid</span><b>{formatRupees(plan.price)}</b></div>
            <div className="bill-row"><span>Payment type</span><b>One-time · no renewal</b></div>
            {atLimit && !onTop && (
              <div className="bill-limit">
                <Icon name="warning" />
                <div>
                  You&apos;re using every branch on this plan. Upgrade to open more branches.{" "}
                  <a href="#plans" onClick={(e) => { e.preventDefault(); ladderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>
                    See plans
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
        {aside}
      </div>

      <div className="bill-plans-h" ref={ladderRef}>
        <h2>Plans</h2>
        <span>{onTop ? "You're on the highest plan." : "Pay once to move up a tier. You only pay the difference."}</span>
      </div>
      <div className="bill-ladder">
        {BILLING_PLANS.map((p, i) => {
          const isCur = i === cur;
          const lower = i < cur;
          const extra = p.branches === 0 ? "No limit" : `+${Math.max(0, p.branches - plan.branches)} branches`;
          return (
            <div key={p.id} className={`bill-plan${isCur ? " cur" : ""}${lower ? " low" : ""}${justUpgraded === i ? " just" : ""}`}>
              <div className="bill-plan-top">
                <span className="bill-tier">Tier {i + 1}</span>
                {isCur ? <span className="chip brand">Current plan</span>
                  : lower ? <span className="chip gray">Included</span>
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
                : lower ? <button className="btn ghost" disabled>Included in your plan</button>
                : <button className="btn" onClick={() => openUpgrade(i)}>Upgrade · pay {formatRupees(Math.max(0, p.price - plan.price))}</button>}
            </div>
          );
        })}
      </div>
    </>
  );
}
