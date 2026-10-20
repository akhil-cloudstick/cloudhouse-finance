/* Registers this PC with the server on its first online sign-in. Needs the network and a signed-in employee,
 * so the sender calls it before sending and simply stops when it cannot; the entries stay queued. */

import { apiFetchEnveloped } from "@/common/services/httpClient";
import { offlineStore } from "@/common/services/desktopBridge";
import { currentDevice, isRegistered, loadDevice, saveRegistration } from "./device";
import { employeeId } from "./session";

type Registration = { deviceId?: number; device_id?: number; key: string };

let inFlight: Promise<boolean> | null = null;

export function ensureRegistered(): Promise<boolean> {
  if (isRegistered()) return Promise.resolve(true);
  inFlight ??= register().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function register(): Promise<boolean> {
  const id = employeeId();
  if (!id) return false;
  const d = currentDevice() ?? (await loadDevice());
  try {
    const res = await apiFetchEnveloped<Registration>(`/users/${id}/devices`, {
      method: "POST",
      body: JSON.stringify({ machine_id: d.machineId, name: `PC ${d.machineId.slice(-4).toUpperCase()}` }),
    });
    const deviceId = res.deviceId ?? res.device_id;
    if (!deviceId || !res.key) return false;
    await saveRegistration(String(deviceId), res.key);
    offlineStore.log("info", `this PC is registered as device ${deviceId}`);
    return true;
  } catch (e) {
    // no answer is normal offline; anything else is worth a line in the log
    const status = (e as { status?: number }).status;
    if (status !== 0) offlineStore.log("warn", `device registration failed: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
