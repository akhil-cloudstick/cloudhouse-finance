"use client";

import { useEffect, useRef, useState } from "react";
import {
	triggerDesktopRelease,
	listDesktopReleaseJobs,
	cancelDesktopReleaseJob,
	getCurrentDesktopVersion,
	SuperAdminApiError,
} from "@/modules/superadmin/services/superadminService";
import type { DesktopReleaseJob } from "@/modules/superadmin/types/superadmin-types";
import { ReasonField } from "@/modules/superadmin/components/ReasonField";

// Keep in step with package-win.cjs/package-mac.cjs/package-linux.cjs and release.yml's job matrix.
const SUPPORTED_TARGETS = [
	{ value: "win", label: "Windows" },
	{ value: "mac", label: "macOS" },
	{ value: "linux", label: "Linux" },
];

const OS_NAME: Record<string, string> = { win: "Windows", mac: "macOS", linux: "Linux" };

// The six statuses the backend reports, in order; "done" is the last step.
const STEPS = ["Queued", "Preparing", "Building", "Uploading", "Verifying", "Done"] as const;
const STEP_OF: Partial<Record<DesktopReleaseJob["status"], number>> = {
	queued: 0,
	preparing: 1,
	building: 2,
	uploading: 3,
	verifying: 4,
	done: 5,
};
// Where each step sits on the bar (%): queued 0-5, preparing 5-15, building 15-75, uploading 75-90, verifying 90-100.
const EDGE = [0, 5, 15, 75, 90, 100];
// Typical GitHub run length per OS, only to estimate progress inside a step and the time left.
const TYPICAL_SECONDS: Record<string, number> = { win: 180, mac: 300, linux: 240 };
const CONTENT_SECONDS = 120;

const CHECK = (
	<svg viewBox="0 0 10 10" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M2 5.2 4.1 7.2 8 3" />
	</svg>
);
const CROSS = (
	<svg viewBox="0 0 10 10" fill="none" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
		<path d="M3 3l4 4M7 3 3 7" />
	</svg>
);
const OS_ICON: Record<string, React.ReactNode> = {
	win: (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M3 5.5 10.5 4.4v7.1H3zm8.5-1.2L21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zm8.5 0H21V21l-9.5-1.3z" />
		</svg>
	),
	mac: (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M16.4 12.6c0-2.5 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.8-1.7 0-3.2 1-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3 2.4 1.2 0 1.7-.8 3.1-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.1-1.2 2.9-2.4.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.9zM14 5.2c.7-.8 1.1-1.9 1-3-1 0-2.1.7-2.8 1.5-.6.7-1.2 1.8-1 2.9 1.1.1 2.1-.6 2.8-1.4z" />
		</svg>
	),
	linux: (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 2c-2.2 0-3.6 1.9-3.6 4.6 0 1.4.3 2.3-.6 3.6-1.3 1.8-3.2 4.3-3.2 6.8 0 .9.3 1.6.8 2-.3.6-.2 1.4.6 1.8 1.2.7 2.4.2 3.4.9.7.5 1.6.3 2-.4h1.2c.4.7 1.3.9 2 .4 1-.7 2.2-.2 3.4-.9.8-.4.9-1.2.6-1.8.5-.4.8-1.1.8-2 0-2.5-1.9-5-3.2-6.8-.9-1.3-.6-2.2-.6-3.6C15.6 3.9 14.2 2 12 2z" />
		</svg>
	),
};

function isTerminal(status: DesktopReleaseJob["status"]) {
	return status === "done" || status === "failed" || status === "cancelled";
}

function isHigherVersion(a: string, b: string): boolean {
	const parts = (v: string) => v.trim().replace(/^v/i, "").split(".").map((n) => parseInt(n, 10) || 0);
	const [a1, a2, a3] = parts(a);
	const [b1, b2, b3] = parts(b);
	if (a1 !== b1) return a1 > b1;
	if (a2 !== b2) return a2 > b2;
	return a3 > b3;
}

function formatDuration(totalSeconds: number) {
	const s = Math.max(0, Math.floor(totalSeconds));
	const m = Math.floor(s / 60);
	return m ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}

