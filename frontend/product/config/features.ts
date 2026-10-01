/* UI feature switches and the billing plan ladder, read from the env file.
 *
 * Both features are UI-only for now: the plan upgrade flow is simulated
 * (no backend call) and the sidebar update notice only animates. Values are
 * NEXT_PUBLIC_*, so `output: "export"` bakes them in at build time — a
 * change needs a rebuild (or a `next dev` restart). Each var must be read
 * with its literal name for Next to inline it, hence no dynamic lookup. */

export type BillingPlan = {
  id: string;
  name: string;
  /* 0 = unlimited, matching tenant.Tier.BranchQuota. */
  branches: number;
  /* One-time price in rupees — plans are not billed monthly. */
  price: number;
  features: string[];
};

/* Same three tiers the backend seeds (backend/internal/tenant/seed.go), in
 * tier order. Used whenever NEXT_PUBLIC_BILLING_PLANS is unset or invalid. */
export const DEFAULT_PLANS: BillingPlan[] = [
  { id: "single", name: "Single Branch", branches: 1, price: 25000, features: ["1 branch", "Unlimited staff and customers", "Gold loans, packets and lockers"] },
  { id: "five", name: "Up to 5 Branches", branches: 5, price: 75000, features: ["Up to 5 branches", "Branch-wise reports", "Inter-branch cash transfers"] },
  { id: "unlimited", name: "Unlimited", branches: 0, price: 150000, features: ["No branch limit", "Everything in 5 Branches", "Priority support"] },
];

function flag(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

export function parsePlans(raw: string | undefined): BillingPlan[] {
  if (!raw) return DEFAULT_PLANS;
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) return DEFAULT_PLANS;
    const plans: BillingPlan[] = [];
    for (const [i, p] of list.entries()) {
      if (!p || typeof p.name !== "string" || !p.name.trim()) return DEFAULT_PLANS;
      if (!Number.isFinite(p.branches) || p.branches < 0) return DEFAULT_PLANS;
      if (!Number.isFinite(p.price) || p.price < 0) return DEFAULT_PLANS;
      plans.push({
        id: typeof p.id === "string" && p.id ? p.id : `plan${i}`,
        name: p.name.trim(),
        branches: Math.floor(p.branches),
        price: p.price,
        features: Array.isArray(p.features) ? p.features.map(String) : [],
      });
    }
    return plans;
  } catch {
    return DEFAULT_PLANS;
  }
}

export const FEATURES = {
  planUpgrade: flag(process.env.NEXT_PUBLIC_ENABLE_PLAN_UPGRADE),
  updateNotice: flag(process.env.NEXT_PUBLIC_ENABLE_UPDATE_NOTICE),
  updateNotes: process.env.NEXT_PUBLIC_UPDATE_NOTES || "A new version of the app is ready.",
  /* Changing the notes text counts as a new update, so a "Later" or a
   * finished update from a previous release doesn't hide this one. */
  updateId: process.env.NEXT_PUBLIC_UPDATE_NOTES || "default",
};

export const BILLING_PLANS: BillingPlan[] = parsePlans(process.env.NEXT_PUBLIC_BILLING_PLANS);

/* The env plan matching the backend tier the business is on — by name,
 * case-insensitively. Falls back to a branch-quota match (so a renamed tier
 * still lines up), then to the first plan. */
export function findPlanIndex(tierName: string, quota?: number): number {
  const byName = BILLING_PLANS.findIndex((p) => p.name.toLowerCase() === tierName.trim().toLowerCase());
  if (byName >= 0) return byName;
  if (quota !== undefined) {
    const byQuota = BILLING_PLANS.findIndex((p) => p.branches === quota);
    if (byQuota >= 0) return byQuota;
  }
  return 0;
}

export function formatRupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function branchLabel(n: number): string {
  if (n === 0) return "Unlimited branches";
  return n === 1 ? "1 branch" : `${n} branches`;
}
