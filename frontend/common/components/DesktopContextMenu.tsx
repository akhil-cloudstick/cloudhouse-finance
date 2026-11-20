"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { isDesktop } from "@/common/services/desktopBridge";
import { PinModal } from "@/common/components/PinModal";
import { isSyncing } from "@/common/offline/sender";

type MenuState = { x: number; y: number } | null;

// Replaces WebView2's native right-click menu (disabled in main.go/the
// patched frontend.go). "Inspect" always opens the PIN modal fresh — no
// persisted unlock.
export function DesktopContextMenu() {
	const [menu, setMenu] = useState<MenuState>(null);
	const [pinOpen, setPinOpen] = useState(false);

	useEffect(() => {
		if (!isDesktop()) return;
		const onContextMenu = (e: MouseEvent) => {
			e.preventDefault();
			setMenu({ x: e.clientX, y: e.clientY });
		};
		const onClickAway = () => setMenu(null);
		// F12 = Inspect (always through the PIN); Ctrl+Shift+R = the same reload as the menu's, refused while a sync
		// runs (NetworkIndicator shows the "refresh is paused" notice for that case).
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "F12") {
				e.preventDefault();
				setMenu(null);
				setPinOpen(true);
			} else if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") {
				e.preventDefault();
				if (isSyncing()) return;
				location.reload();
			}
		};
		window.addEventListener("contextmenu", onContextMenu);
		window.addEventListener("click", onClickAway);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("contextmenu", onContextMenu);
			window.removeEventListener("click", onClickAway);
			window.removeEventListener("keydown", onKey);
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
						onClick={() => { setMenu(null); if (!isSyncing()) location.reload(); }}
						style={menuItemStyle}
					>
						Reload
					</button>
					<button
						type="button"
						onClick={() => { setMenu(null); setPinOpen(true); }}
						style={menuItemStyle}
					>
						Inspect
					</button>
				</div>
			)}
			{pinOpen && <PinModal onClose={() => setPinOpen(false)} />}
		</>
	);
}

const menuItemStyle: CSSProperties = {
	display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
	border: "none", background: "transparent", cursor: "pointer", borderRadius: 4,
	color: "#11101a",
};
