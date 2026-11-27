import type { ReactNode } from "react";

/* The operating systems a desktop app is built for, named and drawn the same way
 * in every console (build cards, the Desktop app card, the Build for toggles). */

export type DesktopOs = "win" | "mac" | "linux" | "content";

export const OS_ORDER: DesktopOs[] = ["win", "mac", "linux"];

export const OS_NAME: Record<DesktopOs, string> = {
  win: "Windows",
  mac: "macOS",
  linux: "Linux",
  content: "Content package",
};

/** Reads the many ways products name an OS (win, windows, "Windows installer", mac, macos, darwin, …). */
export function toDesktopOs(raw: string): DesktopOs {
  const s = raw.trim().toLowerCase();
  if (s === "content") return "content";
  if (s.startsWith("win") || s.includes("windows")) return "win";
  if (s.startsWith("mac") || s.includes("macos") || s.includes(" mac") || s.includes("darwin") || s === "osx") return "mac";
  return "linux";
}

export const OS_ICON: Record<DesktopOs, ReactNode> = {
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
  content: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 4h16v4H4zm0 6h16v10H4zm3 3v4h10v-4z" />
    </svg>
  ),
};

// ── Versions (1.2.3) ──────────────────────────────────────────────────────────

/** 1.2.3 (a leading "v" is allowed) as numbers, or null when it is not a version. */
export function parseVersion(v: string | null | undefined): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/i.exec(String(v ?? "").trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Above 0 when a is higher than b. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [0, 0, 0];
  const pb = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** The recommended next version: the live one with its last number raised (1.0.2 → 1.0.3); 1.0.0 when none. */
export function nextVersion(current: string | null | undefined): string {
  const p = parseVersion(current);
  return p ? `${p[0]}.${p[1]}.${p[2] + 1}` : "1.0.0";
}

/** Why a typed version cannot be built (not like 1.2.3, or not higher than the live one), or null. */
export function versionProblem(value: string, current: string | null | undefined): string | null {
  if (!parseVersion(value)) return "Enter the version like 1.2.3.";
  if (current && parseVersion(current) && compareVersions(value, current) <= 0) return `Must be higher than ${current}.`;
  return null;
}
