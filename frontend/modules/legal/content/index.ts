import type {
	Line,
	LegalAudience,
	LegalDoc,
	LegalDocument,
	LegalDocumentSource,
	Provider,
} from "@/modules/legal/types/legal-types";
import { privacyPolicy } from "@/modules/legal/content/privacyPolicy";
import { accountDeletion } from "@/modules/legal/content/accountDeletion";
import { termsAndConditions } from "@/modules/legal/content/termsAndConditions";
import { disclaimer } from "@/modules/legal/content/disclaimer";
import { refundPolicy } from "@/modules/legal/content/refundPolicy";
import { dataSafety } from "@/modules/legal/content/dataSafety";
import { contact } from "@/modules/legal/content/contact";
import { APP_NAME } from "@/modules/legal/content/legalConfig";

const SOURCES: Record<LegalDoc, LegalDocumentSource> = {
	"privacy-policy": privacyPolicy,
	"account-deletion": accountDeletion,
	"terms-and-conditions": termsAndConditions,
	disclaimer,
	"refund-policy": refundPolicy,
	"data-safety": dataSafety,
	contact,
};

export const DOC_TITLES: Record<LegalDoc, string> = {
	"privacy-policy": privacyPolicy.title,
	"account-deletion": accountDeletion.title,
	"terms-and-conditions": termsAndConditions.title,
	disclaimer: disclaimer.title,
	"refund-policy": refundPolicy.title,
	"data-safety": dataSafety.title,
	contact: contact.title,
};

/* A detail the provider has not filled in reads as a pointer, never as a blank. */
function tokens(provider: Provider, audience: LegalAudience): Record<string, string> {
  return {
    provider: provider.legalName || provider.name,
    address: provider.addressLine || "our registered address",
    phone: provider.contactPhone || "the number on our Contact page",
    email: provider.supportEmail || "the address on our Contact page",
    website: provider.website || "—",
    app: APP_NAME,
  };
}

function fill(text: string, t: Record<string, string>): string {
	return text.replace(/\{\{(\w+)\}\}/g, (_, k: string) => t[k] ?? "");
}

function visible(lines: Line[] | undefined, audience: LegalAudience, t: Record<string, string>): string[] {
	const out: string[] = [];
	for (const l of lines ?? []) {
		if (typeof l === "string") out.push(fill(l, t));
		else if (audience === l.only) out.push(fill(l.text, t));
	}
	return out;
}

export function buildDocument(doc: LegalDoc, audience: LegalAudience, provider: Provider): LegalDocument {
	const src = SOURCES[doc];
	const t = tokens(provider, audience);
	return {
		title: src.title,
		summary: fill(src.summary, t),
		sections: src.sections.map((s) => ({
			heading: s.heading,
			body: visible(s.body, audience, t),
			list: visible(s.list, audience, t),
			table: s.table && {
				head: s.table.head,
				rows: s.table.rows.flatMap((r) => (Array.isArray(r) ? [r] : r.only === audience ? [r.row] : [])),
			},
		})),
	};
}
