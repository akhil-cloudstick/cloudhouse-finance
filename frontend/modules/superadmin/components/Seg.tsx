"use client";



type SegProps = {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
};

/* --------------------------------------------------------------------------- */

export function Seg({
  value,
  options,
  onChange,
}: SegProps) {
  return (
    <div className="bs-seg">
      {options.map(([v, label]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}
