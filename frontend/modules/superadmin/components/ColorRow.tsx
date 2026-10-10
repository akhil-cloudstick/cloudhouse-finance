"use client";



const AA = 4.5;
type ColorRowProps = {
  name: string;
  hint: string;
  bg: string;
  fg: string;
  bgLabel: string;
  fgLabel: string;
  ratio: number;
  onPickBg: (anchor: HTMLElement) => void;
  onPickFg: (anchor: HTMLElement) => void;
  onFix: () => void;
};

export function ColorRow({
  name,
  hint,
  bg,
  fg,
  bgLabel,
  fgLabel,
  ratio,
  onPickBg,
  onPickFg,
  onFix,
}: ColorRowProps) {
  const ok = ratio >= AA;
  return (
    <div className="bs-color">
      <button
        type="button"
        className="bs-tile"
        style={{ background: bg, color: fg }}
        aria-label={`${name} colour`}
        onClick={(e) => onPickBg(e.currentTarget)}
      >
        Aa
      </button>
      <span className="bs-c-name">
        {name}
        <small>{hint}</small>
      </span>
      {/* Only a problem is worth showing: readable colours get no badge. */}
      {ok ? (
        <span />
      ) : (
        <button
          type="button"
          className="bs-badge bad"
          title="Staff will struggle to read this text. Click to use the automatic text colour."
          onClick={onFix}
        >
          Hard to read · fix
        </button>
      )}
      <div className="bs-c-vals">
        <button type="button" onClick={(e) => onPickBg(e.currentTarget)}>
          <i style={{ background: bg }} />
          {bgLabel}
        </button>
        <button type="button" onClick={(e) => onPickFg(e.currentTarget)}>
          <i style={{ background: fg }} />
          <em>Text</em>
          {fgLabel}
        </button>
      </div>
    </div>
  );
}
