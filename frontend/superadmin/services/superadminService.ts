/* The superadmin console's API surface — backend/internal/superadmin.
 *
 * Deliberately its own fetch wrapper rather than reusing
 * common/services/httpClient.ts: that wrapper attaches the STAFF JWT and the
 * branch-switcher header (common/services/branchSelection.ts), neither of
 * which means anything for a superadmin session, which belongs to no
 * business and no branch. Reusing it would risk one day silently attaching
 * the wrong bearer token to a superadmin request. */
import { API_BASE } from "@/superadmin/services/apiBase";
import { readSuperAdminToken, type SuperAdminUser } from "@/superadmin/services/superadminSession";

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
  legalName: string;
  /* Compact identity for the sidebar headline/tab title/login subtext —
   * e.g. "CTFI" for "Chittilapilly Thommana Financiers & Investments".
   * Empty means "not set" (falls back to name at read time). */
  shortName: string;
  /* Free-text second line of the sidebar lockup, under the headline — the
   * full name ("Chittilapilly Thommana") for a business whose headline is a
   * short code, or a descriptor ("Gold Finance") for one whose headline is
   * its own name. Empty means "not set"; unlike shortName there is no
   * server-side fallback. */
  lockupTagline: string;
  addressLine: string;
  kmlRegNo: string;
  /* The regulatory regime this business lends under, one of the catalogue's
   * policy codes ("kml"/"gml"). It selects which FAMILY of customer-facing
   * paperwork the business issues, and bounds which document languages it may
   * be granted at all — see Catalogue.policies. Empty means the KML default,
   * which is what every business created before this field existed issued. */
  policy: string;
  appUrl: string;
  brandColor: string;
  /* Optional second/third colours and typography/logo presets — empty means
   * "not set"/"default". See frontend/common/config/theme.ts. */
  secondaryColor: string;
  accentColor: string;
  /* DIRECTLY-SET sidebar/login-panel dark ground colour — not derived from
   * brandColor. Empty means "auto" (derived from brandColor's own hue). */
  sidebarColor: string;
  fontFamily: string;
  fontScale: string;
  logoScale: string;
  logoDisplay: string;
  /* Empty when the business has no logo. Derived server-side from the
   * business code (tenant.Tenant.LogoPath) — never a raw storage key. */
  logoUrl: string;
  /* Optional modules and document languages this business has been granted.
   * Both arrive as arrays even though the backend stores them as CSV — see
   * tenant.Tenant's AfterFind. */
  modules: string[];
  languages: string[];
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
  /* Branding and entitlements, all optional — a business can be created bare
   * and fitted out afterwards through the profile/branding endpoints. Offered
   * here so the create form is one step rather than five. */
  legalName?: string;
  addressLine?: string;
  kmlRegNo?: string;
  /* Document policy. Omitted means the backend's KML default. Languages
   * outside this policy are rejected with a 400, not silently dropped. */
  policy?: string;
  appUrl?: string;
  brandColor?: string;
  modules?: string[];
  languages?: string[];
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

/* --- Business detail page ------------------------------------------------ */

/* Every figure is for the ONE business asked about — see
 * backend/internal/superadmin/overview.go's businessUsage. */
export type BusinessUsage = {
  branches: number;
  branchesTotal: number;
  /* 0 means unlimited (then `unlimited` is also true). */
  branchQuota: number;
  unlimited: boolean;
  employees: number;
  customers: number;
  loansTotal: number;
  loansActive: number;
  personalLoansActive: number;
  investmentsActive: number;
  goldSales: number;
  files: number;
  storageBytes: number;
  /* Rupees (not paise) — the loans table stores numeric rupees. */
  outstandingPrincipal: number;
  lastActivityAt?: string | null;
};

export type PaymentMode = "cash" | "bank_transfer" | "upi" | "cheque" | "card" | "other";

export const PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  upi: "UPI",
  cheque: "Cheque",
  card: "Card",
  other: "Other",
};

