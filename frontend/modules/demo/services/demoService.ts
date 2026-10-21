import { apiRawFetch, ApiError } from "@/common/services/httpClient";
import { readToken } from "@/common/services/tenantSession";
import type { ResetReport, ResetProgress, StreamEvent } from "@/modules/demo/types/demo-types";

// Both branches of seedDemo wipe identically; neither is the safe one, so the caller must always mean it.
export async function resetDemoData(
  onProgress?: (p: ResetProgress) => void,
  seedDemo = true
): Promise<ResetReport> {
  const token = readToken();
  const res = await apiRawFetch(`/demo/reset?seed=${seedDemo}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* not JSON — keep the status-code message */
    }
    throw new ApiError(message, res.status);
  }

  if (!res.body) {
    // No streaming support in this browser; the reset still ran server-side, just can't be read here.
    throw new Error(
      "This browser cannot read a streamed response. The reset may have completed; sign in again to check."
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report: ResetReport | null = null;

  // A chunk can split a line anywhere; whatever follows the last newline waits for the next chunk.
  for (;;) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });

    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let ev: StreamEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // ignore a malformed line rather than abort the reset
      }

      if (ev.error) throw new Error(ev.error);
      if (ev.done && ev.report) {
        report = ev.report;
      } else if (ev.step && ev.total && onProgress) {
        onProgress({ step: ev.step, index: ev.index ?? 0, total: ev.total });
      }
    }

    if (done) break;
  }

  if (!report) {
    // Connection dropped mid-stream; the server keeps going, so the outcome is unknown, not a failure.
    throw new Error(
      "The connection dropped before the reset finished. It is probably still running — wait a moment, then sign in again to check."
    );
  }
  return report;
}
