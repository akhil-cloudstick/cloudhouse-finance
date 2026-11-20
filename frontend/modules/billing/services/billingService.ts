import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { BillingStatus, SubscribeResult } from "@/modules/billing/types/billing-types";

export async function getBillingStatus(): Promise<BillingStatus> {
  return apiFetch<BillingStatus>("/billing/status");
}

export async function subscribe(): Promise<SubscribeResult> {
  return apiFetch<SubscribeResult>("/billing/subscribe", { method: "POST" });
}

export async function confirmSubscription(
  razorpaySubscriptionId: string,
  razorpayPaymentId: string,
  razorpaySignature: string
): Promise<void> {
  await apiFetch("/billing/confirm", {
    method: "POST",
    body: JSON.stringify({ razorpaySubscriptionId, razorpayPaymentId, razorpaySignature }),
  });
}

export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return "-";
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
