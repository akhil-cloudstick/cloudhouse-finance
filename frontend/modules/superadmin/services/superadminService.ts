/* The superadmin console's API surface — backend/internal/superadmin.
 *
 * Deliberately its own fetch wrapper rather than reusing
 * common/services/httpClient.ts: that wrapper attaches the STAFF JWT and the
 * branch-switcher header (common/services/branchSelection.ts), neither of
 * which means anything for a superadmin session, which belongs to no
 * business and no branch. Reusing it would risk one day silently attaching
 * the wrong bearer token to a superadmin request. */
import { apiRawFetch } from "@/common/services/httpClient";
import { readSuperAdminToken } from "@/modules/superadmin/services/superadminSession";
import type { LoginResponse, Tier, Business, CreateBusinessInput, PaymentMode, SubscriptionPayment, BusinessOverview, RecordPaymentInput, AuditLogEntry, Catalogue, ProfileInput, ThemeInput, AdminLogin } from "@/modules/superadmin/types/superadmin-types";

export class SuperAdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = readSuperAdminToken();
  const res = await apiRawFetch(`${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts?.headers || {}),
    },
  });
  let body: { success?: boolean; data?: T; error?: string } | undefined;
  try {
    body = res.status === 204 ? undefined : await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || body?.success === false) {
    throw new SuperAdminApiError(body?.error || res.statusText, res.status);
  }
  return body?.data as T;
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/superadmin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function listTiers(): Promise<Tier[]> {
  return request<Tier[]>("/superadmin/tiers");
}

// Sets a tier's monthly Razorpay subscription price (plan Step 10). See
// superadmin.Service.SetTierPrice's doc comment for why this clears the
// tier's cached Razorpay Plan rather than mutating an existing one.
export function setTierPrice(id: number, priceInPaise: number, reason: string): Promise<Tier> {
  return request<Tier>(`/superadmin/tiers/${id}/price`, {
    method: "PUT",
    body: JSON.stringify({ priceInPaise, reason }),
  });
}

export function listBusinesses(): Promise<Business[]> {
  return request<Business[]>("/superadmin/businesses");
}

export function getBusiness(id: number): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}`);
}

