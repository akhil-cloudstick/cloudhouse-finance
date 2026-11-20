/* The arranged sidebar header — shared by the app's Sidebar and the superadmin
 * console's Branding step, which edits it with a live preview.
 *
 * WHY A TREE. Businesses bring every shape of logo: a square seal next to a
 * short code, a wide wordmark that already carries the full name, no logo at
 * all. A fixed "logo beside two lines of text" lockup fits the first only. So
 * the vendor arranges the three header items — logo, title, subtitle — by drag
 * and drop, and the result is stored as rows and columns nested inside each
 * other:
 *
 *   { dir: "row", children: ["logo", { dir: "col", children: ["title", "sub"] }] }
 *
 * is the classic lockup. An item left out of the tree is hidden.
 *
 * The backend validates the same shape (superadmin/header_layout.go) and stores
 * it normalised; parseHeaderLayout below re-checks it on the way in, so a bad
 * value degrades to the classic lockup rather than a broken sidebar.
 *
 * Pure and DOM-free: the console and the app must agree exactly.
 */

export type HeaderItem = "logo" | "title" | "sub";
export type HeaderDir = "row" | "col";
export type HeaderNode = { dir: HeaderDir; children: HeaderChild[] };
export type HeaderChild = HeaderNode | HeaderItem;
export type HeaderAlign = "start" | "center" | "spread";
export type HeaderPad = "compact" | "normal" | "roomy";
export type LogoShape = "square" | "wide";

export type HeaderLayout = {
  tree: HeaderNode;
  align: HeaderAlign;
  pad: HeaderPad;
  logoShape: LogoShape;
  /** Logo box width in px. A square logo is as tall as it is wide; a wide one
   * keeps its own proportions, capped at 64px tall. */
  logoWidth: number;
  /** Title / subtitle font size in px; 0 = automatic from the text's length. */
  titleSize: number;
  subSize: number;
};

export const HEADER_ITEMS: HeaderItem[] = ["logo", "title", "sub"];
export const HEADER_ALIGNS: HeaderAlign[] = ["start", "center", "spread"];
export const HEADER_PADS: HeaderPad[] = ["compact", "normal", "roomy"];

/* Limits — keep in step with backend/internal/superadmin/header_layout.go. */
export const LOGO_WIDTH_MIN = 24;
export const LOGO_WIDTH_MAX = 212;
export const LOGO_WIDTH_SQUARE = 48;
export const LOGO_WIDTH_WIDE = 190;
export const TITLE_SIZE_MIN = 10;
export const TITLE_SIZE_MAX = 40;
export const SUB_SIZE_MIN = 6;
export const SUB_SIZE_MAX = 16;
/** A logo whose width is more than this many times its height counts as wide. */
export const WIDE_LOGO_RATIO = 1.6;

const row = (...children: HeaderChild[]): HeaderNode => ({ dir: "row", children });
const col = (...children: HeaderChild[]): HeaderNode => ({ dir: "col", children });

const isNode = (c: HeaderChild | null | undefined): c is HeaderNode => !!c && typeof c === "object";

/* --- Tree operations ---------------------------------------------------------
 * Every operation returns a NEW tree (the console keeps undo history) and is
 * followed by normalize, so the stored shape is always the simplest one: no
 * empty containers, no single-child containers, no row directly inside a row. */

function normalizeChild(c: HeaderChild | null): HeaderChild | null {
  if (!isNode(c)) return c;
  const kids: HeaderChild[] = [];
  for (const k of c.children.map(normalizeChild)) {
    if (!k) continue;
    if (isNode(k) && k.dir === c.dir) kids.push(...k.children);
    else kids.push(k);
  }
  if (kids.length === 0) return null;
  if (kids.length === 1) return kids[0];
  return { dir: c.dir, children: kids };
}

/** Normalises a tree and guarantees the root is a container (possibly empty). */
export function rootify(c: HeaderChild | null): HeaderNode {
  const n = normalizeChild(c);
  if (isNode(n)) return n;
  return col(...(n ? [n] : []));
}

