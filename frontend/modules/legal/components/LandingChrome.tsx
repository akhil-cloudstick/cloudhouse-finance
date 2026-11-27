/* The landing site's header, footer, contact block and section heading, shared by the landing page and every
 * legal page. Same markup and classes as the CloudHouse POS site (landing-kit.css); only the brand differs.
 * No hooks, so it renders in server and client components alike. */

import Link from "next/link";
import type { ReactNode } from "react";
// Cropped to the artwork and transparent, so it sits cleanly on the see-through header at the kit's logo height.
import logoImg from "@/modules/legal/assets/cloudhouse-finance-logo.png";
import { CONTACT_ADDRESS_LINES, CONTACT_EMAIL, CONTACT_LEGAL_NAME, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_TEL, SUPPORT_HOURS } from "@/modules/legal/content/legalConfig";
import "@/modules/legal/styles/landing-brand.css";
import "@/modules/legal/styles/landing-kit.css";

// --- Constants ---

export const MAIL_ENQUIRY = `mailto:${CONTACT_EMAIL}?subject=CloudHouse%20Finance%20enquiry`;

const NAV = [
	{ id: "features", label: "Features" },
	{ id: "how-it-works", label: "How it works" },
	{ id: "faq", label: "FAQ" },
	{ id: "contact", label: "Contact" },
];

const LEGAL_LINKS = [
	{ slug: "privacy-policy", label: "Privacy policy" },
	{ slug: "terms-and-conditions", label: "Terms & conditions" },
	{ slug: "refund-policy", label: "Refund & cancellation" },
	{ slug: "account-deletion", label: "Account deletion" },
	{ slug: "data-safety", label: "Data safety" },
	{ slug: "disclaimer", label: "Disclaimer" },
	{ slug: "contact", label: "Support" },
];

// --- Brand ---

// Home links stay plain <a>: on the apex host the server maps "/" to the landing page, which Next's client
// router would not know (its own "/" is the product).

export function Brand() {
	return (
		<>
			{/* eslint-disable-next-line @next/next/no-img-element */}
			<img src={logoImg.src} alt="" width={logoImg.width} height={logoImg.height} />
			<span>
				CloudHouse <strong>Finance</strong>
			</span>
		</>
	);
}

// --- Header ---

// `onLanding`: section links scroll within the page; elsewhere (a legal page) they open the landing page there.
export function LandingHeader({ onLanding = false }: { onLanding?: boolean }) {
	return (
		<header className="lp-header">
			<div className="lp-wrap lp-header-row">
				<a className="lp-brand" href="/" aria-label="CloudHouse Finance home">
					<Brand />
				</a>
				<nav className="lp-nav" aria-label="Main">
					{NAV.map((item) => (
						<a key={item.id} href={onLanding ? `#${item.id}` : `/#${item.id}`}>
							{item.label}
						</a>
					))}
				</nav>
				<div className="lp-header-actions">
					<a className="lp-btn lp-btn-sm" href={MAIL_ENQUIRY}>
						Talk to us
					</a>
				</div>
			</div>
		</header>
	);
}

// --- Section head ---

export function SectionHead({ eyebrow, title, text }: { eyebrow: string; title: ReactNode; text?: string }) {
	return (
		<div className="lp-head" data-reveal>
			<span className="lp-eyebrow">{eyebrow}</span>
			<h2>{title}</h2>
			{text ? <p className="lp-sub">{text}</p> : null}
		</div>
	);
}

// --- Contact ---

export function ContactSection() {
	return (
		<section className="lp-section" id="contact">
			<div className="lp-wrap">
				<div className="lp-contact" data-reveal>
					<div>
						<span className="lp-eyebrow">Get in touch</span>
						<h2>Let&rsquo;s set up your branches</h2>
						<p className="lp-sub">Lenders who want to use CloudHouse Finance, and anyone who needs support, can reach us here.</p>
						<div className="lp-actions">
							<a className="lp-btn lp-btn-light" href={MAIL_ENQUIRY}>
								Email us
							</a>
							<a className="lp-btn lp-btn-ghost-light" href={`tel:${CONTACT_PHONE_TEL}`}>
								Call {CONTACT_PHONE_DISPLAY}
							</a>
						</div>
					</div>
					<ul className="lp-contact-list">
						<li>
							<a className="lp-contact-item" href={MAIL_ENQUIRY}>
								<span className="lp-contact-icon">{ICONS.mail}</span>
								<div>
									<small>Email</small>
									<span>{CONTACT_EMAIL}</span>
								</div>
							</a>
						</li>
						<li>
							<a className="lp-contact-item" href={`tel:${CONTACT_PHONE_TEL}`}>
								<span className="lp-contact-icon">{ICONS.phone}</span>
								<div>
									<small>Phone · {SUPPORT_HOURS}</small>
									<span>{CONTACT_PHONE_DISPLAY}</span>
								</div>
							</a>
						</li>
						<li>
							<div className="lp-contact-item">
								<span className="lp-contact-icon">{ICONS.pin}</span>
								<div>
									<small>{CONTACT_LEGAL_NAME}</small>
									<span style={{ fontWeight: 500 }}>{CONTACT_ADDRESS_LINES.join(" ")}</span>
								</div>
							</div>
						</li>
					</ul>
				</div>
			</div>
		</section>
	);
}

// --- Footer ---

// `base`: the legal set the links point at ("" for the root set, "/customer-app" for the customer app's).
export function LandingFooter({ base = "" }: { base?: string }) {
	return (
		<footer className="lp-footer">
			<div className="lp-wrap">
				<div className="lp-footer-top">
					<div className="lp-footer-brand">
						<a className="lp-brand" href="/" aria-label="CloudHouse Finance home">
							<Brand />
						</a>
						<p>
							Business software for licensed gold lenders: customer KYC, gold appraisal, loan records, vault tracking and reports. CloudHouse does not make loans.
						</p>
						<div className="lp-stores">
							<span className="lp-store">
								<small>Get it on</small>Google Play
							</span>
							<span className="lp-store">
								<small>Download on the</small>App Store
							</span>
						</div>
					</div>
					<nav className="lp-footer-links" aria-label="Legal and support">
						<span className="lp-footer-head">Policies</span>
						{LEGAL_LINKS.map((link) => (
							<Link key={link.slug} href={`${base}/${link.slug}`}>
								{link.label}
							</Link>
						))}
					</nav>
				</div>
				<div className="lp-footer-bottom">
					<span>
						© {new Date().getFullYear()} {CONTACT_LEGAL_NAME}
					</span>
					<span className="lp-powered">
						Powered by{" "}
						<a href="https://cloudhousetechnologies.com" target="_blank" rel="noopener noreferrer">
							CloudHouse
						</a>
					</span>
				</div>
			</div>
		</footer>
	);
}

// --- Icons ---

const ICON_PROPS = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const ICONS = {
	mail: (
		<svg {...ICON_PROPS}>
			<rect x="2" y="4" width="20" height="16" rx="2" />
			<path d="m22 7-10 6L2 7" />
		</svg>
	),
	phone: (
		<svg {...ICON_PROPS}>
			<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
		</svg>
	),
	pin: (
		<svg {...ICON_PROPS}>
			<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" />
			<circle cx="12" cy="10" r="3" />
		</svg>
	),
};
