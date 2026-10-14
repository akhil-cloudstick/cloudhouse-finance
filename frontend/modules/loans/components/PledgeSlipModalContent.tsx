"use client";

import { useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { singleFlight } from "@/common/utils/singleFlight";
import type { EsignDeliverBy } from "@/modules/loans/components/EsignLanguageModalContent";

/* Collects how the pledge slip eSign link is delivered (GML only — the customer is the only
 * signer, no witnesses). Normal printing is chosen from the Documents menu's side picker. */
type PledgeSlipModalContentProps = {
  loanNumber: string;
  customerName: string;
  customerPhone?: string;
  onEsign: (deliverBy: EsignDeliverBy) => void | Promise<void>;
};

export function PledgeSlipModalContent({ loanNumber, customerName, customerPhone, onEsign }: PledgeSlipModalContentProps) {
  const { closeModal } = useModal();
  const [deliverBy, setDeliverBy] = useState<EsignDeliverBy>("whatsapp");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const deliveryOptions: { value: EsignDeliverBy; icon: "whatsapp" | "smartphone" | "externalLink"; box: string; title: string; sub: string }[] = [
    { value: "whatsapp", icon: "whatsapp", box: "whatsapp", title: "WhatsApp Message", sub: `Send signing link to customer's WhatsApp${customerPhone ? ` (${customerPhone})` : ""}` },
    { value: "open", icon: "externalLink", box: "tab", title: "Signing Link", sub: "Get the link to open or copy yourself, for in-person signing at the branch" },
  ];

  async function confirm() { return singleFlight("modal:pledgeslip:confirm", async () => {
    setErr("");
    setBusy(true);
    try {
      await onEsign(deliverBy);
      closeModal();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not complete request.");
    } finally {
      setBusy(false);
    }
  }); }

  return (
    <>
      <div className="hd">
        <div>
          <h3>Pledge Slip eSign</h3>
          <div className="sub" style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
            Loan {loanNumber} · {customerName}
          </div>
        </div>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <label className="f">Send signing link by</label>
        <div className="esign-deliver-list">
          {deliveryOptions.map((o) => (
            <button type="button" key={o.value} className={`esign-deliver-card${deliverBy === o.value ? " sel" : ""}`} onClick={() => setDeliverBy(o.value)}>
              <div className={`icon-box ${o.box}`}><Icon name={o.icon} /></div>
              <div className="meta"><span className="title">{o.title}</span></div>
              <div className="radio-dot">{deliverBy === o.value ? "✓" : ""}</div>
            </button>
          ))}
        </div>
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 8 }}>
          Only the customer signs, with their own Aadhaar OTP. Click “Check eSign Status” in Documents once they are done.
        </p>
        {err && <p style={{ color: "var(--red)", fontSize: 12.5, marginTop: 12 }}>{err}</p>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal} disabled={busy}>Cancel</button>
        <button className="btn" onClick={confirm} disabled={busy}>{busy ? "Preparing…" : "Send for eSign →"}</button>
      </div>
    </>
  );
}