/** The items shown, in reading order. */
export function headerItems(c: HeaderChild | null): HeaderItem[] {
  if (!c) return [];
  if (!isNode(c)) return [c];
  return c.children.flatMap(headerItems);
}

function without(c: HeaderChild, item: HeaderItem): HeaderChild | null {
  if (!isNode(c)) return c === item ? null : c;
  return { dir: c.dir, children: c.children.map((k) => without(k, item)).filter((k): k is HeaderChild => !!k) };
}

export function removeItem(tree: HeaderNode, item: HeaderItem): HeaderNode {
  return rootify(without(tree, item));
}

function parentOf(n: HeaderNode, item: HeaderItem): HeaderNode | null {
  if (n.children.includes(item)) return n;
  for (const c of n.children) {
    if (isNode(c)) {
      const p = parentOf(c, item);
      if (p) return p;
    }
  }
  return null;
}

const clone = (n: HeaderNode): HeaderNode => JSON.parse(JSON.stringify(n));

export type DropSide = "left" | "right" | "top" | "bottom";

/** Moves `item` onto one side of `target`: left/right put them in a row, top/bottom in a column. */
export function placeItem(tree: HeaderNode, item: HeaderItem, target: HeaderItem, side: DropSide): HeaderNode {
  if (item === target) return tree;
  const t = clone(rootify(without(tree, item)));
  const p = parentOf(t, target);
  if (!p) return tree;
  const dir: HeaderDir = side === "left" || side === "right" ? "row" : "col";
  const before = side === "left" || side === "top";
  const i = p.children.indexOf(target);
  if (p.dir === dir) p.children.splice(before ? i : i + 1, 0, item);
  else p.children[i] = { dir, children: before ? [item, target] : [target, item] };
  return rootify(t);
}

/** Adds `item` on its own line at the bottom of the header. */
export function appendItem(tree: HeaderNode, item: HeaderItem): HeaderNode {
  const t = rootify(without(tree, item));
  return rootify(t.dir === "col" ? col(...t.children, item) : col(t, item));
}

/* --- Starting layouts ----------------------------------------------------------
 * One click arranges the header; dragging fine-tunes from there. A starting
 * layout only re-arranges what is currently shown — hidden items stay hidden. */
export type LayoutPreset = "side" | "stack" | "split" | "inline";
export const LAYOUT_PRESETS: { id: LayoutPreset; label: string }[] = [
  { id: "side", label: "Beside" },
  { id: "stack", label: "Stacked" },
  { id: "split", label: "Split" },
  { id: "inline", label: "In a row" },
];

function presetTree(kind: LayoutPreset): HeaderNode {
  switch (kind) {
    case "side":
      return row("logo", col("title", "sub"));
    case "stack":
      return col("logo", "title", "sub");
    case "split":
      return col("logo", row("title", "sub"));
    case "inline":
      return row("logo", "title", "sub");
  }
}

function keepOnly(c: HeaderChild, shown: HeaderItem[]): HeaderChild | null {
  if (!isNode(c)) return shown.includes(c) ? c : null;
  return { dir: c.dir, children: c.children.map((k) => keepOnly(k, shown)).filter((k): k is HeaderChild => !!k) };
}

export function presetLayoutTree(kind: LayoutPreset, shown: HeaderItem[]): HeaderNode {
  return rootify(keepOnly(presetTree(kind), shown));
}

/** Which starting layout the tree currently matches, if any ("Custom" otherwise). */
export function matchingPreset(tree: HeaderNode): LayoutPreset | null {
  const shown = headerItems(tree);
  const now = JSON.stringify(rootify(tree));
  for (const p of LAYOUT_PRESETS) {
    if (JSON.stringify(presetLayoutTree(p.id, shown)) === now) return p.id;
  }
  return null;
}

/* --- Defaults and parsing ------------------------------------------------------ */

