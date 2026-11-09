import type { CSSProperties } from "react";
import type { LegalAudience, LegalDoc, LegalDocument, Provider } from "@/modules/legal/types/legal-types";
import { LEGAL_DOCS } from "@/modules/legal/types/legal-types";
import { DOC_TITLES } from "@/modules/legal/content";
import { LEGAL_LAST_UPDATED } from "@/modules/legal/content/legalConfig";

type Props = {
	doc: LegalDoc;
	audience: LegalAudience;
	provider: Provider;
	document: LegalDocument;
};

const BASE: Record<LegalAudience, string> = { customer: "/customer-app", staff: "/staff-app" };

const PAGE: CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "24px 16px 64px", lineHeight: 1.65, color: "var(--ink, #1c1b22)" };
const CARD: CSSProperties = { border: "1px solid var(--line, #dcd9e6)", borderRadius: 12, padding: "14px 16px", margin: "28px 0", background: "var(--card, #fff)" };
const H2: CSSProperties = { fontSize: "1.1rem", margin: "28px 0 8px" };
const CELL: CSSProperties = { border: "1px solid var(--line, #dcd9e6)", padding: "8px 10px", textAlign: "left", verticalAlign: "top" };

export function LegalLayout({ doc, audience, provider, document }: Props) {
	const base = BASE[audience];
	const details: [string, string][] = [
		["Provider", provider.legalName || provider.name],
		["Address", provider.addressLine],
		["Phone", provider.contactPhone],
		["Email", provider.supportEmail],
		["Website", provider.website],
	];
	return (
		<main style={PAGE}>
			<header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
				{provider.logoUrl ? (
					// eslint-disable-next-line @next/next/no-img-element
					<img src={provider.logoUrl} alt="" style={{ height: 40, width: "auto" }} />
				) : null}
				<strong>{provider.name}</strong>
			</header>

			<h1 style={{ fontSize: "1.6rem", margin: "0 0 6px" }}>{document.title}</h1>
			<p style={{ margin: 0 }}>{document.summary}</p>
			<p style={{ margin: "4px 0 0", opacity: 0.7, fontSize: "0.85rem" }}>Last updated: {LEGAL_LAST_UPDATED}</p>

			{document.sections.map((s) => (
				<section key={s.heading}>
					<h2 style={H2}>{s.heading}</h2>
					{s.body.map((p, i) => (
						<p key={i} style={{ margin: "0 0 8px" }}>{p}</p>
					))}
					{s.list.length > 0 && (
						<ul style={{ margin: "0 0 8px", paddingLeft: 22 }}>
							{s.list.map((li, i) => (
								<li key={i}>{li}</li>
							))}
						</ul>
					)}
					{s.table && (
						<div style={{ overflowX: "auto" }}>
							<table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.92rem" }}>
								<thead>
									<tr>{s.table.head.map((h) => <th key={h} style={CELL}>{h}</th>)}</tr>
								</thead>
								<tbody>
									{s.table.rows.map((r, i) => (
										<tr key={i}>{r.map((c, j) => <td key={j} style={CELL}>{c}</td>)}</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</section>
			))}

			<aside style={CARD} aria-label="App provider">
				<strong>App provider</strong>
				<dl style={{ margin: "8px 0 0", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 14px" }}>
					{details.filter(([, v]) => v).map(([k, v]) => (
						<div key={k} style={{ display: "contents" }}>
							<dt style={{ opacity: 0.7 }}>{k}</dt>
							<dd style={{ margin: 0, overflowWrap: "anywhere" }}>{v}</dd>
						</div>
					))}
				</dl>
			</aside>

			<nav aria-label="Other documents">
				<ul style={{ listStyle: "none", padding: 0, display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
					{LEGAL_DOCS.filter((d) => d !== doc).map((d) => (
						<li key={d}>
							<a href={`${base}/${d}`}>{DOC_TITLES[d]}</a>
						</li>
					))}
				</ul>
			</nav>
		</main>
	);
}