function formatClock(iso: string) {
	const d = new Date(iso);
	return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function secondsBetween(fromIso: string, to: number) {
	const from = new Date(fromIso).getTime();
	return Number.isNaN(from) ? 0 : (to - from) / 1000;
}

type DesktopReleaseModalProps = {
	/* Present = single tenant; absent = every tenant ("content update" only offered then). */
	tenant?: { code: string; name: string };
	onClose: () => void;
	onDone?: () => void;
};

export function DesktopReleaseModal({ tenant, onClose, onDone }: DesktopReleaseModalProps) {
	const [version, setVersion] = useState("");
	const [buildType, setBuildType] = useState<"full" | "content">("full");
	const [targets, setTargets] = useState<string[]>(["win"]);
	const [reason, setReason] = useState("");
	const [versionError, setVersionError] = useState<string | null>(null);
	const [submitting, setSubmitting] = useState(false);
	const [started, setStarted] = useState(false);
	const [jobs, setJobs] = useState<DesktopReleaseJob[]>([]);
	const [retryError, setRetryError] = useState<string | null>(null);
	const [now, setNow] = useState(() => Date.now());
	// Only well-defined for a single tenant — "all tenants" can each be on a different version.
	const [currentVersion, setCurrentVersion] = useState<string | null>(null);
	const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
	const idsRef = useRef<number[]>([]);
	// The last running step seen per job, so a failed card can mark the step it stopped at.
	const [lastStep, setLastStep] = useState<Record<number, number>>({});

	// "Content update" is shared by every tenant, so it's only offered when no single tenant is scoped.
	const canOfferContent = !tenant;
	const running = jobs.some((j) => !isTerminal(j.status));

	useEffect(() => {
		return () => {
			if (pollRef.current) clearInterval(pollRef.current);
		};
	}, []);

	useEffect(() => {
		if (!tenant) return;
		let live = true;
		getCurrentDesktopVersion(tenant.code, "full").then(
			(res) => { if (live) setCurrentVersion(res.version); },
			() => {},
		);
		return () => {
			live = false;
		};
	}, [tenant]);

	// A one-second clock while anything runs, for the elapsed and time-left figures.
	useEffect(() => {
		if (!running) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [running]);

	function toggleTarget(value: string) {
		setTargets((cur) => (cur.includes(value) ? cur.filter((t) => t !== value) : [...cur, value]));
	}

	const canSubmit = version.trim() !== "" && (buildType !== "full" || targets.length > 0);

	function remember(list: DesktopReleaseJob[]) {
		setLastStep((prev) => {
			const next = { ...prev };
			for (const j of list) {
				const step = STEP_OF[j.status];
				if (step !== undefined) next[j.id] = step;
			}
			return next;
		});
	}

	function startPolling() {
		if (pollRef.current) clearInterval(pollRef.current);
		pollRef.current = setInterval(async () => {
			try {
				const refreshed = await listDesktopReleaseJobs(idsRef.current);
				remember(refreshed);
				setJobs(refreshed);
				setNow(Date.now());
				if (refreshed.every((j) => isTerminal(j.status))) {
					if (pollRef.current) clearInterval(pollRef.current);
					onDone?.();
				}
			} catch {
				/* a transient poll failure isn't worth surfacing; the next tick retries */
			}
		}, 4000);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setVersionError(null);
		setSubmitting(true);
		try {
			const res = await triggerDesktopRelease({
				tenantCode: tenant ? tenant.code : "all",
				version: version.trim(),
				buildType,
				targets,
				reason,
			});
			setStarted(true);
			remember(res.jobs);
			setJobs(res.jobs);
			setNow(Date.now());
			idsRef.current = res.jobs.map((j) => j.id);
			startPolling();
		} catch (err) {
			setVersionError(err instanceof SuperAdminApiError ? err.message : "Could not start the build.");
		} finally {
			setSubmitting(false);
		}
	}

	async function cancelJob(id: number) {
		setJobs((cur) => cur.map((j) => (j.id === id ? { ...j, status: "cancelled" } : j)));
		try {
			await cancelDesktopReleaseJob(id);
		} catch {
			/* the next poll tick will reconcile the real state either way */
		}
	}

	async function retryJob(job: DesktopReleaseJob) {
		setRetryError(null);
		try {
			const res = await triggerDesktopRelease({
				tenantCode: job.buildType === "content" ? "all" : job.tenantCode,
				version: job.version,
				buildType: job.buildType,
				targets: [job.os],
				reason: `Retry of failed ${OS_NAME[job.os] ?? job.os} build`,
			});
			remember(res.jobs);
			setJobs((cur) => cur.flatMap((j) => (j.id === job.id ? res.jobs : [j])));
			idsRef.current = idsRef.current.flatMap((id) => (id === job.id ? res.jobs.map((n) => n.id) : [id]));
			setNow(Date.now());
			startPolling();
		} catch (err) {
			setRetryError(err instanceof SuperAdminApiError ? err.message : "Could not start the retry.");
		}
	}

	const title = tenant ? `Rebuild — ${tenant.name}` : "Rebuild — all tenants";
	const firstJob = jobs[0];

	// Progress of one job on the 0-100 bar, kept inside its current step's band.
	function progressOf(job: DesktopReleaseJob, elapsed: number) {
		if (job.status === "done") return 100;
		const step = isTerminal(job.status) ? lastStep[job.id] ?? 0 : STEP_OF[job.status] ?? 0;
		const typical = job.buildType === "content" ? CONTENT_SECONDS : TYPICAL_SECONDS[job.os] ?? 240;
		const estimate = (elapsed / typical) * 100;
		return Math.min(Math.max(estimate, EDGE[step]), EDGE[step + 1] - 1);
	}

	const finished = jobs.filter((j) => isTerminal(j.status)).length;
	const failedCount = jobs.filter((j) => j.status === "failed").length;
	const readyCount = jobs.filter((j) => j.status === "done").length;
	const overall = jobs.length
		? jobs.reduce((sum, j) => sum + progressOf(j, secondsBetween(j.createdAt, isTerminal(j.status) ? new Date(j.updatedAt).getTime() : now)), 0) / jobs.length
		: 0;
	const appWord = jobs.length === 1 ? "app" : "apps";
	const summary =
		finished < jobs.length
			? `Building ${jobs.length} ${appWord}…`
			: failedCount || readyCount < jobs.length
				? `${readyCount} of ${jobs.length} ready${failedCount ? `, ${failedCount} failed` : ""}`
				: `All ${jobs.length} ${appWord} ready`;

	return (
		<div className="sa-modal-backdrop" onClick={onClose}>
			<form className="sa-modal wide" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
				<div className="sa-modal-head">
					<h2>{title}</h2>
					{started && firstJob && (
						<p className="sa-rb-sub">
							Version {firstJob.version} · started {formatClock(firstJob.createdAt)} · you can close this window, the build keeps going
						</p>
					)}
				</div>

				<div className="sa-modal-body">
					{!started ? (
						<>
							<div className={versionError ? "sa-field has-err" : "sa-field"}>
								<label>
									New version
									{tenant && <span className="sa-hint"> — current: {currentVersion ?? "none yet"}</span>}
								</label>
								<input
									type="text"
									value={version}
									onChange={(e) => { setVersion(e.target.value); setVersionError(null); }}
									placeholder={currentVersion ?? "1.4.0"}
									autoFocus
									required
								/>
								{versionError ? (
									<span className="sa-error" role="alert">{versionError}</span>
								) : version.trim() && currentVersion && !isHigherVersion(version, currentVersion) ? (
									<span className="sa-error" role="alert">Must be higher than {currentVersion}.</span>
								) : (
									<span className="sa-hint">Must be higher than the current live version.</span>
								)}
							</div>

							<div className="sa-field">
								<label>Update type</label>
								<div className="sa-seg" role="group" aria-label="Update type">
									<button type="button" aria-pressed={buildType === "full"} onClick={() => setBuildType("full")}>
										Full rebuild
									</button>
									{canOfferContent && (
										<button
											type="button"
											aria-pressed={buildType === "content"}
											onClick={() => setBuildType("content")}
										>
											Content update
										</button>
									)}
								</div>
								<span className="sa-hint">
									{buildType === "full"
										? "Native code changed — produces a real installer, per OS checked below."
										: "Fast, shared package — every tenant's app updates in place, no reinstall."}
								</span>
							</div>

							{buildType === "full" && (
								<div className="sa-field">
									<label>Build for</label>
									<div className="sa-toggle-group" role="group" aria-label="Build for">
										{SUPPORTED_TARGETS.map((t) => (
											<button
												key={t.value}
												type="button"
												aria-pressed={targets.includes(t.value)}
												onClick={() => toggleTarget(t.value)}
											>
												{t.label}
											</button>
										))}
									</div>
									<span className="sa-hint">
										{targets.length === 0 ? "Pick at least one — required to start." : ""}
									</span>
								</div>
							)}

							<ReasonField value={reason} onChange={setReason} required={false} />
						</>
					) : (
						<div className="sa-rb">
							<div className="sa-rb-summary">
								<div className="sa-rb-summary-top">
									<strong>{summary}</strong>
									<span>{finished} of {jobs.length} finished</span>
								</div>
								<div className="sa-rb-bar"><i style={{ width: `${overall}%` }} /></div>
							</div>

							{retryError && <span className="sa-error" role="alert">{retryError}</span>}

							{jobs.map((job) => {
								const end = isTerminal(job.status) ? new Date(job.updatedAt).getTime() : now;
								const elapsed = secondsBetween(job.createdAt, end);
								const pct = Math.round(progressOf(job, elapsed));
								const step = job.status === "done" ? 5 : isTerminal(job.status) ? lastStep[job.id] ?? 0 : STEP_OF[job.status] ?? 0;
								const kind = isTerminal(job.status) ? job.status : "run";
								const osName = job.buildType === "content" ? "Content package" : OS_NAME[job.os] ?? job.os;
								const typical = job.buildType === "content" ? CONTENT_SECONDS : TYPICAL_SECONDS[job.os] ?? 240;
								const stateLabel =
									kind === "run" ? `${STEPS[step]}…`
									: kind === "done" ? "Ready"
									: kind === "failed" ? `Failed at ${STEPS[step].toLowerCase()}`
									: "Cancelled";
								const timeLine =
									kind === "run" ? `About ${formatDuration(Math.max(0, typical - elapsed))} left`
									: kind === "done" ? `Finished in ${formatDuration(elapsed)}`
									: `Stopped after ${formatDuration(elapsed)}`;
								const downloadLabel = job.os === "win" ? "Download setup .exe" : job.os === "mac" ? "Download .zip" : "Download";
								return (
									<div key={job.id} className={`sa-rb-job ${kind}`}>
										<div className="sa-rb-job-top">
											<div className="sa-rb-os">{OS_ICON[job.os] ?? OS_ICON.linux}</div>
											<div className="sa-rb-who">
												<b>{osName}</b>
												<span><span className="sa-rb-code">{job.tenantCode}</span> · {formatDuration(elapsed)}</span>
											</div>
											<span className={`sa-rb-state ${kind}`}>{stateLabel}</span>
										</div>

										<div className="sa-rb-track">
											<div className="sa-rb-pct"><span>{timeLine}</span><span>{pct}%</span></div>
											<div className="sa-rb-bar"><i style={{ width: `${pct}%` }} /></div>
										</div>

										<ol className="sa-rb-steps" aria-label="Build steps">
											{STEPS.map((s, i) => {
												const cls = kind === "done" || i < step ? "past" : i === step ? "now" : "";
												const mark = kind === "failed" && i === step ? CROSS : cls === "past" ? CHECK : null;
												return (
													<li key={s} className={cls}>
														<div className="sa-rb-dot">{mark}</div>
														<span>{s}</span>
													</li>
												);
											})}
										</ol>

										{kind === "failed" && (
											<div className="sa-rb-msg bad">
												The {osName} build stopped while {STEPS[step].toLowerCase()}. Open the log to see the full error.
											</div>
										)}
										{kind === "done" && job.buildType === "full" && (
											<div className="sa-rb-msg ok">
												Uploaded. Installed apps{currentVersion && currentVersion !== job.version ? ` on version ${currentVersion}` : ""} will offer this update next time they open.
											</div>
										)}

										{(kind === "run" || kind === "failed" || kind === "done") && (
											<div className="sa-rb-actions">
												{kind === "run" && (
													<button type="button" className="sa-btn danger" onClick={() => cancelJob(job.id)}>
														Cancel
													</button>
												)}
												{kind !== "run" && job.runUrl && (
													<a className="sa-btn" href={job.runUrl} target="_blank" rel="noopener noreferrer">
														View log
													</a>
												)}
												{kind === "failed" && (
													<button type="button" className="sa-btn" onClick={() => retryJob(job)}>
														Retry {osName}
													</button>
												)}
												{kind === "done" && job.downloadUrl && (
													<a className="sa-btn primary" href={job.downloadUrl} target="_blank" rel="noopener noreferrer">
														{downloadLabel}
													</a>
												)}
											</div>
										)}
									</div>
								);
							})}
						</div>
					)}
				</div>

				<div className="sa-modal-foot">
					<span className="sa-foot-spacer" />
					{!started ? (
						<>
							<button type="button" className="sa-btn" onClick={onClose} disabled={submitting}>
								Cancel
							</button>
							<button type="submit" className="sa-btn primary" disabled={submitting || !canSubmit}>
								{submitting ? "Starting…" : "Confirm & start"}
							</button>
						</>
					) : (
						<button type="button" className="sa-btn" onClick={onClose}>
							Close
						</button>
					)}
				</div>
			</form>
		</div>
	);
}
