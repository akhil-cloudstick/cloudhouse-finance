"use client";



type GrantChipsProps = {
  values: string[];
  labels: Record<string, string>;
  emptyLabel: string;
};

export function GrantChips({
  values,
  labels,
  emptyLabel,
}: GrantChipsProps) {
  if (!values?.length) return <span className="sa-chip off">{emptyLabel}</span>;
  return (
    <span className="sa-chips">
      {values.map((v) => (
        <span key={v} className="sa-chip tag">
          {labels[v] ?? v}
        </span>
      ))}
    </span>
  );
}
