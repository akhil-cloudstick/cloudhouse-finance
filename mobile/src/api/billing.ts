import { apiRequestEnveloped as apiRequest } from "./client";

/** GET /billing/status — backend/internal/billing/service.go's Status. */
export type BillingStatus = {
  code: string;
  tierName: string;
  priceInPaise: number;
  businessStatus: string;
  hasSubscription: boolean;
  subscriptionExpiresAt?: string;
  gracePeriodEndsAt?: string;
};

/** GET /branches/quota — the business's plan and active-branch count.
 * quota 0 = unlimited. */
export type BranchQuota = {
  plan: string;
  quota: number;
  used: number;
  unlimited: boolean;
};

export function getBillingStatus() {
  return apiRequest<BillingStatus>("/billing/status");
}

export function getBranchQuota() {
  return apiRequest<BranchQuota>("/branches/quota");
}
