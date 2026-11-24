import { fmtDate } from "@/common/utils/format";

type Entry = { stage: string; action: string; actorName: string; date: string };

/* Who acted at each approval stage of a request, in the same label/value grid the review modals already use.
 * Renders nothing until someone has acted, so a fresh request looks exactly as before. */
export function ApprovalActors({ approvals, stageLabel }: { approvals: Entry[]; stageLabel?: (stage: string) => string | undefined }) {
  const rows = approvals.filter((a) => a.actorName);
  if (rows.length === 0) return null;
  return (
    <div className="kv" style={{ gridTemplateColumns: "1fr 1fr", marginTop: 14 }}>
      {rows.map((a, i) => (
        <div className="i" key={i}>
          <div className="k">{a.action === "Rejected" ? "Rejected by" : "Approved by"}{(() => { const s = stageLabel ? stageLabel(a.stage) : undefined; return s ? ` · ${s}` : ""; })()}</div>
          <div className="v">{a.actorName}{a.date ? <span style={{ color: "var(--muted)", fontWeight: 400 }}> · {fmtDate(a.date)}</span> : null}</div>
        </div>
      ))}
    </div>
  );
}
