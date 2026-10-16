"use client";

import { type Tier } from "@/modules/superadmin/types/superadmin-types";

/* A plan's branch allowance in words. branchQuota 0 is the backend's
 * "unlimited" (tenant.UnlimitedBranches) — never render it as "0 branches". */
export function quotaText(quota: number): string {
  if (quota === 0) return "Unlimited branches";
  return `${quota} branch${quota === 1 ? "" : "es"}`;
}
export function planLabel(t: Tier): string {
  return `${t.name} (${quotaText(t.branchQuota)})`;
}
/* Plans in the order they grow: single branch, then capped multi-branch
 * plans by size, then unlimited (branchQuota 0) last. */
export function sortedTiers(tiers: Tier[]): Tier[] {
  const rank = (q: number) => (q === 0 ? Number.MAX_SAFE_INTEGER : q);
  return [...tiers].sort((a, b) => rank(a.branchQuota) - rank(b.branchQuota));
}
/* Plans a business may move to: every plan, up or down. A plan never removes
 * branches — on a single-branch plan the business is pinned to its Head
 * Office and its other branches are only hidden (see
 * superadmin.Service.ChangeTier / platform.PinSingleBranch). */
export function plansFor(tiers: Tier[]): Tier[] {
  return sortedTiers(tiers);
}
/* The note under the plan picker when the chosen plan allows fewer branches
 * than the business already runs — nothing is removed, but staff should know
 * what they will (not) see. */
export function downgradeNote(tier: Tier | undefined, activeBranches: number | undefined): string | null {
  if (!tier || activeBranches === undefined || tier.branchQuota === 0 || activeBranches <= tier.branchQuota) return null;
  if (tier.branchQuota === 1) {
    return `This business has ${activeBranches} active branches. On this plan only Head Office is shown; the other branches and their data are kept and come back on a larger plan.`;
  }
  return `This business has ${activeBranches} active branches, more than this plan allows (${tier.branchQuota}). Nothing is removed, but no branch can be added or reactivated until it is within the limit.`;
}
export function formatINR(rupees: number): string {
  return `₹${rupees.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
// DD-MM-YYYY ("05-10-2026"), matching the tenant app's date style.
export function formatDate(iso?: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}
/* Human labels for the closed sets. The KEYS come from the backend
 * (/superadmin/catalogue → tenant.KnownModules/KnownLanguages) so the
 * console can never offer something the server would reject; only the
 * wording lives here. An unknown key falls back to the key itself rather
 * than rendering blank, so a backend that adds a module before this map
 * does still shows something usable. */
/* Keys must match tenant.KnownModules in backend/internal/tenant/branding.go
 * exactly — that slice is the closed set, and a key here with no counterpart
 * there is silently dropped on save. */
export const MODULE_LABELS: Record<string, string> = {
  settings: "Settings",
  branches: "Branch Management",
  demo_reset: "Demo Reset",
  whatsapp: "WhatsApp",
  multiple_interest: "Multiple Interest Schemes",
};
export const LANGUAGE_LABELS: Record<string, string> = {
  en: "English",
  ml: "Malayalam",
  gu: "Gujarati",
  ta: "Tamil",
};
