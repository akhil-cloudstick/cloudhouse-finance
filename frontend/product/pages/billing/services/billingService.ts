import { apiFetchEnveloped as apiFetch } from "@/product/services/httpClient";

/* Shape returned by the Go backend (backend/internal/billing/service.go). */
export type BillingStatus = {
  code: string; // tenant slug, e.g. "acme" → /login/acme
  tierName: string;
  priceInPaise: number;
  businessStatus: string; // tenant.Status — active/grace/suspended/...
  hasSubscription: boolean;
  subscriptionExpiresAt?: string;
  gracePeriodEndsAt?: string;
};

export type SubscribeResult = {
  subscriptionId: string;
  keyId: string;
};

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
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}
