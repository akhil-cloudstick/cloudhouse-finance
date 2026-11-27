/* The sidebar brand lockup: which two lines to show, and how big.
 *
 * Why this is a module and not four lines in Sidebar.tsx: the sidebar used to
 * hardcode one business's semantics — bold line = short code, small line =
 * full name. That reads correctly for "CTFI" over "Chittilapilly Thommana"
 * and for nothing else. The other live sites put the business NAME on the
 * bold line and a descriptor under it ("CloudHouse" over "GOLD FINANCE"), a
 * shape no field modelled. With a hundred more businesses coming, neither the
 * wording nor the size can be something we hand-tune per tenant.
 *
 * So: both lines are the business's own text (name / shortName /
 * lockupTagline, all vendor-set), and the size is a pure function of how long
 * that text is. Character count rather than measured pixels — a measured fit
 * means a layout read and a visible reflow on every brand load, and the rail
 * is a fixed width, so counting is both cheaper and stable.
 *
 * Pure and DOM-free on purpose: the superadmin console renders a live preview
 * of the same lockup while a vendor types, and must agree with the app
 * exactly. One implementation, two callers.
 */

/** Headline size step. Pixel values live in app.css, keyed by this token. */
export type LockupFit = "xl" | "lg" | "md" | "sm";

/** Subline size step. Only two, because the line is small to begin with. */
export type LockupSubFit = "sm" | "xs";

export type LockupInput = {
  name?: string | null;
  shortName?: string | null;
  lockupTagline?: string | null;
};

export type Lockup = {
  /** Bold headline. Empty only before any brand data has arrived. */
  top: string;
  /** Small uppercase subline. Empty means: render no second line at all. May
   * contain a single "\n" the vendor typed — render it with white-space
   * preserved (app.css uses pre-line), not collapsed. */
  bottom: string;
  topFit: LockupFit;
  bottomFit: LockupSubFit;
};

/* Longest string that still fits the rail on ONE line at each step.
 *
 * Derived, not guessed: the text column is ~149px wide (a 248px sidebar less
 * padding, the 48px mark and the gap), and Montserrat 700 at .04em averages
 * ~0.677em per character, so the limit at each size is 149 / (px * 0.677) —
 * 26px→8, 21px→10, 17px→12, 14px→15.
 *
 * The one place this departs from the arithmetic is xl, capped at 6 rather
 * than 8: that step is for short codes ("CTFI", "AMBIKA", both of which the
 * live sites set at this size), and an 8-character word rendered that large
 * crowds the mark beside it even though it technically fits.
 *
 * Past the last step the name wraps to a second line rather than overflow —
 * see app.css. Uppercase runs wider than the average, so a name near a
 * boundary may wrap; that is the intended failure, not overflow. */
const TOP_STEPS: ReadonlyArray<readonly [maxLen: number, fit: LockupFit]> = [
  [6, "xl"],
  [10, "lg"],
  [12, "md"],
];
const TOP_SMALLEST: LockupFit = "sm";

const norm = (v: string | null | undefined): string => (v || "").trim();

/** Longest line, for text that may carry explicit breaks. Sizing has to key
 * on the widest line — total length would shrink a deliberately-broken
 * subline for no reason. */
const widestLine = (text: string): number =>
  text.split("\n").reduce((w, line) => Math.max(w, line.length), 0);

/* The subline may carry explicit line breaks, because where a long name
 * breaks is an editorial choice we cannot make for a business: CTFI's reads
 * "CHITTILAPILLY / THOMMANA", and no rule about widths would know to break
 * there rather than wherever the box happens to run out. So the vendor marks
 * the break and this preserves it.
 *
 * Two ways to mark it, both accepted. Pressing Return in the subtitle box is
 * the real one. But a literal "\n" (or "/n") typed into the box is what
 * people reach for by habit, and rendering those two characters verbatim in
 * the sidebar is never what anyone meant — no business name contains them —
 * so they are treated as the break they were intended to be rather than left
 * to look like a bug on a customer's screen.
 *
 * Capped at two lines: the lockup sits above the nav, and a third line pushes
 * it down. Blank lines are dropped rather than rendered, so a stray trailing
 * Return costs nothing. */
const MAX_SUB_LINES = 2;

function normSub(v: string | null | undefined): string {
  return (v || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\\/]n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_SUB_LINES)
    .join("\n");
}

function topFitFor(text: string): LockupFit {
  for (const [maxLen, fit] of TOP_STEPS) if (text.length <= maxLen) return fit;
  return TOP_SMALLEST;
}

/**
 * resolveLockup picks the two lines and their size steps.
 *
 * The headline is the shortest identity the business has given us; the
 * subline is its tagline, or its full name when it has not set one. The
 * subline is dropped entirely when it would only restate the headline —
 * without that, a business that filled in nothing but a name (the common case
 * on day one, since shortName falls back to name server-side) would render
 * "Ambika" stacked over "AMBIKA", which reads as a mistake rather than a
 * lockup. Comparison is case- and space-insensitive because the subline is
 * uppercased in CSS.
 *
 * Every branch can legitimately produce empty strings: on the first load
 * before any brand data arrives, the lockup renders blank rather than the
 * vendor's name. A business is never shown a brand that is not its own.
 */
export function resolveLockup(input: LockupInput): Lockup {
  const name = norm(input.name);
  const shortName = norm(input.shortName);
  const tagline = normSub(input.lockupTagline);

  const top = shortName || name;
  let bottom = tagline || (name === top ? "" : name);

  if (bottom.replace(/\s+/g, "").toLowerCase() === top.replace(/\s+/g, "").toLowerCase()) {
    bottom = "";
  }

  /* The headline's size depends only on its own length, never on whether a
   * subline is present. Losing the subline frees VERTICAL room, and font size
   * spends HORIZONTAL room — growing the text here would push a long name off
   * the edge of a rail it currently fits. A one-line lockup needs no special
   * case: the text column is centred against the logo mark by its parent. */
  return {
    top,
    bottom,
    topFit: topFitFor(top),
    bottomFit: widestLine(bottom) > 18 ? "xs" : "sm",
  };
}
