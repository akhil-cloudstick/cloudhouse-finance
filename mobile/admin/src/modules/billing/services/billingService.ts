import { apiRequestEnveloped as apiRequest } from "@/common/services/httpClient";
import type { BillingStatus, BranchQuota } from "@/modules/billing/types/billing-types";

export function getBillingStatus() {
  return apiRequest<BillingStatus>("/billing/status");
}

export function getBranchQuota() {
  return apiRequest<BranchQuota>("/branches/quota");
}
