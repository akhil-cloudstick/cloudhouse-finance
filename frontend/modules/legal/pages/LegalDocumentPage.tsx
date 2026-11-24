"use client";

import { useEffect, useMemo, useState } from "react";
import { LegalLayout } from "@/modules/legal/components/LegalLayout";
import { buildDocument } from "@/modules/legal/content";
import { fetchProvider } from "@/modules/legal/services/legalService";
import type { LegalAudience, LegalDoc, Provider } from "@/modules/legal/types/legal-types";

type Props = { doc: LegalDoc; audience: LegalAudience };

const MESSAGE = { maxWidth: 760, margin: "0 auto", padding: "48px 16px", lineHeight: 1.6 } as const;

/* A public page for app-store reviewers and customers: no session, no
 * AuthGuard. It waits for the provider's details rather than showing a
 * placeholder company, and says so plainly if they cannot be loaded. */
export default function LegalDocumentPage({ doc, audience }: Props) {
	const [provider, setProvider] = useState<Provider | null>(null);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		let live = true;
		fetchProvider().then((p) => {
			if (!live) return;
			if (p) setProvider(p);
			else setFailed(true);
		});
		return () => {
			live = false;
		};
	}, []);

	const content = useMemo(() => (provider ? buildDocument(doc, audience, provider) : null), [doc, audience, provider]);

	useEffect(() => {
		if (content && provider) window.document.title = `${content.title} – ${provider.name}`;
	}, [content, provider]);

	if (failed) return <main style={MESSAGE}>This page could not be loaded. Please refresh, or try again in a few minutes.</main>;
	if (!provider || !content) return <main style={MESSAGE}>Loading…</main>;
	return <LegalLayout doc={doc} audience={audience} provider={provider} document={content} />;
}
