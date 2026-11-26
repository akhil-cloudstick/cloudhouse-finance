import type { LegalAudience, LegalDoc, LegalDocument, Provider } from "@/modules/legal/types/legal-types";
import { LEGAL_LAST_UPDATED } from "@/modules/legal/content/legalConfig";
import { LandingFooter, LandingHeader } from "@/modules/legal/components/LandingChrome";
import { LandingMotion } from "@/modules/legal/components/LandingMotion";

type Props = {
	doc: LegalDoc;
	audience: LegalAudience;
	provider: Provider;
	document: LegalDocument;
};

const BASE: Record<LegalAudience, string> = { customer: "/customer-app", staff: "" };

/* A legal page in the landing site's own header, footer, fonts and colours (the
 * shared landing kit, imported by LandingChrome), so the store listings' links
 * open on pages that look like the rest of the site. One plain document per
 * page, as store reviewers expect; the footer links to the other policies. The
 * kit is scoped to .lp, so it is safe under the product layout too
 * (/customer-app, /staff-app). */
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
		<div className="lp">
			<LandingMotion motionKey={doc} />
			<LandingHeader />
			<div className="lp-doc-hero">
				<div className="lp-wrap">
					<span className="lp-eyebrow">{audience === "customer" ? "Legal · Customer app" : "Legal"}</span>
					<h1>{document.title}</h1>
					<p className="lp-lead">{document.summary}</p>
					<p className="lp-doc-updated">Last updated: {LEGAL_LAST_UPDATED}</p>
				</div>
			</div>

			<div className="lp-wrap lp-doc-layout">
				<main className="lp-doc">
					{document.sections.map((s) => (
						<section key={s.heading}>
							<h2>{s.heading}</h2>
							{s.body.map((p, i) => (
								<p key={i}>{p}</p>
							))}
							{s.list.length > 0 && (
								<ul>
									{s.list.map((li, i) => (
										<li key={i}>{li}</li>
									))}
								</ul>
							)}
							{s.table && (
								<div className="lp-doc-table" role="region" aria-label={s.heading} tabIndex={0}>
									<table>
										<thead>
											<tr>
												{s.table.head.map((h) => (
													<th key={h} scope="col">
														{h}
													</th>
												))}
											</tr>
										</thead>
										<tbody>
											{s.table.rows.map((r, i) => (
												<tr key={i}>
													{r.map((c, j) => (
														<td key={j}>{c}</td>
													))}
												</tr>
											))}
										</tbody>
									</table>
								</div>
							)}
						</section>
					))}

					<aside className="lp-doc-provider" aria-label="App provider">
						<h2>App provider</h2>
						<dl>
							{details
								.filter(([, v]) => v)
								.map(([k, v]) => (
									<div key={k} style={{ display: "contents" }}>
										<dt>{k}</dt>
										<dd>{v}</dd>
									</div>
								))}
						</dl>
					</aside>
				</main>
			</div>

			<LandingFooter base={base} />
		</div>
	);
}
