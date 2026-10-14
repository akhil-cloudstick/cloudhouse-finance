

// Mirrors backend/internal/branding's Public/Self — see that package's doc
// for why /public/branding/:code is unauthenticated and always answers 200.
export type PublicBranding = {
  name: string;
  legalName: string;
  brandColor: string;
  // Server-root-relative ("/api/v1/public/branding/:code/logo"), or empty —
  // empty means "use the platform mark" (see resolveLogoUrl below).
  logoUrl: string;
  appUrl: string;
};
export type SelfBranding = PublicBranding & {
  addressLine: string;
  kmlRegNo: string;
  contactPhone?: string;
  /** "kml"/"gml" — decides the registration label printed on documents. */
  policy?: string;
  modules: string[];
  languages: string[];
  singleBranch?: boolean;
};