export function createBusiness(input: CreateBusinessInput): Promise<Business> {
  return request<Business>("/superadmin/businesses", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function suspendBusiness(id: number, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/suspend`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function reactivateBusiness(id: number, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/reactivate`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export function deleteBusiness(id: number, reason: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/superadmin/businesses/${id}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function changeTier(id: number, tierId: number, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/tier`, {
    method: "PUT",
    body: JSON.stringify({ tierId, reason }),
  });
}

/* expiresAt as an ISO string, or null to clear it — see the backend
 * handler's doc comment on why the field is a pointer: present-with-null and
 * entirely-absent are different requests there, so always send the key. */
export function adjustExpiry(id: number, expiresAt: string | null, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/expiry`, {
    method: "PUT",
    body: JSON.stringify({ expiresAt, reason }),
  });
}

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

export function getBusinessOverview(id: number): Promise<BusinessOverview> {
  return request<BusinessOverview>(`/superadmin/businesses/${id}/overview`);
}

export function recordPayment(id: number, input: RecordPaymentInput): Promise<SubscriptionPayment> {
  return request<SubscriptionPayment>(`/superadmin/businesses/${id}/payments`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deletePayment(id: number, paymentId: number, reason: string): Promise<{ deleted: boolean }> {
  return request<{ deleted: boolean }>(`/superadmin/businesses/${id}/payments/${paymentId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function listAuditLog(filter?: { tenantId?: number; action?: string }): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (filter?.tenantId) params.set("tenantId", String(filter.tenantId));
  if (filter?.action) params.set("action", filter.action);
  const qs = params.toString();
  return request<AuditLogEntry[]>(`/superadmin/audit-log${qs ? `?${qs}` : ""}`);
}

/* The closed sets the checkboxes are built from, served from
 * tenant.KnownModules/KnownLanguages so the console can never offer a key
 * the backend would reject. */
export function getCatalogue(): Promise<Catalogue> {
  return request<Catalogue>("/superadmin/catalogue");
}

export type DevToolsPin = { pin: string; isSet: boolean; updatedAt?: string };

// Reversibly encrypted, not hashed, by design — can be read back as well as replaced.
// NOTE: fromApi() already renames is_set/updated_at to isSet/updatedAt generically;
// reading r.is_set here would silently be undefined.
export function getDevToolsPin(): Promise<DevToolsPin> {
  return request<DevToolsPin>("/superadmin/devtools-pin");
}

export function setDevToolsPin(pin: string, reason: string): Promise<{ updated: boolean }> {
  return request<{ updated: boolean }>("/superadmin/devtools-pin", {
    method: "PATCH",
    body: JSON.stringify({ pin, reason }),
  });
}

/* Note there is no `code` here. The sign-in code is part of the business's
 * identity — every staff member's /login/<code> bookmark depends on it — and
 * tenant.Tenant.Code documents it as immutable after creation. */
export function updateProfile(id: number, input: ProfileInput): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/profile`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export function setBranding(id: number, theme: ThemeInput): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/branding`, {
    method: "PUT",
    body: JSON.stringify(theme),
  });
}

export function setModules(id: number, modules: string[], reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/modules`, {
    method: "PUT",
    body: JSON.stringify({ modules, reason }),
  });
}

/* Switches one business between single- and multi-branch. Turning single-branch
 * on is refused (409) while the business has more than one active branch. */
export function setBranchMode(id: number, singleBranch: boolean, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/branch-mode`, {
    method: "PUT",
    body: JSON.stringify({ singleBranch, reason }),
  });
}

export function setLanguages(id: number, languages: string[], reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/languages`, {
    method: "PUT",
    body: JSON.stringify({ languages, reason }),
  });
}

export function getAdminLogin(id: number): Promise<AdminLogin> {
  return request<AdminLogin>(`/superadmin/businesses/${id}/admin`);
}

export function updateAdminLogin(
  id: number,
  input: { name: string; username: string; password: string; reason: string },
): Promise<AdminLogin> {
  return request<AdminLogin>(`/superadmin/businesses/${id}/admin`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/* Multipart, so it cannot go through request() — that helper sets a JSON
 * Content-Type, and setting any Content-Type by hand on a FormData body
 * strips the boundary the server needs to parse it. */
export async function uploadLogo(id: number, file: File, reason: string): Promise<Business> {
  const token = readSuperAdminToken();
  const form = new FormData();
  form.append("file", file);
  form.append("reason", reason);
  const res = await apiRawFetch(`/superadmin/businesses/${id}/logo`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  let body: { success?: boolean; data?: Business; error?: string } | undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || body?.success === false) {
    throw new SuperAdminApiError(body?.error || res.statusText, res.status);
  }
  return body?.data as Business;
}

/* The lender's signature, embedded by the backend on every printed document
 * with a lender/owner signature line (pledge agreements, FORM 7, release
 * receipts, debenture agreement). Multipart like uploadLogo; PNG/JPEG/WebP,
 * 1 MB max — the backend refuses anything else. */
export async function uploadSignature(id: number, file: File, reason: string): Promise<Business> {
  const token = readSuperAdminToken();
  const form = new FormData();
  form.append("file", file);
  form.append("reason", reason);
  const res = await apiRawFetch(`/superadmin/businesses/${id}/signature`, {
    method: "POST",
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: form,
  });
  let body: { success?: boolean; data?: Business; error?: string } | undefined;
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok || body?.success === false) {
    throw new SuperAdminApiError(body?.error || res.statusText, res.status);
  }
  return body?.data as Business;
}

/* Fetches the saved signature as an object URL for the preview. Fetched with
 * the bearer token rather than pointed at by <img src>, which would carry no
 * Authorization header. Caller revokes the URL. Null when none is set. */
export async function fetchSignatureUrl(id: number): Promise<string | null> {
  const token = readSuperAdminToken();
  const res = await apiRawFetch(`/superadmin/businesses/${id}/signature`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new SuperAdminApiError(res.statusText, res.status);
  return URL.createObjectURL(await res.blob());
}

export function clearLogo(id: number, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/logo?reason=${encodeURIComponent(reason)}`, {
    method: "DELETE",
  });
}

export function clearSignature(id: number, reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/signature?reason=${encodeURIComponent(reason)}`, {
    method: "DELETE",
  });
}
