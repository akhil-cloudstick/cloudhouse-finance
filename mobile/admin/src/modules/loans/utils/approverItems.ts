import { dmy } from "@/common/utils/format";

type Actor = { stage?: string; action?: string; actorName?: string; createdAt?: string };

/* FieldGrid rows naming who acted at each approval stage ("Approved by · Manager" → name · date).
 * Empty until someone has acted, so a fresh request renders exactly as before. */
export function approverItems(approvals?: Actor[] | null, stageLabel?: (stage: string) => string | undefined): { k: string; v: string }[] {
  return (approvals ?? [])
    .filter((a) => a.actorName)
    .map((a) => ({
      k: `${a.action === "Rejected" ? "Rejected by" : "Approved by"}${stageLabel && stageLabel(a.stage ?? "") ? ` · ${stageLabel(a.stage ?? "")}` : ""}`,
      v: `${a.actorName}${a.createdAt ? ` · ${dmy(a.createdAt)}` : ""}`,
    }));
}
