"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { offlineStore } from "@/common/services/desktopBridge";
import { isStorageChoicePending, storageChoiceDone, subscribeStorageChoice } from "@/common/offline/storageChoice";

/* Asked once, the first time this PC signs in: where should the offline data be kept? "Choose folder" opens the
 * system's own folder picker; "Use default" keeps it under the user's profile. It can be changed later in
 * Settings > Offline storage. */
export function OfflineStoragePrompt() {
	const pending = useSyncExternalStore(subscribeStorageChoice, isStorageChoicePending, () => false);
	const [folder, setFolder] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (pending) void offlineStore.root().then(setFolder).catch(() => {});
	}, [pending]);

	if (!pending) return null;

	async function choose() {
		setBusy(true);
		setError("");
		try {
			const picked = await offlineStore.chooseFolder();
			if (picked) storageChoiceDone(); // "" means the picker was closed without choosing
		} catch (e) {
			setError(e instanceof Error ? e.message : "That folder could not be used.");
		} finally {
			setBusy(false);
		}
	}

	async function useDefault() {
		setBusy(true);
		setError("");
		try {
			await offlineStore.useDefaultFolder();
			storageChoiceDone();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Could not save the choice.");
		} finally {
			setBusy(false);
		}
	}

	return (
		<div role="dialog" aria-modal="true" aria-labelledby="offline-storage-title"
			style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
			<div className="card" style={{ maxWidth: 460, width: "100%", background: "var(--surface, #fff)", color: "var(--ink, #11101a)", borderRadius: 12, padding: 22, boxShadow: "0 12px 40px rgba(0,0,0,.25)" }}>
				<h3 id="offline-storage-title" style={{ margin: "0 0 8px" }}>Where should this PC keep offline data?</h3>
				<p style={{ margin: "0 0 16px", fontSize: 13.5, lineHeight: 1.55, color: "var(--muted, #62626f)" }}>
					Loans, customers and anything saved while the server is unreachable are kept in a folder on this PC until they are sent. Pick a drive and folder, or keep the default.
				</p>
				<div style={{ margin: "0 0 18px" }}>
					<div style={{ fontSize: 11.5, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--muted, #62626f)", marginBottom: 6 }}>
						Default folder
					</div>
					<div
						title={folder}
						style={{
							padding: "10px 12px",
							border: "1px solid var(--line, #e3e2e7)",
							borderRadius: 8,
							background: "rgba(0,0,0,.025)",
							fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
							fontSize: 12.5,
							lineHeight: 1.5,
							wordBreak: "break-all",
						}}
					>
						{folder || "…"}
					</div>
				</div>
				{error && <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--red, #c0392b)" }}>{error}</p>}
				<div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
					<button type="button" className="btn ghost" disabled={busy} onClick={() => void useDefault()}>Use default</button>
					<button type="button" className="btn" disabled={busy} onClick={() => void choose()}>Choose folder…</button>
				</div>
			</div>
		</div>
	);
}
