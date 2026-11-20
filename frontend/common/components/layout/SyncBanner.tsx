"use client";

import { useEffect, useState } from "react";
import { isDesktop } from "@/common/services/desktopBridge";
import { offlineReady } from "@/common/offline";
import { SYNC_STATE_EVENT, drain, waitingCount } from "@/common/offline/sender";
import { syncProblem } from "@/common/offline/syncProblem";
import { useAuth } from "@/common/providers/AuthProvider";

/* Desktop app only. A strip under the top bar when this PC's saved changes cannot be sent:
 *  - the server answered with an error: the changes wait, are tried again every minute, and can be retried here;
 *  - the server no longer accepts the sign-in: the person keeps working and signs in again when they choose.
 * Nothing is drawn while everything is going out normally, and in a browser. */
export function SyncBanner() {
	const { logout } = useAuth();
	const [view, setView] = useState<{ stuck: boolean; authExpired: boolean; waiting: number }>({ stuck: false, authExpired: false, waiting: 0 });
	const [retrying, setRetrying] = useState(false);

	useEffect(() => {
		if (!isDesktop()) return;
		let alive = true;
		const update = async () => {
			if (!offlineReady()) return;
			const p = syncProblem();
			const waiting = p.stuck || p.authExpired ? await waitingCount().catch(() => 0) : 0;
			if (alive) setView({ ...p, waiting });
		};
		void update();
		window.addEventListener(SYNC_STATE_EVENT, update);
		const t = setInterval(update, 15_000);
		return () => {
			alive = false;
			window.removeEventListener(SYNC_STATE_EVENT, update);
			clearInterval(t);
		};
	}, []);

	if (!isDesktop() || (!view.authExpired && !(view.stuck && view.waiting > 0))) return null;

	const box: React.CSSProperties = {
		display: "flex",
		alignItems: "center",
		gap: 12,
		flexWrap: "wrap",
		padding: "8px 16px",
		fontSize: 13,
		background: "var(--warn-bg, #fff4d6)",
		color: "var(--warn-fg, #5c4300)",
		borderBottom: "1px solid var(--warn-border, #e8cf8a)",
	};
	const btn: React.CSSProperties = { marginLeft: "auto", padding: "4px 12px", borderRadius: 6, border: "1px solid currentColor", background: "transparent", color: "inherit", cursor: "pointer" };

	if (view.authExpired) {
		return (
			<div style={box} role="status">
				<span>
					Your sign-in has expired on the server. Everything you do is saved on this PC{view.waiting > 0 ? ` (${view.waiting} change${view.waiting === 1 ? "" : "s"} waiting)` : ""}. Sign in again to send it.
				</span>
				<button type="button" style={btn} onClick={() => logout()}>
					Sign in again
				</button>
			</div>
		);
	}

	return (
		<div style={box} role="status">
			<span>
				{view.waiting} change{view.waiting === 1 ? "" : "s"} could not be sent to the server yet. They are saved on this PC and tried again every minute.
			</span>
			<button
				type="button"
				style={btn}
				disabled={retrying}
				onClick={() => {
					setRetrying(true);
					void drain("banner retry").finally(() => setRetrying(false));
				}}
			>
				{retrying ? "Trying…" : "Retry now"}
			</button>
		</div>
	);
}
