import { type SuperAdminUser } from "@/modules/superadmin/services/superadminSession";

export type LoginResponse = { token: string; superAdminUser: SuperAdminUser };
export type Tier = {
  id: number;
  name: string;
  branchQuota: number;
  priceInPaise: number;
  isActive: boolean;
};
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
  /* Edited by the business itself (Settings > Business Profile), not here;
   * read-only in the console. Lender identity is GML only. */
  contactPhone?: string;
  lenderAge?: string;
  lenderPan?: string;
  lenderAadhaar?: string;
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
  /* Text on the sidebar ground / on primary-colour fills; empty = automatic. */
  navTextColor?: string;
  onBrandTextColor?: string;
  /* The arranged sidebar header as normalised JSON; empty = classic lockup.
   * Read with parseHeaderLayout (common/config/headerLayout.ts). */
  headerLayout?: string;
  /* Empty when the business has no logo. Derived server-side from the
   * business code (tenant.Tenant.LogoPath) — never a raw storage key. */
  logoUrl: string;
  /* Whether a lender signature has been uploaded — the image itself comes
   * from fetchSignatureUrl, behind the superadmin token. */
  hasSignature: boolean;
  /* Optional modules and document languages this business has been granted.
   * Both arrive as arrays even though the backend stores them as CSV — see
   * tenant.Tenant's AfterFind. */
  modules: string[];
  languages: string[];
  /* Single-branch mode: this business works only on its Head Office branch,
   * and Branch Management is hidden in its app. Per business. */
  singleBranch: boolean;
  createdAt: string;
  updatedAt: string;
};
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
  /* Document policy. Omitted means the backend's KML default. Languages
   * outside this policy are rejected with a 400, not silently dropped. */
  policy?: string;
  appUrl?: string;
  brandColor?: string;
  modules?: string[];
  languages?: string[];
  singleBranch?: boolean;
  reason: string;
};
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
export type RecordPaymentInput = {
  amountInPaise: number;
  paidOn: string; // YYYY-MM-DD
  mode: PaymentMode;
  reference?: string;
  note?: string;
  periodFrom?: string;
  periodTo?: string;
};
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
export type ProfileInput = {
  name: string;
  legalName: string;
  shortName?: string;
  lockupTagline?: string;
  policy: string;
  appUrl: string;
  reason: string;
};
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
  /* "" = automatic text colour. */
  navTextColor?: string;
  onBrandTextColor?: string;
  /* Arranged header JSON (serializeHeaderLayout); "" = classic lockup. The
   * backend overwrites the stored value on every call, so an untouched layout
   * must be sent back as it was, not omitted. */
  headerLayout?: string;
  reason: string;
};
/* The business's Administrator login — how the vendor gets an owner back in
 * after a forgotten password. The password is write-only: it is never read
 * back, and an empty one on update keeps the current password. */
export type AdminLogin = { employeeId: number; name: string; username: string; phone: string };

// One real build: one tenant (or "common" for a content release), one OS.
export type DesktopReleaseJob = {
  id: number;
  batchId: string;
  tenantCode: string;
  os: string;
  version: string;
  buildType: "full" | "content";
  status: "queued" | "preparing" | "building" | "uploading" | "verifying" | "done" | "failed" | "cancelled";
  createdAt: string;
};

// One version currently kept in B2 for a tenant — the plain history list, not the live in-progress view.
export type DesktopReleaseHistoryEntry = {
  tenantCode: string;
  os: string;
  version: string;
  downloadUrl: string;
};

export type TriggerDesktopReleaseInput = {
  tenantCode?: string; // "" or "all" = every tenant; ignored for buildType "content"
  version: string;
  buildType: "full" | "content";
  targets?: string[]; // e.g. ["win"]
  isDev: boolean; // true = build points at your local backend, not the tenant's real one
  reason: string;
};
