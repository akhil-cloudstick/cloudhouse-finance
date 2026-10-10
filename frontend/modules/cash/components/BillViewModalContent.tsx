"use client";

import { useEffect, useState } from "react";
import { useModal } from "@/common/components/ModalProvider";
import { SafeImage } from "@/common/components/ui/SafeImage";
import { fetchUploadFile } from "@/common/services/uploadService";

type BillViewModalContentProps = { title: string; url: string };

/* A bill image attached to any ledger entry (expense, cash-in, self transfer). */
export function BillViewModalContent({ title, url }: BillViewModalContentProps) {
  const { closeModal } = useModal();
  // Fetched with the session's own token and shown from a blob: a plain
  // <img src="/uploads/…"> relies on a cookie shared across browser tabs,
  // which another business's login in a second tab silently replaces.
  const [src, setSrc] = useState<string>("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl = "";
    let cancelled = false;
    fetchUploadFile(url)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (!cancelled) { objectUrl = URL.createObjectURL(b); setSrc(objectUrl); } })
      .catch(() => { if (!cancelled) { setSrc(url); setFailed(true); } });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  return (
    <>
      <div className="hd"><h3>Bill — {title}</h3><button className="x" onClick={closeModal}>×</button></div>
      <div className="bd bd-scroll" style={{ textAlign: "center" }}>
        {failed
          ? <SafeImage alt="Bill" />
          : src
            ? <img src={src} style={{ maxWidth: "100%", maxHeight: "70vh", borderRadius: 8 }} alt="Bill" />
            : <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading bill…</p>}
        {failed && <p style={{ color: "var(--muted)", fontSize: 12.5 }}>Could not load this bill.</p>}
      </div>
    </>
  );
}
