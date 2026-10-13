"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { bondLangOptionsFor, type BondLang } from "@/modules/loans/utils/indemnityBond";
import { useBranding } from "@/common/providers/BrandingProvider";
import { singleFlight } from "@/common/utils/singleFlight";
import type { EsignWitnessInput } from "@/modules/loans/types/loan-types";

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

type EsignLanguageModalContentProps = {
  loanNumber: string;
  customerName: string;
  customerPhone?: string;
  onConfirm: (lang: BondLang, deliverBy?: EsignDeliverBy, witnesses?: EsignWitnessInput[]) => void | Promise<void>;
  title?: string;
  confirmLabel?: string;
  showDelivery?: boolean;
  // Adds two witness name/mobile rows; each witness signs their own box with their own Aadhaar.
  showWitnesses?: boolean;
  // Overrides the business's granted bond languages, for a document with its own set (the personal loan bond).
  options?: { value: BondLang; label: string; native: string }[];
};

export function EsignLanguageModalContent({
  loanNumber,
  customerName,
  customerPhone,
  onConfirm,
  title = "Choose eSign Document & Delivery",
  confirmLabel,
  showDelivery = false,
  showWitnesses = false,
  options,
}: EsignLanguageModalContentProps) {
  const { closeModal } = useModal();
  const [lang, setLang] = useState<BondLang>(options?.[0]?.value ?? "en");
  // Only the languages this business was granted. English always survives
  // the filter, so the picker can never render empty.
  const { languages } = useBranding();
  const langOptions = options ?? bondLangOptionsFor(languages);
  const [deliverBy, setDeliverBy] = useState<EsignDeliverBy>("whatsapp");
  const [witnesses, setWitnesses] = useState<EsignWitnessInput[]>([{ name: "", phone: "" }, { name: "", phone: "" }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function setWitness(i: number, patch: Partial<EsignWitnessInput>) {
    setWitnesses((ws) => ws.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  }

  async function confirm() { return singleFlight("modal:esignlanguage:confirm", async () => {
    setErr("");
    // Both witnesses or neither — the bond has exactly two witness boxes.
    const filled = witnesses.filter((w) => w.name.trim() || w.phone.trim());
    if (showWitnesses && filled.length > 0) {
      const bad = witnesses.findIndex((w) => w.name.trim().length < 3 || w.phone.replace(/\D/g, "").length < 10);
      if (bad >= 0) {
        setErr(`Witness ${bad + 1} needs a name and a 10-digit mobile number (or clear both witnesses).`);
        return;
      }
    }
    setBusy(true);
    try {
      await onConfirm(
        lang,
        showDelivery ? deliverBy : undefined,
        showWitnesses && filled.length > 0 ? witnesses.map((w) => ({ name: w.name.trim(), phone: w.phone.trim() })) : undefined
      );
      closeModal();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not complete request.");
    } finally {
      setBusy(false);
    }
  }); }

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

        {showWitnesses && (
          <>
            <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".06em", display: "block", margin: "16px 0 8px" }}>
              {showDelivery ? "3. Witnesses (optional)" : "Witnesses (optional)"}
            </span>
            {witnesses.map((w, i) => (
              <div className="frow c2" key={i}>
                <div>
                  <label className="f">Witness {i + 1} name</label>
                  <input className="inp" value={w.name} onChange={(e) => setWitness(i, { name: e.target.value })} placeholder="As on Aadhaar" />
                </div>
                <div>
                  <label className="f">Witness {i + 1} mobile</label>
                  <input className="inp" inputMode="numeric" value={w.phone} onChange={(e) => setWitness(i, { phone: e.target.value })} placeholder="10-digit mobile" />
                </div>
              </div>
            ))}
            <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 6 }}>
              Each witness signs their own box with their own Aadhaar OTP. Leave both blank for the borrower to sign alone.
            </p>
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
