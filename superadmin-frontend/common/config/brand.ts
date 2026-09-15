/* VENDOR is us — the company that sells and operates this software — as
 * distinct from a tenant BUSINESS's own name/logo/colour, which this app
 * never touches: the superadmin console is our internal tool and always
 * says so, regardless of which business is being edited. See
 * frontend/common/config/brand.ts's own header for the fuller reasoning;
 * this app only needs the one constant, not the tenant-branding machinery
 * (BrandingProvider, printBrand, etc.) that lives alongside it there. */
export const VENDOR = {
  name: "CloudHouse Technologies",
  shortName: "CloudHouse",
  product: "Superadmin Console",
  markSrc: "/cloudhouse-mark.png",
} as const;
