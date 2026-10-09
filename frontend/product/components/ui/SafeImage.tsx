"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { getAuthToken } from "@/product/services/httpClient";

/* An image that never shows the browser's broken-image icon. /uploads/* files
 * are fetched with the session token and shown from a blob: (a plain <img>
 * relies on a path-scoped cookie that is missing after a restored session or
 * another business's login in a second tab). When the file can't be loaded —
 * missing, forbidden, or corrupt — a neutral picture placeholder is drawn in
 * its place at the same size. */
export function SafeImage({ src, alt = "", style, title, onClick }: {
  src?: string; alt?: string; style?: CSSProperties; title?: string; onClick?: () => void;
}) {
  const [shown, setShown] = useState("");
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    setShown("");
    setFailed(!src);
    if (!src) return;
    // data:/blob:/external URLs need no session — use them as they are.
    if (!src.startsWith("/uploads/")) { setShown(src); return; }
    let objectUrl = "";
    let cancelled = false;
    const token = getAuthToken();
    fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((b) => { if (!cancelled) { objectUrl = URL.createObjectURL(b); setShown(objectUrl); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [src]);

  if (failed) {
    const small = typeof style?.width === "number" && style.width <= 64;
    return (
      <span
        role="img"
        aria-label={alt || "Image unavailable"}
        title={title ?? "Image unavailable"}
        onClick={onClick}
        style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: small ? style?.width : 160, height: small ? style?.height : 120,
          background: "#e6e8eb", color: "#8a949e", borderRadius: small ? 6 : 12,
          verticalAlign: "middle", cursor: onClick ? "pointer" : "default",
          ...style,
        }}
      >
        <svg viewBox="0 0 24 24" width="55%" height="55%" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="4.5" width="18" height="15" rx="2" />
          <circle cx="15.5" cy="9.5" r="1.8" fill="currentColor" stroke="none" />
          <path d="M3.5 18l5.2-6 3.6 4 2.4-2.6 5.3 4.6" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }
  if (!shown) {
    return <span style={{ display: "inline-block", width: 34, height: 34, borderRadius: 6, background: "#eef0f2", verticalAlign: "middle", ...style }} aria-busy />;
  }
  return <img src={shown} alt={alt} style={style} title={title} onClick={onClick} onError={() => setFailed(true)} />;
}
