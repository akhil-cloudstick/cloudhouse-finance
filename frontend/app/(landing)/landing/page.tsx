/* Public landing page for CloudHouse Finance, served at "/" on the apex host
 * only (see backend webstatic's isLandingHost). Static markup; the only client
 * code is LandingMotion's small scroll effects. No fetches, no backend. Copy is
 * deliberately about SOFTWARE sold to licensed lenders — CloudHouse does not
 * lend, and nothing here invites the public to apply for a loan (App Store
 * guideline 3.2.1(viii)).
 *
 * Header, footer, contact, buttons and type are the landing kit shared with
 * the CloudHouse POS site (modules/legal/styles/landing-kit.css). */

import type { CSSProperties, ReactNode } from "react";
// Imported, not linked from /public: bundled files are served from /_next/static on every host.
import heroImg from "@/modules/legal/assets/hero-phone.png";
import { ContactSection, LandingFooter, LandingHeader, MAIL_ENQUIRY, SectionHead } from "@/modules/legal/components/LandingChrome";
import { LandingMotion } from "@/modules/legal/components/LandingMotion";
import "@/modules/legal/styles/landing-finance.css";

const FEATURES: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: "Customer onboarding & KYC",
    text: "Capture customer details, ID documents and photos once, and keep each customer's full history in one record.",
    icon: <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM19 8v6M22 11h-6" />,
  },
  {
    title: "Gold appraisal & valuation",
    text: "Record weight and purity, apply the day's rate and your own policy, and see the eligible loan amount before you sanction.",
    icon: <path d="M6 3h12l4 6-10 12L2 9l4-6ZM2 9h20M12 21 8 9l4-6 4 6-4 12" />,
  },
  {
    title: "Loans, schemes & repayments",
    text: "Set up your own schemes, track interest and part payments, and give staff a clear view of what each loan owes today.",
    icon: <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 13h8M8 17h5" />,
  },
  {
    title: "Vault & packet tracking",
    text: "Tag each packet with a QR code, log where it sits, and reconcile the vault against the register at any time.",
    icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zM20 14v.01M14 20v.01M17 20h4v-3" />,
  },
  {
    title: "Overdue follow-up & auctions",
    text: "Spot overdue loans early, send reminders and run the auction steps with every action logged.",
    icon: <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />,
  },
  {
    title: "Branches, roles & reports",
    text: "Run several branches with role-based access, and export portfolio, cash and ledger reports when you need them.",
    icon: <path d="M3 3v18h18M7 15l4-6 4 3 4-8" />,
  },
];

const STEPS = [
  {
    title: "You get your own workspace",
    text: "We set up a separate workspace for your company in CloudHouse Finance, with your branches and staff roles. Your data is never mixed with another lender's.",
  },
  {
    title: "We provide your sign-in IDs",
    text: "CloudHouse creates and sends the login IDs for your team. There is no public sign-up.",
  },
  {
    title: "Sign in with the QR code",
    text: "Staff install the CloudHouse staff app, open the CloudHouse Finance sign-in page and scan the QR code shown there to sign in with their ID.",
  },
  {
    title: "Work starts",
    text: "Staff handle customers, loans and the vault from the app, and managers see everything on the web console.",
  },
];

const AUDIENCE = [
  { title: "Gold loan companies & NBFCs", text: "Multi-branch operations with staff permissions and reporting." },
  { title: "Cooperative & community lenders", text: "A simple, structured record for gold-backed lending teams." },
  { title: "Jewellery lenders & pawnbrokers", text: "Appraisal, custody and repayment tracking without registers." },
];

