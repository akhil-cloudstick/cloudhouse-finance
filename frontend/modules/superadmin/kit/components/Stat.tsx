import type { ReactNode } from "react";

type StatProps = {
  label: string;
  value: ReactNode;
  sub?: string | undefined;
  tone?: "violet" | "amber" | undefined;
};

export function Stat({ label, value, sub, tone = "violet" }: StatProps) {
  return (
    <div className={`sa-card sa-stat ${tone}`}>
      <div>
        <div className="sa-card-value">{value}</div>
        <div className="sa-card-label">{label}</div>
        {sub && <div className="sa-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
