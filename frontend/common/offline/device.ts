/* This PC's identity. device.json (kept protected by the Go side) holds a machine id made once on this PC,
 * and, after the first online sign-in registers the PC with the server, the device id and signing key the
 * server issued. Every entry replayed from the outbox is signed with that key, so the server can tell a
 * registered PC from anything else and an admin can switch one off. */

import { offlineStore } from "@/common/services/desktopBridge";
import { uuid7 } from "./ids";

const FILE = "device.json";

export type Device = { machineId: string; deviceId?: string; key?: string };

let device: Device | null = null;

export async function loadDevice(): Promise<Device> {
	if (device) return device;
	try {
		const text = await offlineStore.readFile(FILE);
		const d = text ? (JSON.parse(text) as Partial<Device>) : {};
		if (d.machineId) {
			device = { machineId: d.machineId, deviceId: d.deviceId, key: d.key };
			return device;
		}
	} catch {
		/* unreadable: make a new identity below */
	}
	device = { machineId: `pc_${uuid7().replace(/-/g, "")}` };
	await offlineStore.writeFile(FILE, JSON.stringify(device));
	return device;
}

export function currentDevice(): Device | null {
	return device;
}

export async function saveRegistration(deviceId: string, key: string): Promise<void> {
	const d = await loadDevice();
	device = { ...d, deviceId, key };
	await offlineStore.writeFile(FILE, JSON.stringify(device));
}

export function isRegistered(): boolean {
	return !!(device?.deviceId && device.key);
}

export function forgetDevice(): void {
	device = null;
}

/* The server no longer knows this PC: drop the issued id and key so the next send registers again. */
export async function forgetRegistration(): Promise<void> {
	if (!device) return;
	device = { machineId: device.machineId };
	await offlineStore.writeFile(FILE, JSON.stringify(device));
}

function toHex(buf: ArrayBuffer): string {
	return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/* X-Device-Id and X-Device-Signature (HMAC-SHA256 of the body bytes) for a request sent from the outbox.
 * Empty when this PC is not registered yet; the server then answers 401 and the line stays queued. */
export async function signHeaders(body: string): Promise<Record<string, string>> {
	if (!device?.deviceId || !device.key) return {};
	const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(device.key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
	const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
	return { "X-Device-Id": device.deviceId, "X-Device-Signature": toHex(sig) };
}
