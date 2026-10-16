import { apiFetchEnveloped as apiFetch } from "@/common/services/httpClient";
import type { BusinessProfile, BusinessProfileInput } from "@/modules/settings/types/settings-types";

export async function getBusinessProfile(): Promise<BusinessProfile> {
  return apiFetch<BusinessProfile>("/business-profile");
}

export async function updateBusinessProfile(input: BusinessProfileInput): Promise<BusinessProfile> {
  return apiFetch<BusinessProfile>("/business-profile", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}
