"use client";

import { useEffect, useState } from "react";
import { useToast } from "@/product/components/Toast";
import { useAuth } from "@/product/providers/auth-context";
import {
  confirmSubscription,
  formatPaise,
  getBillingStatus,
  subscribe,
  type BillingStatus,
} from "@/product/pages/billing/services/billingService";
import { FEATURES } from "@/product/config/features";
import { PlanUpgrade } from "./PlanUpgrade";

// Razorpay's checkout widget is loaded on demand (script tag), not bundled —
// it is only ever needed on this one page, and only once a subscribe is
// actually attempted.
const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load the payment widget. Check your connection and try again."));
    document.body.appendChild(script);
  });
}

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  trial: "Trial",
  past_due: "Payment overdue",
  grace: "Payment pending — grace period",
  over_quota: "Over plan quota",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

/* Multi-tenancy plan, Step 10: a business's own billing screen —
 * Administrator-only (see authz.Restrictions's "can manage billing"
 * entry). Shows the current plan/status and, when the business has no
 * active subscription, a Subscribe button that opens Razorpay's checkout
 * widget in subscription mode. Confirmation is two-layered by design (see
 * billing.Service.ConfirmSubscription's doc comment): this page's
 * onSuccess callback gives immediate feedback, while the Razorpay webhook
 * remains the authoritative source of truth for the actual billing dates. */
export function Billing() {
  const toast = useToast();
  const { can, employee } = useAuth();
  const canManageBilling = can("Billing", "can_manage_billing");
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [error, setError] = useState("");
  const [subscribing, setSubscribing] = useState(false);

  async function load() {
    try {
      setStatus(await getBillingStatus());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load billing status.");
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSubscribe() {
    setSubscribing(true);
    try {
      const { subscriptionId, keyId } = await subscribe();
      await loadCheckoutScript();
      if (!window.Razorpay) throw new Error("Payment widget failed to load.");
      const rzp = new window.Razorpay({
        key: keyId,
        subscription_id: subscriptionId,
        name: "Subscription",
        description: status ? `${status.tierName} plan` : undefined,
        prefill: { name: employee?.name },
        handler: async (response: {
          razorpay_payment_id: string;
          razorpay_subscription_id: string;
          razorpay_signature: string;
        }) => {
          try {
            await confirmSubscription(
              response.razorpay_subscription_id,
              response.razorpay_payment_id,
              response.razorpay_signature
            );
            toast("Subscription confirmed.");
            load();
          } catch (e) {
            toast(e instanceof Error ? e.message : "Could not confirm the payment.");
          }
        },
      });
      rzp.open();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start the subscription.");
    } finally {
      setSubscribing(false);
    }
  }

  return (
    <>
      <div className="page-h">
        <div><h1>Billing</h1><p>{FEATURES.planUpgrade ? "Administrator-only · your plan and branch limit" : "Administrator-only · this business's subscription plan"}</p></div>
      </div>
      <hr className="gold-rule" />
      {!canManageBilling && (
        <p className="notice" style={{ maxWidth: 480 }}>
          You do not have access to this page. Ask your administrator.
        </p>
      )}
      {canManageBilling && error && (
        <p style={{ color: "var(--red)", fontSize: 13.5 }}>
          Could not reach the server — {error}
          <button className="btn plain sm" style={{ marginLeft: 8 }} onClick={load}>Retry</button>
        </p>
      )}
      {canManageBilling && !error && status === null && (
        <p style={{ color: "var(--muted)", fontSize: 13.5 }}>Loading billing status…</p>
      )}
      {canManageBilling && status && FEATURES.planUpgrade && (
        <PlanUpgrade status={status} />
      )}
      {canManageBilling && status && !FEATURES.planUpgrade && (
        <div className="card" style={{ padding: 20, maxWidth: 480 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--muted)" }}>Plan</span>
            <strong>{status.tierName}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--muted)" }}>Price</span>
            <strong>{status.priceInPaise > 0 ? `${formatPaise(status.priceInPaise)} / month` : "Not billed"}</strong>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ color: "var(--muted)" }}>Status</span>
            <strong>{STATUS_LABELS[status.businessStatus] ?? status.businessStatus}</strong>
          </div>
          {status.subscriptionExpiresAt && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--muted)" }}>
                {new Date(status.subscriptionExpiresAt) < new Date() ? "Expired on" : "Renews on"}
              </span>
              <strong>{new Date(status.subscriptionExpiresAt).toLocaleDateString()}</strong>
            </div>
          )}
          {status.gracePeriodEndsAt && (
            <p style={{ color: "var(--red)", fontSize: 13, marginTop: 8 }}>
              A recent payment attempt failed. Please renew before {new Date(status.gracePeriodEndsAt).toLocaleDateString()} to avoid suspension.
            </p>
          )}
          <hr className="gold-rule" style={{ margin: "16px 0" }} />
          {status.priceInPaise <= 0 && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>
              This plan has no billing price configured yet — contact support.
            </p>
          )}
          {status.priceInPaise > 0 && (!status.hasSubscription || status.businessStatus === "suspended" || status.businessStatus === "cancelled") && (
            <button className="btn primary" onClick={handleSubscribe} disabled={subscribing}>
              {subscribing ? "Starting…" : status.hasSubscription ? "Renew subscription" : "Subscribe"}
            </button>
          )}
          {status.priceInPaise > 0 && status.hasSubscription && status.businessStatus !== "suspended" && status.businessStatus !== "cancelled" && (
            <p style={{ color: "var(--muted)", fontSize: 13 }}>Your subscription renews automatically.</p>
          )}
        </div>
      )}
    </>
  );
}
