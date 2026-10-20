/* Fetches the lists the app shows on almost every screen, right after sign-in and then now and then, so each
 * one is on this PC before the server stops answering. Without this a screen only works offline if it was
 * opened online first. */

import { quietly, warmGet, warmJson } from "@/common/services/httpClient";
import { employeeId } from "./session";

const PATHS = [
  "/schemes",
  "/schemes/active",
  "/gold-rates",
  "/gold-rates/latest",
  "/reminders",
  "/banks",
  "/branches",
  "/branches/switchable",
  "/approval-workflow",
  "/business-profile",
  "/ornament-types",
  "/purity-standards",
  "/roles",
  "/auth/me",
  "/banks",
  "/cash-sources",
  "/expense-categories",
  "/lockers",
  "/cash/summary",
  "/loans/requests",
  "/categories?type=self_transfer&limit=100",
  "/categories?type=cash_in&limit=100",
  "/categories?type=expense&limit=100",
];

/* A packet's details page reads the packet and its movements, so those are kept for each packet as well. */
async function warmPackets(): Promise<void> {
  const list = (await warmJson("/packets")) as { data?: { id: number }[] } | null;
  const ids = Array.isArray(list?.data) ? list!.data!.slice(0, 80).map((p) => p.id) : [];
  for (const id of ids) {
    await warmGet(`/packets/${id}`);
    await warmGet(`/packets/${id}/movements`);
  }
}

/* The Roles & Permissions page reads one matrix per role, so each role's is kept. They are only viewable offline:
 * changing a permission needs the server, so access can never be changed in a way nobody can review. */
async function warmRoleMatrices(): Promise<void> {
  const emp = employeeId();
  const roles = (await warmJson("/roles")) as { data?: { id: number }[] } | null;
  if (!emp || !Array.isArray(roles?.data)) return;
  for (const r of roles!.data!.slice(0, 40)) await warmGet(`/employees/${emp}/permissions?role_id=${r.id}`);
}

let running = false;

export async function warmReadCache(): Promise<void> {
  if (running || !employeeId()) return;
  running = true;
  try {
    await quietly(async () => {
      for (const p of PATHS) await warmGet(p);
      await warmPackets();
    await warmRoleMatrices();
    });
  } finally {
    running = false;
  }
}
