"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/product/components/Icon";
import { useModal } from "@/product/components/Modal";
import { branchLabel, formatRupees, type BillingPlan } from "@/product/config/features";

const STEPS = ["Checking your plan", "Confirming payment", "Raising your branch limit"];
const STEP_MS = 850;

type Phase = "confirm" | "processing" | "done";

/* Confirm → processing → done for moving up one or more plan tiers. The
 * upgrade is simulated (UI-only for now, see config/features.ts): the
 * processing steps run on timers and onUpgraded fires at the end, so wiring
 * a real payment call in later only means replacing runUpgrade's timers. */
export function UpgradePlanModal({
  from,
  to,
  used,
  onUpgraded,
}: {
  from: BillingPlan;
  to: BillingPlan;
  used: number | null;
  onUpgraded: () => void;
}) {
  const { closeModal } = useModal();
  const [phase, setPhase] = useState<Phase>("confirm");
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);
  const toPay = Math.max(0, to.price - from.price);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  function runUpgrade() {
    setPhase("processing");
    setStep(0);
    STEPS.forEach((_, i) => {
      timers.current.push(window.setTimeout(() => setStep(i + 1), STEP_MS * (i + 1)));
    });
    timers.current.push(
      window.setTimeout(() => {
        setPhase("done");
        onUpgraded();
      }, STEP_MS * STEPS.length + 400)
    );
  }

  const limit = (n: number) => (n === 0 ? "No limit" : String(n));

  if (phase === "processing") {
    return (
      <>
        <div className="hd"><h3>Upgrading plan</h3></div>
        <div className="bd bd-scroll">
          <div className="bill-proc">
            <div className="bill-spin" />
            <h4>Upgrading to {to.name}</h4>
            <ol>
              {STEPS.map((s, i) => (
                <li key={s} className={i < step ? "ok" : i === step ? "on" : ""}><i />{s}</li>
              ))}
            </ol>
          </div>
        </div>
      </>
    );
  }

  if (phase === "done") {
    const left = used === null ? null : Math.max(0, to.branches - used);
    return (
      <>
        <div className="hd">
          <h3>Plan upgraded</h3>
          <button className="x" onClick={closeModal}>×</button>
        </div>
        <div className="bd bd-scroll">
          <div className="bill-proc">
            <div className="bill-done"><span><Icon name="check" /></span></div>
            <h4>You&apos;re on {to.name}</h4>
            <p>
              {to.branches === 0
                ? "You can now open as many branches as you need."
                : left === null
                  ? `Your branch limit is now ${to.branches}.`
                  : `You can now open up to ${left} more ${left === 1 ? "branch" : "branches"}.`}
            </p>
          </div>
        </div>
        <div className="ft">
          <button className="btn" onClick={closeModal}>Done</button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="hd">
        <h3>Upgrade plan</h3>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <div className="bill-fromto">
          <div className="bill-tile"><small>Now</small><b>{from.name}</b><span>{branchLabel(from.branches)}</span></div>
          <span className="bill-arrow" aria-hidden>→</span>
          <div className="bill-tile to"><small>New</small><b>{to.name}</b><span>{branchLabel(to.branches)}</span></div>
        </div>
        <div className="bill-sum">
          <div className="bill-row"><span>Branch limit</span><b>{limit(from.branches)} → {limit(to.branches)}</b></div>
          <div className="bill-row"><span>{to.name} price</span><b>{formatRupees(to.price)}</b></div>
          <div className="bill-row"><span>Already paid for {from.name}</span><b>− {formatRupees(from.price)}</b></div>
          <div className="bill-row total"><span>To pay now</span><b>{formatRupees(toPay)}</b></div>
        </div>
        <p className="bill-fine">
          One-time payment. There are no renewals. Your current branches, staff and data stay as they are.
        </p>
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
        <button className="btn" onClick={runUpgrade}>Confirm · pay {formatRupees(toPay)}</button>
      </div>
    </>
  );
}
