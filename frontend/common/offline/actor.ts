import { readEmployeeRaw } from "@/common/services/tenantSession";
import type { Actor } from "./types";

/* Who is signed in, as written on each outbox entry. */
export function currentActor(): Actor {
  try {
    const e = JSON.parse(readEmployeeRaw() ?? "{}") as { id?: number; name?: string; role?: string };
    return { id: e.id ?? 0, name: e.name ?? "", role: e.role ?? "" };
  } catch {
    return { id: 0, name: "", role: "" };
  }
}
