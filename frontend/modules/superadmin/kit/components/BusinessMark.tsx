import { useState } from "react";
import "../styles/parts.css";

/** Up to two initials from a business name ("Royal Silks" → "RS"). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}

/** Dark or white text, whichever reads better on the colour. */
function textOn(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#1f1d2b" : "#fff";
}

/** A business's mark in lists and headers: its logo, or its initials on its brand colour. */
export function BusinessMark({ name, logoUrl, color }: { name: string; logoUrl?: string | null | undefined; color?: string | null | undefined }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (logoUrl && failed !== logoUrl) return <img className="sa-biz-logo" src={logoUrl} alt="" onError={() => setFailed(logoUrl)} />;
  const bg = color || "#6d28d9";
  return (
    <span className="sa-biz-mark" style={{ background: bg, color: textOn(bg) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
