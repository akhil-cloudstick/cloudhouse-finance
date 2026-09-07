/* The superadmin console's API surface — backend/internal/superadmin.
 *
 * Deliberately its own fetch wrapper rather than reusing
 * common/services/httpClient.ts: that wrapper attaches the STAFF JWT and the
 * branch-switcher header (common/services/branchSelection.ts), neither of
 * which means anything for a superadmin session, which belongs to no
 * business and no branch. Reusing it would risk one day silently attaching
 * the wrong bearer token to a superadmin request. */
import { API_BASE } from "@/common/services/httpClient";
import { readSuperAdminToken, type SuperAdminUser } from "@/common/services/superadminSession";

export class SuperAdminApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = readSuperAdminToken();
  const res = await fetch(`${API_BASE}${path}`, {
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

export type LoginResponse = { token: string; superAdminUser: SuperAdminUser };

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/superadmin/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export type Tier = {
  id: number;
  name: string;
  branchQuota: number;
  priceInPaise: number;
  isActive: boolean;
};

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

export type Business = {
  id: number;
  name: string;
  code: string;
  tierId: number;
  tier: Tier;
  status: string;
  subscriptionExpiresAt?: string | null;
  gracePeriodEndsAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function listBusinesses(): Promise<Business[]> {
  return request<Business[]>("/superadmin/businesses");
}

export function getBusiness(id: number): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}`);
}

export type CreateBusinessInput = {
  name: string;
  code: string;
  tierId: number;
  adminUsername: string;
  adminPassword: string;
  adminName?: string;
  adminPhone?: string;
  reason: string;
};

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

export type AuditLogEntry = {
  id: number;
  superAdminUserId: number;
  actorName: string;
  action: string;
  tenantId?: number | null;
  tenantName?: string;
  detail: string;
  reason: string;
  ipAddress: string;
  createdAt: string;
};

export function listAuditLog(filter?: { tenantId?: number; action?: string }): Promise<AuditLogEntry[]> {
  const params = new URLSearchParams();
  if (filter?.tenantId) params.set("tenantId", String(filter.tenantId));
  if (filter?.action) params.set("action", filter.action);
  const qs = params.toString();
  return request<AuditLogEntry[]>(`/superadmin/audit-log${qs ? `?${qs}` : ""}`);
}
