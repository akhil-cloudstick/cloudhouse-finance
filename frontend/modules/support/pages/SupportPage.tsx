"use client";

import { useState } from "react";
import { Icon } from "@/common/components/Icon";

/* Edit these two to change what the Support page shows. An empty SUPPORT_PHONE shows a
 * "not added yet" placeholder and hides the Call button. */
export const SUPPORT_EMAIL = "support@cloudhousetechnologies.com";
export const SUPPORT_PHONE: string = "";

const MAIL_HREF = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("Support request")}`;

/* Support — open to every signed-in user (no route permission). */
export function SupportPage() {
  const [copied, setCopied] = useState(false);
  const phoneHref = `tel:${SUPPORT_PHONE.replace(/[^\d+]/g, "")}`;
  const iconBox = { width: 18, height: 18, display: "inline-flex" } as const;
  const rowStyle = { display: "flex", alignItems: "center", gap: 10, fontSize: 14, margin: "14px 0" } as const;
  function copyEmail() {
    void navigator.clipboard?.writeText(SUPPORT_EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }
  return (
    <>
      <div className="page-h">
        <div><h1>Support</h1><p>We&apos;re here to help</p></div>
      </div>
      <hr className="gold-rule" />
      <div className="card" style={{ padding: 20, maxWidth: 480 }}>
        <p style={{ fontSize: 14, marginTop: 0 }}>
          Need help? Contact our support team for any questions or issues.
        </p>
        <div style={rowStyle}>
          <span className="i" style={iconBox}><Icon name="mail" /></span>
          <a href={MAIL_HREF} style={{ color: "inherit" }}>{SUPPORT_EMAIL}</a>
          <button type="button" className="btn ghost" title={copied ? "Copied" : "Copy email"} aria-label="Copy email" onClick={copyEmail} style={{ padding: 6, marginLeft: "auto" }}>
            <span className="i" style={iconBox}><Icon name={copied ? "check" : "copy"} /></span>
          </button>
        </div>
        <div style={rowStyle}>
          <span className="i" style={iconBox}><Icon name="phone" /></span>
          {SUPPORT_PHONE ? <a href={phoneHref} style={{ color: "inherit" }}>{SUPPORT_PHONE}</a> : <span style={{ opacity: 0.6 }}>Not added yet</span>}
        </div>
      </div>
    </>
  );
}
