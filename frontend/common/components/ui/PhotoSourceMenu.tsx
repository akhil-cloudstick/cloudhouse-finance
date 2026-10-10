"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/common/components/Icon";
import { WebcamCapture } from "@/common/components/ui/WebcamCapture";
import { useDropdownMenu } from "@/common/hooks/use-dropdown-menu";

const MENU_W = 190;
const MENU_H = 92;

type PhotoSourceMenuProps = {
  onFile: (f: File) => void;
  accept?: string;
  webcamTitle?: string;
  trigger: (t: { ref: RefObject<HTMLButtonElement | null>; toggle: () => void; open: boolean }) => ReactNode;
};

/**
 * One photo control instead of separate Upload / Webcam buttons: the
 * caller's trigger opens a small `docs-dd-menu` with "Upload from system"
 * (a hidden file input owned here) and "Take photo (webcam)" (opens
 * WebcamCapture). Either way the result comes back through `onFile` as a
 * `File`, so callers upload it the same way.
 *
 * The menu is portalled to <body> with fixed positioning rather than
 * `.docs-dd`'s absolute one — triggers live inside New Loan's horizontally
 * scrolling ornament table and inside scrolling modal bodies, where an
 * absolutely positioned menu gets clipped. It closes on scroll/resize
 * instead of trying to follow its trigger.
 */
export function PhotoSourceMenu({
  onFile,
  accept = "image/*",
  webcamTitle,
  trigger,
}: PhotoSourceMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const { open, setOpen, menuRef, triggerRef, onKeyDown } = useDropdownMenu<HTMLDivElement>();

  function toggle() {
    if (open) { setOpen(false); return; }
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const below = r.bottom + 6 + MENU_H <= window.innerHeight;
      setPos({
        top: below ? r.bottom + 6 : r.top - 6 - MENU_H,
        left: Math.min(Math.max(8, r.right - MENU_W), window.innerWidth - MENU_W - 8),
      });
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, setOpen]);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
      {trigger({ ref: triggerRef, toggle, open })}
      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="docs-dd-menu"
          role="menu"
          style={{ position: "fixed", top: pos.top, left: pos.left, right: "auto", width: MENU_W, zIndex: 95 }}
          // Keep Enter/arrows here from reaching a host modal's
          // Enter-to-submit handler (React bubbles through portals).
          onKeyDown={(e) => { e.stopPropagation(); onKeyDown(e); }}
        >
          <a href="#" role="menuitem" onClick={(e) => { e.preventDefault(); setOpen(false); inputRef.current?.click(); }}>
            <Icon name="upload" /><span className="tx">Upload from system</span>
          </a>
          <a href="#" role="menuitem" onClick={(e) => { e.preventDefault(); setOpen(false); setWebcamOpen(true); }}>
            <Icon name="camera" /><span className="tx">Take photo (webcam)</span>
          </a>
        </div>,
        document.body
      )}
      {webcamOpen && <WebcamCapture title={webcamTitle} onClose={() => setWebcamOpen(false)} onCapture={onFile} />}
    </>
  );
}
