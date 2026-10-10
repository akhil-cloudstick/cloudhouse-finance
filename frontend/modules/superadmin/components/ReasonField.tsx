"use client";



type ReasonFieldProps = {
  value: string;
  onChange: (v: string) => void;
  required: boolean;
};

export function ReasonField({
  value,
  onChange,
  required,
}: ReasonFieldProps) {
  return (
    <div className="sa-field">
      <label>{required ? "Reason (required — recorded in the audit log)" : "Reason (optional)"}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} required={required} />
      <span className="sa-hint">
        {required
          ? "Creating, suspending or re-tiering a business always records why."
          : "This action is audited either way; a reason is recorded only if you give one."}
      </span>
    </div>
  );
}