const FAQ = [
  {
    q: "Does CloudHouse Finance give loans?",
    a: "No. CloudHouse Finance is software. Loans are made only by the licensed lenders who use it, under their own licences and terms.",
  },
  {
    q: "Who can use the app?",
    a: "Only employees and field agents of a lender that has been set up on the platform. Sign-in IDs are provided by CloudHouse for the lender's team. There is no public sign-up.",
  },
  {
    q: "I am a borrower. Can I apply here?",
    a: "No. To apply for a loan or ask about your account, please contact the lender you deal with directly.",
  },
  {
    q: "How does a lender get access?",
    a: "Get in touch with us. After setup, the lender gets its own workspace and sign-in IDs from us. Staff install the app, open the sign-in page and scan the QR code shown there.",
  },
  {
    q: "Is each lender's data kept separate?",
    a: "Yes. Every lender works in its own workspace, with its own QR code and sign-in IDs.",
  },
  {
    q: "How do I delete my data or get support?",
    a: "Use the contact page or write to us at the email below. The privacy policy explains what is stored and how to request deletion.",
  },
];

const CHIPS = ["Multi-branch", "Role-based access", "QR vault tracking"];

// A short stagger for cards revealed together.
const delay = (index: number) => ({ "--lp-delay": `${index * 70}ms` }) as CSSProperties;

export default function LandingPage() {
  return (
    <div className="lp">
      <LandingMotion />
      <LandingHeader onLanding />

      <main>
        {/* The finance hero keeps its own dark maroon look (landing-finance.css); the rest of the page is the kit. */}
        <section className="lp-hero lp-hero-fin">
          <div className="lp-hero-glow lp-hero-glow-a" aria-hidden="true" />
          <div className="lp-hero-glow lp-hero-glow-b" aria-hidden="true" />
          <div className="lp-wrap lp-hero-grid">
            <div>
              <span className="lp-eyebrow">Software for licensed gold lenders</span>
              <h1>
                Run your gold lending business from <span className="lp-grad-text">one app.</span>
              </h1>
              <p className="lp-lead">
                CloudHouse Finance gives lenders a staff app and a back office for customer KYC, gold appraisal, loan
                records, vault tracking and reports, so branches stay organised and nothing lives in a register.
              </p>
              <div className="lp-actions">
                <a className="lp-btn lp-btn-light" href={MAIL_ENQUIRY}>
                  Talk to us
                </a>
                <a className="lp-btn lp-btn-ghost-light" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <ul className="lp-chips" aria-label="Highlights">
                {CHIPS.map((chip) => (
                  <li key={chip}>{chip}</li>
                ))}
              </ul>
              <p className="lp-note">
                This app is for lenders&rsquo; staff. CloudHouse does not make loans and is not open to loan applicants.
              </p>
            </div>

            <div className="lp-hero-visual lp-hero-visual-fin" aria-hidden="true">
              <div className="lp-float">
                <span className="lp-float-label">Gold rate today</span>
                <strong>24K &middot; &#8377;7,420/g</strong>
                <em>&#9650; 0.4%</em>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lp-hero-shot" src={heroImg.src} alt="" width={926} height={1699} />
            </div>
          </div>
        </section>

        <section id="features" className="lp-section lp-soft">
          <div className="lp-wrap">
            <SectionHead eyebrow="Features" title="Everything a branch does in a day" text="One system for the front counter, the vault and the back office." />
            <div className="lp-grid">
              {FEATURES.map((f, i) => (
                <article className="lp-card" key={f.title} data-reveal style={delay(i % 3)}>
                  <span className="lp-card-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      {f.icon}
                    </svg>
                  </span>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="lp-section">
          <div className="lp-wrap">
            <SectionHead eyebrow="Getting started" title="How a lender gets started" text="Each lender has its own workspace. Staff sign in to the app by scanning a QR code." />
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li className="lp-card" key={s.title} data-reveal style={delay(i)}>
                  <span className="lp-step-no" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section lp-soft">
          <div className="lp-wrap">
            <SectionHead eyebrow="Built for" title="Built for gold-backed lenders" />
            <div className="lp-grid">
              {AUDIENCE.map((a, i) => (
                <article className="lp-card" key={a.title} data-reveal style={delay(i)}>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="lp-section">
          <div className="lp-wrap lp-narrow">
            <SectionHead eyebrow="FAQ" title="Questions" />
            <div className="lp-faq" data-reveal>
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <ContactSection />
      </main>

      <LandingFooter />
    </div>
  );
}
