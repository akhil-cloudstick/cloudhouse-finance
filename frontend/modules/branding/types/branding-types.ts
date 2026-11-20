

export type PublicBranding = {
  name: string;
  legalName: string;
  /** Compact identity for tight spots (sidebar headline, tab title, login
   * subtext). Never empty — falls back to name server-side. */
  shortName: string;
  /** Sidebar subline under the headline. Unlike shortName this one CAN be
   * empty — no server-side fallback — which the lockup reads as "use the
   * business name, unless that would just repeat the headline". */
  lockupTagline: string;
  brandColor: string;
  /** Empty means "not set" — see frontend/common/config/theme.ts. */
  secondaryColor: string;
  accentColor: string;
  sidebarColor: string;
  fontFamily: string;
  fontScale: string;
  logoScale: string;
  logoDisplay: string;
  /** Empty when the business has no logo — render the platform mark. */
  logoUrl: string;
  appUrl: string;
  /** Text on the sidebar ground / on primary fills; empty = automatic. */
  navTextColor?: string;
  onBrandTextColor?: string;
  /** The vendor-arranged sidebar header, or null for the classic lockup.
   * Read through parseHeaderLayout (common/config/headerLayout.ts). */
  headerLayout?: unknown;
  /** False when shortName above is only the business-name fallback. */
  shortNameSet?: boolean;
};
export type MyBranding = PublicBranding & {
  addressLine: string;
  kmlRegNo: string;
  /** The business's own contact number(s), printed in slip/statement headers. */
  contactPhone?: string;
  /** Document family ("kml"/"gml"); decides the registration label on printed documents. */
  policy?: string;
  /** Optional modules this business has been granted (tenant.KnownModules). */
  modules: string[];
  /** Languages this business may issue customer documents in; always has "en". */
  languages: string[];
  /** Set per business by the vendor: work on the one default branch only. */
  singleBranch?: boolean;
};
/** A short-lived code that links the staff mobile app to this business —
 * see backend/internal/branding/connect.go. */
export type ConnectCode = {
  code: string;
  expiresAt: string;
  /** Seconds until it expires, counted from when the server issued it. */
  expiresIn: number;
};
