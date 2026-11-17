/* Public landing page for CloudHouse Finance, served at "/" on the apex host
 * only (see backend webstatic's isLandingHost). Pure static markup: no client
 * JS, no fetches, no backend. Copy is deliberately about SOFTWARE sold to
 * licensed lenders — CloudHouse does not lend, and nothing here invites the
 * public to apply for a loan (App Store guideline 3.2.1(viii)). */

import Link from "next/link";
import { CONTACT_ADDRESS_LINES, CONTACT_EMAIL, CONTACT_LEGAL_NAME, CONTACT_PHONE_DISPLAY, CONTACT_PHONE_TEL } from "@/modules/legal/content/legalConfig";

const SUPPORT_EMAIL = CONTACT_EMAIL;
const PHONE_DISPLAY = CONTACT_PHONE_DISPLAY;
const PHONE_TEL = CONTACT_PHONE_TEL;

const FEATURES = [
  {
    title: "Customer onboarding & KYC",
    text: "Capture customer details, ID documents and photos once, and keep each customer's full history in one record.",
  },
  {
    title: "Gold appraisal & valuation",
    text: "Record weight and purity, apply the day's rate and your own policy, and see the eligible loan amount before you sanction.",
  },
  {
    title: "Loans, schemes & repayments",
    text: "Set up your own schemes, track interest and part payments, and give staff a clear view of what each loan owes today.",
  },
  {
    title: "Vault & packet tracking",
    text: "Tag each packet with a QR code, log where it sits, and reconcile the vault against the register at any time.",
  },
  {
    title: "Overdue follow-up & auctions",
    text: "Spot overdue loans early, send reminders and run the auction steps with every action logged.",
  },
  {
    title: "Branches, roles & reports",
    text: "Run several branches with role-based access, and export portfolio, cash and ledger reports when you need them.",
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

export default function LandingPage() {
  return (
    <>
      <header className="lp-header">
        <div className="lp-wrap lp-header-row">
          <Link className="lp-brand" href="/" aria-label="CloudHouse Finance home">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/cloudhouse-mark.png" alt="" width={32} height={32} />
            <span>CloudHouse Finance</span>
          </Link>
          <nav className="lp-nav" aria-label="Main">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <a href="#faq">FAQ</a>
            <a href="#contact" className="lp-btn lp-btn-small">
              Contact
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-glow lp-hero-glow-a" aria-hidden="true" />
          <div className="lp-hero-glow lp-hero-glow-b" aria-hidden="true" />
          <div className="lp-wrap lp-hero-row">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">Software for licensed gold lenders</p>
              <h1>
                Run your gold lending business from <span className="lp-grad-text">one app.</span>
              </h1>
              <p className="lp-lead">
                CloudHouse Finance gives lenders a staff app and a back office for customer KYC, gold
                appraisal, loan records, vault tracking and reports, so branches stay organised and
                nothing lives in a register.
              </p>
              <div className="lp-actions">
                <a className="lp-btn lp-btn-light" href={`mailto:${SUPPORT_EMAIL}?subject=CloudHouse%20Finance%20enquiry`}>
                  Talk to us
                </a>
                <a className="lp-btn lp-btn-outline" href="#how-it-works">
                  See how it works
                </a>
              </div>
              <ul className="lp-hero-chips" aria-label="Highlights">
                <li>Multi-branch</li>
                <li>Role-based access</li>
                <li>QR vault tracking</li>
              </ul>
              <p className="lp-note">
                This app is for lenders&rsquo; staff. CloudHouse does not make loans and is not open to
                loan applicants.
              </p>
            </div>

            <div className="lp-hero-visual" aria-hidden="true">
              <div className="lp-float lp-float-a">
                <span className="lp-float-label">Gold rate today</span>
                <strong>24K &middot; &#8377;7,420/g</strong>
                <em>&#9650; 0.4%</em>
              </div>

              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="lp-hero-phone" src="/hero-phone.png" alt="" width={700} height={1050} />
            </div>
          </div>
        </section>

        <section id="features" className="lp-section">
          <div className="lp-wrap">
            <h2>Everything a branch does in a day</h2>
            <p className="lp-sub">One system for the front counter, the vault and the back office.</p>
            <div className="lp-grid">
              {FEATURES.map((f) => (
                <article className="lp-card" key={f.title}>
                  <h3>{f.title}</h3>
                  <p>{f.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how-it-works" className="lp-section lp-tint">
          <div className="lp-wrap">
            <h2>How a lender gets started</h2>
            <p className="lp-sub">Each lender has its own workspace. Staff sign in to the app by scanning a QR code.</p>
            <ol className="lp-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <span className="lp-step-no" aria-hidden="true">
                    {i + 1}
                  </span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="lp-section">
          <div className="lp-wrap">
            <h2>Built for gold-backed lenders</h2>
            <div className="lp-grid lp-grid-3">
              {AUDIENCE.map((a) => (
                <article className="lp-card" key={a.title}>
                  <h3>{a.title}</h3>
                  <p>{a.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="lp-section lp-tint">
          <div className="lp-wrap lp-narrow">
            <h2>Questions</h2>
            <div className="lp-faq">
              {FAQ.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="lp-section">
          <div className="lp-wrap lp-contact">
            <div>
              <h2>Get in touch</h2>
              <p className="lp-sub">
                Lenders who want to use CloudHouse Finance, and anyone who needs support, can reach
                us here.
              </p>
              <p className="lp-actions">
                <a className="lp-btn" href={`mailto:${SUPPORT_EMAIL}`}>
                  {SUPPORT_EMAIL}
                </a>
                <a className="lp-btn lp-btn-ghost" href={`tel:${PHONE_TEL}`}>
                  {PHONE_DISPLAY}
                </a>
              </p>
            </div>
            <address className="lp-address">
              <strong>{CONTACT_LEGAL_NAME}</strong>
              {CONTACT_ADDRESS_LINES.map((line) => (
                <span key={line}>
                  <br />
                  {line}
                </span>
              ))}
            </address>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap">
          <nav className="lp-footer-links" aria-label="Legal and support">
            <a href="/privacy-policy">Privacy policy</a>
            <a href="/terms-and-conditions">Terms &amp; conditions</a>
            <a href="/account-deletion">Account deletion</a>
            <a href="/data-safety">Data safety</a>
            <a href="/disclaimer">Disclaimer</a>
            <a href="/contact">Support</a>
          </nav>
          <p>
            CloudHouse Finance is a product of CloudHouse Technologies Pvt. Ltd. &copy; 2026 All
            rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}
