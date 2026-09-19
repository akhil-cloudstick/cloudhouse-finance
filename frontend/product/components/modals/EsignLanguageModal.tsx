"use client";

import { useState } from "react";
import { useModal } from "@/product/components/Modal";
import { Icon } from "@/product/components/Icon";
import { bondLangOptionsFor, type BondLang } from "@/product/pages/loans/utils/indemnityBond";
import { useBranding } from "@/product/providers/BrandingProvider";

/* Lets staff pick which pledge-agreement language goes to Setu before
 * starting the customer's Aadhaar eSign — LoanDetail.tsx's "Send Indemnity
 * Bond for eSign" action used to fire straight to Setu with "en" hardcoded
 * (see startIndemnityBondEsign's lang param); this puts that choice in
 * front of the officer instead, the same English/Malayalam choice
 * NewLoan.tsx's print button already offers via BOND_LANG_OPTIONS.
 *
 * A responsive 2-up card grid rather than Select.tsx's dropdown: there are
 * only ever the two languages, and seeing both named at once (with the
 * loan's own language names, not just "en"/"ml") is quicker to get right
 * than opening a list. Stacks to one column at modal width, so it reads
 * fine on a phone-width viewport too. */
export type EsignDeliverBy = "whatsapp" | "dashboard" | "open";

export function EsignLanguageModalContent({
  loanNumber,
  customerName,
  customerPhone,
  onConfirm,
  title = "Choose eSign Document & Delivery",
  confirmLabel,
  showDelivery = false,
}: {
  loanNumber: string;
  customerName: string;
  customerPhone?: string;
  onConfirm: (lang: BondLang, deliverBy?: EsignDeliverBy) => void | Promise<void>;
  title?: string;
  confirmLabel?: string;
  showDelivery?: boolean;
}) {
  const { closeModal } = useModal();
  const [lang, setLang] = useState<BondLang>("en");
  // Only the languages this business was granted. English always survives
  // the filter, so the picker can never render empty.
  const { languages } = useBranding();
  const langOptions = bondLangOptionsFor(languages);
  const [deliverBy, setDeliverBy] = useState<EsignDeliverBy>("whatsapp");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function confirm() {
    setBusy(true);
    setErr("");
    try {
      await onConfirm(lang, showDelivery ? deliverBy : undefined);
      closeModal();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not complete request.");
    } finally {
      setBusy(false);
    }
  }

  const effectiveConfirmContent = confirmLabel ? (
    confirmLabel
  ) : !showDelivery ? (
    "Confirm"
  ) : deliverBy === "whatsapp" ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Icon name="whatsapp" style={{ width: 15, height: 15 }} /> Send via WhatsApp →
    </span>
  ) : deliverBy === "dashboard" ? (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Icon name="smartphone" style={{ width: 15, height: 15 }} /> Send to Customer App →
    </span>
  ) : (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Icon name="externalLink" style={{ width: 15, height: 15 }} /> Open eSign Link →
    </span>
  );

  return (
    <>
      <div className="hd">
        <div>
          <h3>{title}</h3>
          <div className="sub" style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Loan {loanNumber} · {customerName}{customerPhone ? ` (${customerPhone})` : ""}
          </div>
        </div>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 8 }}>
          {showDelivery ? "1. Bond language" : "Bond language"}
        </span>
        <div className="esign-lang-grid" style={{ marginBottom: showDelivery ? 16 : 0 }}>
          {langOptions.map((o) => (
            <button
              type="button"
              key={o.value}
              className={`esign-lang-card${o.value === lang ? " sel" : ""}`}
              onClick={() => setLang(o.value)}
            >
              <span className="name">{o.label}</span>
              <span className="native">{o.native}</span>
              <span className="check">{o.value === lang ? "✓" : ""}</span>
            </button>
          ))}
        </div>

        {showDelivery && (
          <>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", marginBottom: 8 }}>
              2. Delivery method
            </span>
            <div className="esign-deliver-list">
              <button
                type="button"
                className={`esign-deliver-card${deliverBy === "whatsapp" ? " sel" : ""}`}
                onClick={() => setDeliverBy("whatsapp")}
              >
                <div className="icon-box whatsapp">
                  <Icon name="whatsapp" />
                </div>
                <div className="meta">
                  <span className="title">WhatsApp Message</span>
                  <span className="sub">
                    Send signing link to customer's WhatsApp{customerPhone ? ` (${customerPhone})` : ""}
                  </span>
                </div>
                <div className="radio-dot">{deliverBy === "whatsapp" ? "✓" : ""}</div>
              </button>

              <button
                type="button"
                className={`esign-deliver-card${deliverBy === "dashboard" ? " sel" : ""}`}
                onClick={() => setDeliverBy("dashboard")}
              >
                <div className="icon-box mobile">
                  <Icon name="smartphone" />
                </div>
                <div className="meta">
                  <span className="title">Customer Mobile App</span>
                  <span className="sub">
                    Deliver directly to customer's mobile app notification & dashboard
                  </span>
                </div>
                <div className="radio-dot">{deliverBy === "dashboard" ? "✓" : ""}</div>
              </button>

              <button
                type="button"
                className={`esign-deliver-card${deliverBy === "open" ? " sel" : ""}`}
                onClick={() => setDeliverBy("open")}
              >
                <div className="icon-box tab">
                  <Icon name="externalLink" />
                </div>
                <div className="meta">
                  <span className="title">Open in New Tab</span>
                  <span className="sub">
                    Open immediately in this browser (for in-person branch signing)
                  </span>
                </div>
                <div className="radio-dot">{deliverBy === "open" ? "✓" : ""}</div>
              </button>
            </div>
          </>
        )}

        {err && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}>{err}</p>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={busy}>Cancel</button>
        <button className="btn" onClick={confirm} disabled={busy}>
          {busy ? "Preparing…" : effectiveConfirmContent}
        </button>
      </div>
    </>
  );
}