/* A hand-recorded plan payment. Information only — recording one charges
 * nothing and changes no status, plan or expiry. */
export type SubscriptionPayment = {
  id: number;
  tenantId: number;
  amountInPaise: number;
  paidOn: string;
  mode: PaymentMode;
  reference: string;
  note: string;
  periodFrom?: string | null;
  periodTo?: string | null;
  planName: string;
  recordedById: number;
  recordedByName: string;
  createdAt: string;
};

export type BusinessOverview = {
  business: Business;
  usage: BusinessUsage;
  payments: SubscriptionPayment[];
  totalPaidInPaise: number;
  lastPayment?: SubscriptionPayment | null;
  recentActivity: AuditLogEntry[];
};

export function getBusinessOverview(id: number): Promise<BusinessOverview> {
  return request<BusinessOverview>(`/superadmin/businesses/${id}/overview`);
}

export type RecordPaymentInput = {
  amountInPaise: number;
  paidOn: string; // YYYY-MM-DD
  mode: PaymentMode;
  reference?: string;
  note?: string;
  periodFrom?: string;
  periodTo?: string;
};

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

/* --- Branding and entitlements ---------------------------------------------
 *
 * Each of these is a separate endpoint rather than one big PUT, matching how
 * suspend/reactivate/tier already work here: every superadmin action carries
 * its own mandatory reason and produces its own audit row naming exactly
 * what changed. A combined "save everything" call would log one vague entry
 * for five different kinds of change.
 */

/* One selectable document policy. `languages` is the closed list of document
 * languages this policy actually has templates for — the console narrows its
 * language checkboxes to it once a policy is picked, so the mapping is never
 * duplicated here where it could drift from what the renderer can produce. */
export type PolicyOption = { code: string; label: string; languages: string[] };

export type Catalogue = {
  modules: string[];
  languages: string[];
  policies: PolicyOption[];
};

/* The closed sets the checkboxes are built from, served from
 * tenant.KnownModules/KnownLanguages so the console can never offer a key
 * the backend would reject. */
export function getCatalogue(): Promise<Catalogue> {
  return request<Catalogue>("/superadmin/catalogue");
}

export type ProfileInput = {
  name: string;
  legalName: string;
  shortName?: string;
  lockupTagline?: string;
  addressLine: string;
  kmlRegNo: string;
  policy: string;
  appUrl: string;
  reason: string;
};

/* Note there is no `code` here. The sign-in code is part of the business's
 * identity — every staff member's /login/<code> bookmark depends on it — and
 * tenant.Tenant.Code documents it as immutable after creation. */
export function updateProfile(id: number, input: ProfileInput): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/profile`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/* Every colour/typography/logo field the console's theme panel edits, sent
 * together in one call — mirrors backend/internal/superadmin.ThemeInput.
 * Each field is "#rrggbb"/a closed-set key, or "" to fall back to the
 * platform default (secondary/accent instead fall back to "unset" — see
 * theme.ts). The rest of each colour's ramp is derived from it in the
 * browser, so there is never more than these few values to set. */
export type ThemeInput = {
  brandColor: string;
  secondaryColor?: string;
  accentColor?: string;
  sidebarColor?: string;
  fontFamily?: string;
  fontScale?: string;
  logoScale?: string;
  logoDisplay?: string;
  reason: string;
};

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

export function setLanguages(id: number, languages: string[], reason: string): Promise<Business> {
  return request<Business>(`/superadmin/businesses/${id}/languages`, {
    method: "PUT",
    body: JSON.stringify({ languages, reason }),
  });
}

/* The business's Administrator login — how the vendor gets an owner back in
 * after a forgotten password. The password is write-only: it is never read
 * back, and an empty one on update keeps the current password. */
export type AdminLogin = { employeeId: number; name: string; username: string; phone: string };

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
  const res = await fetch(`${API_BASE}/superadmin/businesses/${id}/logo`, {
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
