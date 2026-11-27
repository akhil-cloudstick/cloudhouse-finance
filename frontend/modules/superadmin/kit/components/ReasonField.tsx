import { autoGrow } from "../common/autoGrow";

type ReasonFieldProps = {
  value: string;
  onChange: (v: string) => void;
  required: boolean;
  /* Validation message, shown right under the box (which turns red). */
  error?: string | undefined;
};


export function ReasonField({ value, onChange, required, error }: ReasonFieldProps) {
  return (
    <div className={error ? "sa-field has-err" : "sa-field"}>
      <label>{required ? "Reason (required — recorded in the audit log)" : "Reason (optional)"}</label>
      <textarea
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          autoGrow(e.target);
        }}
        rows={2}
        required={required}
      />
      {error && (
        <span className="sa-error" role="alert">
          {error}
        </span>
      )}
      <span className="sa-hint">
        {required
          ? "Creating, suspending or re-tiering a business always records why."
          : "This action is audited either way; a reason is recorded only if you give one."}
      </span>
    </div>
  );
}
