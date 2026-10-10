"use client";

import { KpiParts } from "@/modules/cash/components/KpiParts";

type KpiProps = {
  l: string; v: string | number; s?: string; parts?: [string, number][]; cls?: string; keepZero?: boolean;
};

export function Kpi({ l, v, s, parts, cls, keepZero }: KpiProps) {
  return (
    <div className={`kpi ${cls || ""}`}>
      <div className="l">{l}</div>
      <div className="v">{v}</div>
      <div className="s">{s || ""}</div>
      {parts ? <KpiParts parts={parts} keepZero={keepZero} /> : null}
    </div>
  );
}
