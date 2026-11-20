

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
