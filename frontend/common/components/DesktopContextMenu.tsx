"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { isDesktop, openDevTools } from "@/common/services/desktopBridge";

type MenuState = { x: number; y: number } | null;

// Replaces WebView2's native right-click menu (disabled in main.go/the
// patched frontend.go). "Inspect" opens the developer tools (Elements,
// Console, Network, ...) straight away, the same as in a browser.
export function DesktopContextMenu() {
  const [menu, setMenu] = useState<MenuState>(null);

  useEffect(() => {
    if (!isDesktop()) return;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    const onClickAway = () => setMenu(null);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("click", onClickAway);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("click", onClickAway);
    };
  }, []);

  if (!isDesktop()) return null;

  return (
    <>
      {menu && (
        <div
          style={{
            position: "fixed", left: menu.x, top: menu.y, zIndex: 9999,
            background: "#fff", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.2)",
            padding: 4, minWidth: 140, fontSize: 13, fontFamily: "inherit",
          }}
        >
          <button
            type="button"
            onClick={() => { setMenu(null); location.reload(); }}
            style={menuItemStyle}
          >
            Reload
          </button>
          <button
            type="button"
            onClick={() => { setMenu(null); void openDevTools(); }}
            style={menuItemStyle}
          >
            Inspect
          </button>
        </div>
      )}
    </>
  );
}

const menuItemStyle: CSSProperties = {
  display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
  border: "none", background: "transparent", cursor: "pointer", borderRadius: 4,
  color: "#11101a",
};
