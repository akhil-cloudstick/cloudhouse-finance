import { API_BASE, ApiError } from "@/common/services/httpClient";
import { readToken } from "@/common/services/tenantSession";

/* The demo-data reset.
 *
 * Not built on apiFetchEnveloped like every other service in this codebase,
 * and the exception is deliberate: this endpoint answers with a STREAM of
 * newline-delimited JSON rather than one envelope, so the operator can watch
 * the phases tick past instead of staring at a frozen screen for the several
 * seconds the reset takes. apiFetchEnveloped reads the whole body and parses
 * it as a single object, which is exactly what has to be avoided here.
 *
 * See internal/demoreset/handler.go for the protocol and why it is NDJSON.
 */

export type ResetReport = {
  /** table name -> rows removed */
  deleted: Record<string, number>;
  /** entity name -> rows seeded */
  created: Record<string, number>;
  filesRemoved: number;
  /** The login that was preserved. */
  adminUsername: string;
  durationMs: number;
  seededAt: string;
};

/** One completed phase, as reported by the seeder. */
export type ResetProgress = {
  step: string;
  index: number;
  total: number;
};

type StreamEvent = Partial<ResetProgress> & {
  error?: string;
  done?: boolean;
  report?: ResetReport;
};

/**
 * resetDemoData wipes and reseeds the demo, calling onProgress after each
 * phase, and resolves with the final report.
 *
 * Rejects with an ApiError for a refusal before the stream starts (403 for a
 * non-Administrator, 409 for a reset already running), and with a plain Error
 * for a failure reported inside the stream.
 */
export async function resetDemoData(
  onProgress?: (p: ResetProgress) => void
): Promise<ResetReport> {
  const token = readToken();
  const res = await fetch(`${API_BASE}/demo/reset`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  // A pre-stream refusal is an ordinary envelope, so read it as one. The
  // handler commits the 200 only once it is past every check it can make up
  // front, which is what makes this branch reliable.
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
    // No streaming support in this browser. Nothing is broken — the reset
    // still ran server-side — but there is no way to read the outcome.
    throw new Error(
      "This browser cannot read a streamed response. The reset may have completed; sign in again to check."
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let report: ResetReport | null = null;

  // Read line by line. A chunk can split a line anywhere, so whatever follows
  // the last newline is held back until the next chunk completes it.
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
    // The stream ended without a terminal event — the connection dropped
    // part-way. The server keeps going (see context.WithoutCancel), so the
    // honest message says the outcome is unknown rather than claiming failure.
    throw new Error(
      "The connection dropped before the reset finished. It is probably still running — wait a moment, then sign in again to check."
    );
  }
  return report;
}
