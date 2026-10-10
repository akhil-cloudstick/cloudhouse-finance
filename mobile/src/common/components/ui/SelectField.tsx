import { Field } from "./Field";
import { ThemeDropdown } from "./ThemeDropdown";

type SelectFieldProps<T extends string> = { label?: string; value: T; options: readonly T[]; onChange: (v: T) => void; labels?: Partial<Record<T, string>> };

/** Simple string-options dropdown. */
export function SelectField<T extends string>({ label, value, options, onChange, labels }: SelectFieldProps<T>) {
  return (
    <Field label={label}>
      <ThemeDropdown value={value} options={[...options]} onChange={onChange} labelOf={(o) => labels?.[o] ?? o} />
    </Field>
  );
}
