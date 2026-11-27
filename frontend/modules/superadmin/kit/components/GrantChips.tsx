type GrantChipsProps = {
  values: string[];
  /** A name per value, as a lookup table or a function; the raw value when neither names it. */
  labels?: Record<string, string> | undefined;
  label?: ((value: string) => string) | undefined;
  emptyLabel: string;
};

export function GrantChips({ values, labels, label, emptyLabel }: GrantChipsProps) {
  if (!values?.length) return <span className="sa-chip off">{emptyLabel}</span>;
  return (
    <span className="sa-chips">
      {values.map((v) => (
        <span key={v} className="sa-chip tag">
          {label ? label(v) : labels?.[v] ?? v}
        </span>
      ))}
    </span>
  );
}
