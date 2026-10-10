"use client";



type StatProps = {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "violet" | "amber";
};

export function Stat({
  label,
  value,
  sub,
  tone = "violet",
}: StatProps) {
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
