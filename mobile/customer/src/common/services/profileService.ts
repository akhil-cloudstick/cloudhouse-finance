import { apiRequestEnveloped as apiRequest } from "./httpClient";
import { Customer } from "@/common/types/customer-types";

// No :id param: the backend derives the customer entirely from the JWT.
export function getProfile(): Promise<Customer> {
  return apiRequest("/profile");
}

export function verifyPAN(): Promise<{ customer: Customer; message: string; matchedName?: string; traceId?: string }> {
  return apiRequest("/profile/verify-pan", { method: "POST" });
}

// redirectUrl is an expo-linking deep link DigiLocker sends the browser back to after login.
export function startAadhaarVerify(redirectUrl: string): Promise<{ id: string; url: string; status: string; validUpto?: string }> {
  return apiRequest("/profile/aadhaar/start", { method: "POST", body: { redirectUrl } });
}

// `customer` is only present once status is "authenticated".
export function checkAadhaarVerify(): Promise<{
  customer?: Customer;
  status: string;
  matchedName?: string;
  dob?: string;
}> {
  return apiRequest("/profile/aadhaar/status");
}
