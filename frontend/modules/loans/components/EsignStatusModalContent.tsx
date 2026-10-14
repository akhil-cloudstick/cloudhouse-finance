"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { Icon } from "@/common/components/Icon";
import { useToast } from "@/common/components/ToastProvider";
import { singleFlight } from "@/common/utils/singleFlight";
import type { IndemnityBondEsignCheck } from "@/modules/loans/types/loan-types";

/* Shows every signer of an eSign request (customer, then the two witnesses on the bond) with a
 * Pending / Verified badge that flips as each of them completes Aadhaar signing. In link mode each
 * row also carries the signer's own link — staff open or copy it for the person, nothing opens by
 * itself. The status is re-checked on open, every 15 seconds, and on demand. */
export type EsignStatusSigner = { label: string; name?: string; url?: string };

type EsignStatusModalContentProps = {
  title: string;
  loanNumber: string;
  signers: EsignStatusSigner[];
  check: () => Promise<IndemnityBondEsignCheck>;
  // Called once, when the whole document is signed, so the page can reload the loan.
  onComplete: () => void;
  // Called when the provider reports the request failed or expired, so a new one can be started.
  onFailed?: () => void;
};

const POLL_MS = 15_000;

export function EsignStatusModalContent({ title, loanNumber, signers, check, onComplete, onFailed }: EsignStatusModalContentProps) {
  const { closeModal } = useModal();
  const toast = useToast();
  const [signed, setSigned] = useState<boolean[]>(() => signers.map(() => false));
  // After a page reload the links are gone, so the rows come from the provider's own signer count.
  const rows: EsignStatusSigner[] = Array.from({ length: Math.max(signers.length, signed.length) }, (_, i) => signers[i] ?? { label: `Witness ${i}` });
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const completed = useRef(false);

  const refresh = useCallback(async (manual: boolean) => singleFlight("modal:esignstatus:check", async () => {
    setChecking(true);
    try {
      const res = await check();
      const isDone = res.status === "sign_complete";
      const count = Math.max(signers.length, res.signers?.length ?? 0);
      setSigned(Array.from({ length: count }, (_, i) => isDone || !!res.signers?.[i]?.signed));
      setFailed(res.status === "failed");
      if (res.status === "failed") onFailed?.();
      if (isDone) {
        setDone(true);
        if (!completed.current) { completed.current = true; onComplete(); }
      } else if (manual) {
        toast(res.status === "failed" ? "Aadhaar eSign failed — please try again." : "Still waiting on the remaining signers.");
      }
    } catch (e) {
      if (manual) toast(e instanceof Error ? e.message : "Could not check eSign status.");
    } finally {
      setChecking(false);
    }
  }), [check, onComplete, onFailed, signers, toast]);

  useEffect(() => {
    void refresh(false);
    const t = setInterval(() => { if (!completed.current) void refresh(false); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <>
      <div className="hd">
        <div>
          <h3>{title}</h3>
          <div className="sub" style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>Loan {loanNumber}</div>
        </div>
        <button className="x" onClick={closeModal}>×</button>
      </div>
      <div className="bd bd-scroll">
        <p style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 10 }}>
          Each person signs with their own Aadhaar OTP, on their own phone.
        </p>
        {rows.map((s, i) => (
          <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: i < rows.length - 1 ? "1px solid var(--line, #e5e5ee)" : undefined }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <label className="f" style={{ margin: 0 }}>{s.label}{s.name ? ` — ${s.name}` : ""}</label>
              {signed[i]
                ? <span style={{ color: "var(--green)", fontWeight: 600, fontSize: 12.5, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon name="check" /> Verified</span>
                : <span style={{ color: "var(--amber)", fontWeight: 600, fontSize: 12.5 }}>{failed ? "Failed" : "Pending"}</span>}
            </div>
            {s.url && !signed[i] && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {/* The URL itself is never shown: it carries a token. */}
                <button className="btn ghost" onClick={() => window.open(s.url, "_blank", "noopener,noreferrer")}>Open link</button>
                <button className="btn ghost" onClick={() => navigator.clipboard.writeText(s.url!).then(() => toast("Link copied"), () => toast("Could not copy the link"))}>Copy link</button>
              </div>
            )}
          </div>
        ))}
        {done && <p style={{ color: "var(--green)", fontSize: 12.5 }}>All signatures are verified. The signed document is saved.</p>}
      </div>
      <div className="ft">
        <button className="btn ghost" onClick={closeModal}>Close</button>
        {!done && <button className="btn" onClick={() => void refresh(true)} disabled={checking}>{checking ? "Checking…" : "Check status"}</button>}
      </div>
    </>
  );
}
