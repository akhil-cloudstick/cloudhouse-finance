"use client";

import { useEffect, useState } from "react";
import { useBranding } from "@/common/providers/BrandingProvider";
import { hasCustomTitleBar, windowControls } from "@/common/services/desktopBridge";

/* The packaged app's window has no native frame, so the page draws its own
 * title bar in the business's secondary colour (--nav, the same colour as the
 * sidebar). It renders nothing in a browser or in a window that has a frame. */
export function DesktopTitleBar() {
  const { shortName, name, logoUrl } = useBranding();
  const [active, setActive] = useState(false);
  const [maximised, setMaximised] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasCustomTitleBar().then((yes) => {
      if (!cancelled) setActive(yes);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!active) return;
    document.documentElement.classList.add("has-titlebar");
    const sync = () => { void windowControls.isMaximised().then(setMaximised); };
    sync();
    window.addEventListener("resize", sync);
    return () => {
      document.documentElement.classList.remove("has-titlebar");
      window.removeEventListener("resize", sync);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div className="dtb" onDoubleClick={() => windowControls.toggleMaximise()}>
      <div className="dtb-title">
        {logoUrl && <img src={logoUrl} alt="" />}
        <span>{shortName || name || "CloudHouse Finance"}</span>
      </div>
      <div className="dtb-btns" onDoubleClick={(e) => e.stopPropagation()}>
        <button type="button" className="dtb-btn" aria-label="Minimise" onClick={() => windowControls.minimise()}>
          <svg viewBox="0 0 10 10"><path d="M0 5.5h10" /></svg>
        </button>
        <button
          type="button"
          className="dtb-btn"
          aria-label={maximised ? "Restore" : "Maximise"}
          onClick={() => windowControls.toggleMaximise()}
        >
          {maximised ? (
            <svg viewBox="0 0 10 10"><path d="M2.5 2.5v-2h7v7h-2M0.5 2.5h7v7h-7z" /></svg>
          ) : (
            <svg viewBox="0 0 10 10"><path d="M0.5 0.5h9v9h-9z" /></svg>
          )}
        </button>
        <button type="button" className="dtb-btn close" aria-label="Close" onClick={() => windowControls.close()}>
          <svg viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" /></svg>
        </button>
      </div>
    </div>
  );
}
