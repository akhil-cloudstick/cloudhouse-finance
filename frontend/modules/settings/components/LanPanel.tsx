"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { lan, type LanDataMode, type LanLogEntry, type LanPeer, type LanProbe, type LanStatus, type LanStep } from "@/common/services/desktopBridge";

const MONO = "ui-monospace, SFMono-Regular, Consolas, monospace";
const LEVEL_COLOR: Record<string, string> = { info: "var(--muted)", ok: "#1a8d5f", warn: "#b7791f", error: "#d1383d" };
const STEP_LABEL: Record<LanStep["status"], string> = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "SKIP" };
const STEP_COLOR: Record<LanStep["status"], string> = { pass: "#1a8d5f", warn: "#b7791f", fail: "#d1383d", skip: "var(--muted)" };

const card: React.CSSProperties = { border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px" };
const hint: React.CSSProperties = { margin: 0, color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5 };

/* Network section of Settings (desktop only). Shows the other PCs found on the network (for example over one LAN cable),
 * tests the connection to them, lets an admin choose which PC is the main PC (the choice spreads to every PC), and shows
 * a live log that explains every step and every failure. It does not move or share any business data yet. */
export function LanPanel() {
	const supported = useMemo(() => lan.available(), []);
	const [status, setStatus] = useState<LanStatus | null>(null);
	const [peers, setPeers] = useState<LanPeer[]>([]);
	const [dataMode, setDataMode] = useState<LanDataMode | null>(null);
	const [log, setLog] = useState<LanLogEntry[]>([]);
	const [steps, setSteps] = useState<LanStep[] | null>(null);
	const [busy, setBusy] = useState("");
	const [probe, setProbe] = useState<LanProbe | null>(null);
	const [message, setMessage] = useState("");
	const [ip, setIp] = useState("");
	const [level, setLevel] = useState<"all" | "warn">("all");
	const [text, setText] = useState("");
	// the choice waiting for the admin's confirmation ("self" and "peer" choose a PC, "clear" removes the main PC)
	const [confirm, setConfirm] = useState<{ kind: "self" | "peer" | "clear"; id: string; name: string } | null>(null);
	const logRef = useRef<HTMLDivElement>(null);
	const stick = useRef(true);

	const refresh = useCallback(async () => {
		try {
			const [s, p, d] = await Promise.all([lan.status(), lan.peers(), lan.dataMode()]);
			setStatus(s);
			setPeers(p);
			setDataMode(d);
		} catch {
			/* the next tick tries again */
		}
	}, []);

	useEffect(() => {
		if (!supported) return;
		const load = () =>
			Promise.all([lan.status(), lan.peers(), lan.dataMode()])
				.then(([s, p, d]) => {
					setStatus(s);
					setPeers(p);
					setDataMode(d);
				})
				.catch(() => {
					/* the next tick tries again */
				});
		void load();
		void lan.log().then(setLog).catch(() => {});
		const t = setInterval(() => void load(), 2000);
		const offLog = lan.onLog((e) => setLog((l) => [...l, e].slice(-2000)));
		const offPeers = lan.onPeers(setPeers);
		return () => {
			clearInterval(t);
			offLog();
			offPeers();
		};
	}, [supported]);

	const shown = useMemo(() => {
		const q = text.trim().toLowerCase();
		return log.filter((e) => (level === "all" || e.level === "warn" || e.level === "error") && (!q || `${e.component} ${e.message}`.toLowerCase().includes(q)));
	}, [log, level, text]);

	useEffect(() => {
		const el = logRef.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [shown]);

	if (!supported) {
		return (
			<div style={{ maxWidth: 640 }}>
				<h4 style={{ margin: "0 0 6px" }}>Network</h4>
				<p style={hint}>Network tools are part of the desktop app. This copy of the app does not include them yet; install the latest desktop version.</p>
			</div>
		);
	}

	async function run<T>(name: string, job: () => Promise<T>): Promise<T | undefined> {
		setBusy(name);
		setMessage("");
		try {
			return await job();
		} catch (e) {
			setMessage(e instanceof Error ? e.message : "That did not work. See the log below.");
		} finally {
			setBusy("");
			void refresh();
		}
	}

	async function selfTest() {
		const r = await run("test", () => lan.selfTest(""));
		if (r) setSteps(r);
	}

	async function allow() {
		const r = await run("allow", () => lan.allowAccess());
		if (r) setMessage(r.message);
	}

	async function applyMain() {
		if (!confirm) return;
		const c = confirm;
		setConfirm(null);
		const r = await run("main", () => (c.kind === "clear" ? lan.clearMain() : lan.setMain(c.id)));
		if (r) setMessage(r.message);
	}

	async function testPeer(p: LanPeer) {
		setProbe(null);
		const r = await run(`peer-${p.id}`, () => lan.testPeer(`${p.ip}:${p.port}`));
		if (r) setProbe(r);
	}

	async function addByIp() {
		if (!ip.trim()) return;
		setProbe(null);
		const r = await run("add", () => lan.addPeer(ip.trim()));
		if (r) {
			setProbe(r);
			if (r.status === "reachable") setIp("");
		}
	}

	async function copyAll() {
		const lines = log.map((e) => `${e.time} ${e.level.toUpperCase().padEnd(5)} ${e.component.padEnd(8)} ${e.message}`).join("\n");
		try {
			await navigator.clipboard.writeText(lines);
			setMessage("Log copied.");
		} catch {
			setMessage("Could not copy. Select the log text and copy it by hand.");
		}
	}

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 760 }}>
			<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
				<h4 style={{ margin: 0 }}>Network</h4>
				<p style={hint}>
					Finds the other PCs running this app on the same network, for example one LAN cable between two PCs, and tests the connection. Nothing is shared between PCs yet.
				</p>
			</div>

			<div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
				<strong>Main PC</strong>
				{!status || !status.mainId ? (
					<span style={{ fontSize: 13 }}>No main PC has been chosen yet.</span>
				) : status.isMain ? (
					<span style={{ fontSize: 13, color: "#1a8d5f", fontWeight: 600 }}>This PC is the main PC.</span>
				) : (
					<span style={{ fontSize: 13 }}>
						<b>{status.mainName}</b>{" "}
						{status.mainOnline ? (
							<span style={{ color: "#1a8d5f" }}>is on the network.</span>
						) : (
							<span style={{ color: "#d1383d" }}>is not on the network right now. Other PCs cannot use it until it is back.</span>
						)}
					</span>
				)}
				{status && status.mainId && <span style={hint}>Choice number {status.epoch}. Every PC shows the same main PC within a few seconds.</span>}
				{status && (
					<span style={{ fontSize: 13, color: status.hasKey ? "#1a8d5f" : "#b7791f" }}>
						{status.hasKey
							? "This PC has the business key, so it can join the main PC."
							: "This PC has no business key yet. Sign in online once on this PC; until then it cannot join the main PC and uses its own data."}
					</span>
				)}
				{dataMode && (
					<span style={{ fontSize: 13, fontWeight: 600 }}>
						Data: {dataMode.shared ? `using the main PC's data (${dataMode.live.mainName || "main PC"})` : "using this PC's own data"}
						{dataMode.needRestart ? " (switching…)" : ""}
					</span>
				)}
				{dataMode && dataMode.live.reason && <span style={hint}>{dataMode.live.reason}</span>}

				{confirm ? (
					<div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: 8 }}>
						<span style={{ fontSize: 13 }}>
							{confirm.kind === "clear"
								? "Remove the main PC? No PC will be the main PC afterwards."
								: confirm.kind === "self"
									? "Make this PC the main PC? The other PCs will be told straight away."
									: `Make ${confirm.name} the main PC? All PCs, including this one, will use it.`}
						</span>
						<div style={{ display: "flex", gap: 8 }}>
							<button type="button" className="btn sm" disabled={!!busy} onClick={() => void applyMain()}>Yes, confirm</button>
							<button type="button" className="btn sm" onClick={() => setConfirm(null)}>Cancel</button>
						</div>
					</div>
				) : (
					<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
						{status && !status.isMain && (
							<button type="button" className="btn sm" disabled={!!busy} onClick={() => setConfirm({ kind: "self", id: status.id, name: status.name })}>
								Make this the main PC
							</button>
						)}
						{status && status.mainId && (
							<button type="button" className="btn sm" disabled={!!busy} onClick={() => setConfirm({ kind: "clear", id: "", name: "" })}>
								Remove main PC
							</button>
						)}
					</div>
				)}
				<p style={hint}>
					Only an admin can change this. Nothing moves to the main PC yet: this step only chooses it and shows it on every PC.
				</p>
			</div>

			<div style={{ ...card, display: "flex", flexDirection: "column", gap: 6 }}>
				<strong>This PC</strong>
				{status ? (
					<>
						<span style={{ fontSize: 13 }}>
							{status.name} · id <code>{status.id}</code> · version {status.version || "dev"}
						</span>
						{status.interfaces && status.interfaces.length > 0 ? (
							status.interfaces.map((i) => (
								<span key={`${i.name}-${i.ip}`} style={{ fontSize: 13, fontFamily: MONO }}>
									{i.name}: {i.ip}
									{i.linkLocal ? " (direct cable address)" : ""}
								</span>
							))
						) : (
							<span style={{ fontSize: 13, color: "#b7791f" }}>
								{status.noAddress && status.noAddress.length > 0
									? `${status.noAddress.join(", ")} is connected but has no address yet. On a direct cable this takes up to a minute.`
									: "No network connection found. Check the cable."}
							</span>
						)}
						<span style={{ fontSize: 12.5, color: "var(--muted)" }}>
							Listening: TCP {status.httpPort} {status.tcpListening ? "✓" : "✗"} · UDP {status.discoveryPort} {status.udpListening ? "✓" : "✗"} · announcements sent {status.beaconsSent}, heard {status.beaconsReceived}
						</span>
						{(status.tcpError || status.udpError) && (
							<span className="sa-error" style={{ fontSize: 12.5 }}>{status.tcpError} {status.udpError}</span>
						)}
					</>
				) : (
					<span style={hint}>Loading…</span>
				)}
				<div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
					<button type="button" className="btn sm" disabled={!!busy} onClick={() => void selfTest()}>
						{busy === "test" ? "Testing…" : "Run self-test"}
					</button>
					<button type="button" className="btn sm" disabled={!!busy} onClick={() => void allow()}>
						{busy === "allow" ? "Waiting for Windows…" : "Allow network access"}
					</button>
				</div>
				<p style={hint}>Allow network access adds a Windows Firewall rule so other PCs can reach this one. Windows asks for permission once.</p>
			</div>

			{message && <p className="sa-hint" style={{ margin: 0 }}>{message}</p>}

			{steps && (
				<div style={{ ...card, display: "flex", flexDirection: "column", gap: 8 }}>
					<strong>Self-test</strong>
					{steps.map((s) => (
						<div key={s.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
							<span style={{ flex: "0 0 44px", fontWeight: 700, fontSize: 12, color: STEP_COLOR[s.status], paddingTop: 2 }}>{STEP_LABEL[s.status]}</span>
							<div style={{ fontSize: 13, lineHeight: 1.5 }}>
								<div><b>{s.title}</b>{s.detail ? ` — ${s.detail}` : ""}</div>
								{s.fix && s.status !== "pass" && <div style={{ color: "var(--muted)" }}>Fix: {s.fix}</div>}
							</div>
						</div>
					))}
				</div>
			)}

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<strong>Other PCs ({peers.length})</strong>
				{peers.length === 0 ? (
					<p style={hint}>No other PC found yet. Plug in the cable, open the app on the other PC, and wait up to a minute. If nothing appears, run the self-test.</p>
				) : (
					<div style={{ overflowX: "auto" }}>
						<table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
							<thead>
								<tr style={{ textAlign: "left", color: "var(--muted)" }}>
									<th style={{ padding: "4px 8px 4px 0" }}>Name</th>
									<th style={{ padding: "4px 8px" }}>Address</th>
									<th style={{ padding: "4px 8px" }}>Version</th>
									<th style={{ padding: "4px 8px" }}>Connection</th>
									<th style={{ padding: "4px 8px" }}>Role</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{peers.map((p) => (
									<tr key={p.id} style={{ borderTop: "1px solid var(--line)" }}>
										<td style={{ padding: "6px 8px 6px 0" }}>{p.name}{p.source === "manual" ? " (added by IP)" : ""}{!p.verified && <span style={{ color: "#b7791f" }} title="Not signed with this business's key: an older version, another business, or a PC that has not signed in online yet"> · unverified</span>}</td>
										<td style={{ padding: "6px 8px", fontFamily: MONO }}>{p.ip}</td>
										<td style={{ padding: "6px 8px" }}>{p.version || "-"}</td>
										<td style={{ padding: "6px 8px" }} title={p.detail}>
											{p.reachable === "yes" ? <span style={{ color: "#1a8d5f" }}>reachable · {p.latencyMs} ms</span> : p.reachable === "no" ? <span style={{ color: "#d1383d" }}>not reachable</span> : <span style={{ color: "var(--muted)" }}>checking…</span>}
										</td>
										<td style={{ padding: "6px 8px" }}>
											{p.isMain ? <span style={{ color: "#1a8d5f", fontWeight: 700 }}>Main PC</span> : <span style={{ color: "var(--muted)" }}>-</span>}
										</td>
										<td style={{ padding: "6px 0", textAlign: "right" }}>
											<div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
												{!p.isMain && (
													<button type="button" className="btn sm" disabled={!!busy} onClick={() => setConfirm({ kind: "peer", id: p.id, name: p.name })}>
														Make main
													</button>
												)}
												<button type="button" className="btn sm" disabled={!!busy} onClick={() => void testPeer(p)}>
													{busy === `peer-${p.id}` ? "Testing…" : "Test connection"}
												</button>
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
					<input
						value={ip}
						onChange={(e) => setIp(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void addByIp()}
						placeholder="Add by IP, e.g. 192.168.1.20"
						aria-label="IP address of another PC"
						style={{ flex: "1 1 200px", minWidth: 0, padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6, background: "transparent", color: "inherit" }}
					/>
					<button type="button" className="btn sm" disabled={!!busy || !ip.trim()} onClick={() => void addByIp()}>
						{busy === "add" ? "Adding…" : "Add by IP"}
					</button>
				</div>
				{probe && (
					<p className={probe.status === "reachable" ? "sa-hint" : "sa-error"} style={{ margin: 0 }}>
						{probe.status === "reachable"
							? `${probe.peerName || probe.ip} is reachable (${probe.latencyMs} ms${probe.via ? `, through ${probe.via}` : ""}).`
							: `${probe.ip}:${probe.port} — ${probe.message}`}
					</p>
				)}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
					<strong>Log</strong>
					<div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
						<input
							value={text}
							onChange={(e) => setText(e.target.value)}
							placeholder="Filter…"
							aria-label="Filter the log"
							style={{ width: 130, padding: "4px 8px", border: "1px solid var(--line)", borderRadius: 6, background: "transparent", color: "inherit" }}
						/>
						<select value={level} onChange={(e) => setLevel(e.target.value as "all" | "warn")} aria-label="Log level" style={{ padding: "4px 6px", borderRadius: 6 }}>
							<option value="all">All lines</option>
							<option value="warn">Warnings and errors</option>
						</select>
						<button type="button" className="btn sm" onClick={() => void copyAll()}>Copy all</button>
						<button type="button" className="btn sm" onClick={() => { setLog([]); void lan.clearLog(); }}>Clear</button>
					</div>
				</div>
				<div
					ref={logRef}
					onScroll={(e) => {
						const el = e.currentTarget;
						stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
					}}
					role="log"
					aria-live="polite"
					style={{ height: 260, overflow: "auto", background: "#0d1117", borderRadius: 8, padding: "8px 10px", fontFamily: MONO, fontSize: 12, lineHeight: 1.55 }}
				>
					{shown.length === 0 ? (
						<span style={{ color: "#8b949e" }}>No lines yet.</span>
					) : (
						shown.map((e, i) => (
							<div key={i} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: "#c9d1d9" }}>
								<span style={{ color: "#8b949e" }}>{e.time} </span>
								<span style={{ color: LEVEL_COLOR[e.level] ?? "#c9d1d9", fontWeight: 700 }}>{e.component.padEnd(8)}</span>{" "}
								<span style={{ color: e.level === "error" ? "#ff7b72" : e.level === "warn" ? "#e3b341" : e.level === "ok" ? "#56d364" : "#c9d1d9" }}>{e.message}</span>
							</div>
						))
					)}
				</div>
				{status?.logPath && <p style={hint}>Also saved to <code style={{ wordBreak: "break-all" }}>{status.logPath}</code></p>}
			</div>
		</div>
	);
}
