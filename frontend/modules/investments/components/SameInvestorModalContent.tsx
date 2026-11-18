"use client";

import { useState } from "react";
import { Icon } from "@/common/components/Icon";
import { useModal } from "@/common/components/ModalProvider";
import { type SameIdentityMatch } from "@/modules/investments/services/investorService";

type SameInvestorModalContentProps = {
  /* The name being entered, shown beside the investor(s) already on file. */
  newName: string;
  matches: SameIdentityMatch[];
  /* "Yes, same person" — the investor is added although the number is already on file. */
  onConfirm: () => Promise<void> | void;
};

/* Shown when a new investor's phone number, PAN or Aadhaar is already on another investor under a different name.
 * Adding is held until the user says whether it is the same person. */
export function SameInvestorModalContent({ newName, matches, onConfirm }: SameInvestorModalContentProps) {
  const { closeModal } = useModal();
  const [busy, setBusy] = useState(false);
  // Already an investor: "yes" uses that record (no second one is added). Only a borrower: the investor is created for them.
  const hasInvestor = matches.some((m) => m.source === "investor");

  async function yes() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  const person = (name: string, sub: string, tone: "old" | "new") => (
    <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
      <span
        aria-hidden
        style={{ width: 38, height: 38, flex: "none", borderRadius: "50%", display: "grid", placeContent: "center", fontWeight: 700, fontSize: 15, background: tone === "new" ? "var(--amber-bg)" : "var(--brand-faint)", color: tone === "new" ? "var(--amber)" : "var(--brand-deep)" }}
      >
        {(name.trim()[0] || "?").toUpperCase()}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={name}>{name}</div>
        <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>
      </div>
    </div>
  );

  return (
    <>
      <div className="hd">
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon name="warning" /> Same person?</h3>
        <button className="x" onClick={closeModal} aria-label="Close">×</button>
      </div>
      <div className="bd bd-scroll">
        <p style={{ margin: "0 0 14px", fontSize: 13.5, lineHeight: 1.5 }}>
          This phone number, PAN or Aadhaar is already on file{hasInvestor ? " for an investor" : " for a borrower"}. Is <b>{newName}</b> the same person?
        </p>

        <label className="f">Already on file</label>
        <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
          {matches.map((m) => (
            <div key={m.id} className="card" style={{ padding: "12px 14px", display: "grid", gap: 10 }}>
              {person(m.name, [m.code, m.phone].filter(Boolean).join(" · "), "old")}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span className="chip">{m.source === "investor" ? "Investor" : "Borrower"}</span>
                {m.fields.map((f) => <span key={f} className="chip amber">{f} matches</span>)}
              </div>
            </div>
          ))}
        </div>

        <label className="f">You are adding</label>
        <div className="card" style={{ padding: "12px 14px" }}>{person(newName, "New investor", "new")}</div>
      </div>
      <div className="ft" style={{ display: "flex", gap: 8 }}>
        <div className="sp" />
        <button className="btn ghost" onClick={closeModal} disabled={busy}>No, different person</button>
        <button className="btn" onClick={yes} disabled={busy}><Icon name="check" /> {busy ? "Please wait…" : hasInvestor ? "Yes, use existing investor" : "Yes, same person"}</button>
      </div>
    </>
  );
}