/** The classic lockup as a layout: what an un-arranged business renders. */
export function classicLayout(shape: LogoShape = "square"): HeaderLayout {
  return {
    tree: shape === "wide" ? col("logo", "title", "sub") : row("logo", col("title", "sub")),
    align: "start",
    pad: "normal",
    logoShape: shape,
    logoWidth: shape === "wide" ? LOGO_WIDTH_WIDE : LOGO_WIDTH_SQUARE,
    titleSize: 0,
    subSize: 0,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sizeOrAuto = (v: unknown, lo: number, hi: number) =>
  typeof v === "number" && v > 0 ? Math.round(clamp(v, lo, hi) * 2) / 2 : 0;

function parseChild(v: unknown, depth: number, seen: Set<string>): HeaderChild | null {
  if (typeof v === "string") {
    if (!(HEADER_ITEMS as string[]).includes(v) || seen.has(v)) return null;
    seen.add(v);
    return v as HeaderItem;
  }
  if (!v || typeof v !== "object" || depth > 6) return null;
  const o = v as { dir?: unknown; children?: unknown };
  if ((o.dir !== "row" && o.dir !== "col") || !Array.isArray(o.children)) return null;
  const children = o.children.map((c) => parseChild(c, depth + 1, seen)).filter((c): c is HeaderChild => !!c);
  return { dir: o.dir, children };
}

/** Reads a stored layout (object or JSON string). null = classic lockup. */
export function parseHeaderLayout(v: unknown): HeaderLayout | null {
  if (typeof v === "string") {
    if (!v.trim()) return null;
    try {
      v = JSON.parse(v);
    } catch {
      return null;
    }
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const tree = parseChild(o.tree, 0, new Set());
  if (!isNode(tree)) return null;
  const pick = <T extends string>(x: unknown, set: T[], dflt: T): T => (set.includes(x as T) ? (x as T) : dflt);
  return {
    tree: rootify(tree),
    align: pick(o.align, HEADER_ALIGNS, "start"),
    pad: pick(o.pad, HEADER_PADS, "normal"),
    logoShape: pick<LogoShape>(o.logoShape, ["square", "wide"], "square"),
    logoWidth:
      typeof o.logoWidth === "number" && o.logoWidth > 0
        ? Math.round(clamp(o.logoWidth, LOGO_WIDTH_MIN, LOGO_WIDTH_MAX))
        : LOGO_WIDTH_SQUARE,
    titleSize: sizeOrAuto(o.titleSize, TITLE_SIZE_MIN, TITLE_SIZE_MAX),
    subSize: sizeOrAuto(o.subSize, SUB_SIZE_MIN, SUB_SIZE_MAX),
  };
}

export function serializeHeaderLayout(l: HeaderLayout): string {
  return JSON.stringify({ v: 1, ...l, tree: rootify(l.tree) });
}

/* --- Text --------------------------------------------------------------------- */

/** Subtitle text as shown: Return (or a typed "\n" or "/n") breaks the line, at most two lines. */
export function normalizeSubtitle(v: string | null | undefined): string {
  return (v || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\\/]n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
}

/* Automatic sizes — the same length steps as the classic lockup
 * (common/utils/brandLockup.ts): the longest string that still fits the rail
 * on one line at each size. */
export function autoTitleSize(text: string): number {
  const n = text.trim().length;
  return n <= 6 ? 26 : n <= 10 ? 21 : n <= 12 ? 17 : 14;
}

export function autoSubSize(text: string): number {
  const widest = normalizeSubtitle(text)
    .split("\n")
    .reduce((w, l) => Math.max(w, l.length), 0);
  return widest > 18 ? 7.6 : 8.4;
}

/** Tab-icon letters when the logo cannot be used: the short name, else the sign-in code. Up to 3. */
export function monogramFor(shortName: string, code: string, name: string): string {
  const src = (shortName.trim() || code.trim() || name.trim()).replace(/[^\p{L}\p{N}]/gu, "").toUpperCase();
  return Array.from(src).slice(0, src.length <= 3 ? 3 : 2).join("");
}
