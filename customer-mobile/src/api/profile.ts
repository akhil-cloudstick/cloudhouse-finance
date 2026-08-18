import { apiRequest } from "./client";
import { Customer } from "../types/customer";

// GET /customer/profile — the authenticated customer's own full record
// (backend/internal/customer/model.go's CustomerResponse shape). There is
// no :id — the backend derives the customer entirely from the JWT.
export function getProfile(): Promise<Customer> {
  return apiRequest("/profile");
}

// POST /customer/profile/verify-pan — triggers a live Setu PAN-verify call
// against this customer's on-file PAN (backend/internal/customer/service.go's
// VerifyPAN, reused unmodified for staff and customer callers alike).
export function verifyPAN(): Promise<{ customer: Customer; message: string; matchedName?: string; traceId?: string }> {
  return apiRequest("/profile/verify-pan", { method: "POST" });
}

// POST /customer/profile/aadhaar/start — begins a DigiLocker Aadhaar-verify
// request; redirectUrl is where DigiLocker sends the customer's browser back
// to once they finish logging in (an expo-linking deep link into this app).
export function startAadhaarVerify(redirectUrl: string): Promise<{ id: string; url: string; status: string; validUpto?: string }> {
  return apiRequest("/profile/aadhaar/start", { method: "POST", body: { redirectUrl } });
}

// GET /customer/profile/aadhaar/status — poll after the DigiLocker browser
// flow returns. `customer` is only present once status is "authenticated".
export function checkAadhaarVerify(): Promise<{
  customer?: Customer;
  status: string;
  matchedName?: string;
  dob?: string;
}> {
  return apiRequest("/profile/aadhaar/status");
}
