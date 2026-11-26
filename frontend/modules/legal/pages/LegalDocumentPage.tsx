"use client";

import { useEffect, useMemo } from "react";
import { LegalLayout } from "@/modules/legal/components/LegalLayout";
import { buildDocument } from "@/modules/legal/content";
import { PROVIDER } from "@/modules/legal/services/legalService";
import type { LegalAudience, LegalDoc } from "@/modules/legal/types/legal-types";

type Props = { doc: LegalDoc; audience: LegalAudience };

/* A public page for app-store reviewers and customers: no session, no
 * AuthGuard. The provider is static, so the document renders straight away:
 * the exported HTML already holds the full text, and moving between legal
 * pages never flashes a loading state. */
export default function LegalDocumentPage({ doc, audience }: Props) {
	const content = useMemo(() => buildDocument(doc, audience, PROVIDER), [doc, audience]);

	useEffect(() => {
		window.document.title = `${content.title} – ${PROVIDER.name}`;
	}, [content]);

	return <LegalLayout doc={doc} audience={audience} provider={PROVIDER} document={content} />;
}
