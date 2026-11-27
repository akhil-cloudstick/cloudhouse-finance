import { OS_NAME, nextVersion, versionProblem, type DesktopOs } from "../common/desktopOs";

/* The Rebuild window's fields, the same in every console:
 *   Build for — which operating systems (at least one);
 *   Version   — filled with the recommended next version; it can be raised, never lowered. */

type BuildForFieldProps = {
  /** The systems this product builds for, in order. */
  options: DesktopOs[];
  value: DesktopOs[];
  onChange: (next: DesktopOs[]) => void;
};

export function BuildForField({ options, value, onChange }: BuildForFieldProps) {
  const toggle = (os: DesktopOs) => onChange(value.includes(os) ? value.filter((v) => v !== os) : options.filter((o) => o === os || value.includes(o)));
  return (
    <div className="sa-field">
      <label>Build for</label>
      <div className="sa-toggle-group" role="group" aria-label="Build for">
        {options.map((os) => (
          <button key={os} type="button" aria-pressed={value.includes(os)} onClick={() => toggle(os)}>
            {OS_NAME[os]}
          </button>
        ))}
      </div>
      {value.length === 0 && <span className="sa-error">Pick at least one.</span>}
    </div>
  );
}

type VersionFieldProps = {
  value: string;
  onChange: (next: string) => void;
  /** The version live now; null = nothing built yet; undefined = still reading it. */
  current: string | null | undefined;
  /** Set when one version covers several businesses (the highest of them is "current"). */
  note?: string | undefined;
};

export function VersionField({ value, onChange, current, note }: VersionFieldProps) {
  const loading = current === undefined;
  const problem = loading || !value ? null : versionProblem(value, current);
  return (
    <div className={problem ? "sa-field has-err" : "sa-field"}>
      <label>Version</label>
      <input
        value={loading ? "" : value}
        placeholder={loading ? "Reading the live version…" : nextVersion(current)}
        disabled={loading}
        inputMode="decimal"
        autoComplete="off"
        onChange={(e) => onChange(e.target.value.trim())}
      />
      {problem ? (
        <span className="sa-error" role="alert">{problem}</span>
      ) : (
        <span className="sa-hint">
          {loading
            ? "Reading the live version…"
            : `${current ? `Live now: ${current}. ` : "Nothing built yet. "}Recommended: ${nextVersion(current)}. You can raise it, not lower it.`}
          {note ? ` ${note}` : ""}
        </span>
      )}
    </div>
  );
}

/** True when the version field can be built: loaded, like 1.2.3 and higher than the live one. */
export function versionReady(value: string, current: string | null | undefined): boolean {
  return current !== undefined && !!value && !versionProblem(value, current);
}
