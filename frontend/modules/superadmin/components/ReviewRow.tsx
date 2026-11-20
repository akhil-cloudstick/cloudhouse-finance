"use client";



type ReviewRowProps = {
  label: string;
  value: string;
  changed?: boolean;
  emptyText?: string;
};

export function ReviewRow({
  label,
  value,
  changed,
  emptyText = "not set",
}: ReviewRowProps) {
  return (
    <div className={`sa-review-row${changed ? " changed" : ""}`}>
      <dt>{label}</dt>
      <dd className={value ? "" : "empty"}>{value || emptyText}</dd>
    </div>
  );
}
