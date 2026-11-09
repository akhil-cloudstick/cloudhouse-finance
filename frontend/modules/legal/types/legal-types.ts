export const LEGAL_DOCS = [
	"privacy-policy",
	"account-deletion",
	"terms-and-conditions",
	"disclaimer",
	"refund-policy",
	"data-safety",
	"contact",
] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

/* The per-app sets at
 * /customer-app/<doc> and /staff-app/<doc>. */
export type LegalAudience = "customer" | "staff";

export type Provider = {
	name: string;
	legalName: string;
	addressLine: string;
	contactPhone: string;
	supportEmail: string;
	website: string;
	logoUrl: string;
};

/* A line that only one app's readers should see; a bare string shows to everyone. */
export type Line = string | { only: "customer" | "staff"; text: string };

/* A table row can be limited to one app the same way a Line is. */
export type LegalRowSource = string[] | { only: "customer" | "staff"; row: string[] };
export type LegalTableSource = { head: string[]; rows: LegalRowSource[] };
export type LegalTable = { head: string[]; rows: string[][] };

export type LegalSectionSource = { heading: string; body?: Line[]; list?: Line[]; table?: LegalTableSource };
export type LegalDocumentSource = { title: string; summary: string; sections: LegalSectionSource[] };

export type LegalSection = { heading: string; body: string[]; list: string[]; table?: LegalTable };
export type LegalDocument = { title: string; summary: string; sections: LegalSection[] };
