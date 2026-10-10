"use client";

import localFont from "next/font/local";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import "@/modules/superadmin/styles/branding-step.css";
import BrandHeader, { subSizePx, subStyle, titleSizePx, titleStyle } from "@/common/components/layout/BrandHeader";
import { appendItem, headerItems, LAYOUT_PRESETS, LOGO_WIDTH_MAX, LOGO_WIDTH_MIN, LOGO_WIDTH_SQUARE, LOGO_WIDTH_WIDE, matchingPreset, monogramFor, placeItem, presetLayoutTree, removeItem, SUB_SIZE_MAX, SUB_SIZE_MIN, TITLE_SIZE_MAX, TITLE_SIZE_MIN, WIDE_LOGO_RATIO, type DropSide, type HeaderAlign, type HeaderItem, type HeaderLayout, type HeaderPad } from "@/common/config/headerLayout";
import {
  brandPreviewVars,
  buildFavicon,
  DEFAULT_BRAND_COLOR,
  DEFAULT_FONT_FAMILY,
  DEFAULT_FONT_SCALE,
  FONT_FAMILIES,
  FONT_SCALES,
  hexContrast,
  resolveBrandColors,
} from "@/common/config/theme";
import { resolveLockup } from "@/common/utils/brandLockup";
import { extractPaletteFromImage } from "@/common/utils/dominantColor";
import { NavIcon } from "./NavIcon";
import { PresetIcon } from "./PresetIcon";
import { Seg } from "./Seg";
import { EditableText } from "./EditableText";
import { ColorPopover } from "./ColorPopover";
import { ColorRow } from "./ColorRow";

/* The wizard's Branding step: colours, logo and the sidebar header, edited
 * against a live preview of the business's own sidebar.
 *
 * The header is arranged by DRAG AND DROP in the preview — any item onto any
 * side of another, edges dragged to resize, text typed in place — with four
 * starting layouts for a quick start. Everything the preview draws comes from
 * the same code the business's app uses (common/components/layout/BrandHeader,
 * common/config/theme), so what the vendor sees is what the business gets.
 *
 * The step is controlled: the wizard owns the draft (it saves it), this owns
 * only view state — the open colour picker, the selection, and undo/redo.
 */

/* The preview's type is the app's own: Montserrat for the wordmark, Inter for
 * the nav. The console loads neither, so they are scoped to the preview. */
const previewDisplayFont = localFont({
  src: "../../../app/(product)/fonts/Montserrat-Variable-latin.woff2",
  variable: "--font-display",
  weight: "600 800",
  display: "swap",
});
const previewSansFont = localFont({
  src: "../../../app/(product)/fonts/Inter-Variable-latin.woff2",
  variable: "--font-sans",
  weight: "400 700",
  display: "swap",
});
// The optional business fonts, so the Typography choice shows for real.
const previewLoraFont = localFont({
  src: "../../../app/(product)/fonts/Lora-Variable-latin.woff2",
  variable: "--font-lora",
  weight: "400 700",
  display: "swap",
  preload: false,
});
const previewPoppinsFont = localFont({
  src: [
    { path: "../../../app/(product)/fonts/Poppins-400-latin.woff2", weight: "400" },
    { path: "../../../app/(product)/fonts/Poppins-500-latin.woff2", weight: "500" },
    { path: "../../../app/(product)/fonts/Poppins-600-latin.woff2", weight: "600" },
    { path: "../../../app/(product)/fonts/Poppins-700-latin.woff2", weight: "700" },
  ],
  variable: "--font-poppins",
  display: "swap",
  preload: false,
});

export type BrandingDraft = {
  color: string;
  /** "" = derived from the primary colour. */
  secondaryColor: string;
  /** "" = automatic (white, or dark on a light colour). */
  navTextColor: string;
  onBrandTextColor: string;
  logoDisplay: string;
  fontFamily: string;
  fontScale: string;
  layout: HeaderLayout;
  /** The short name and subtitle — Step 1's fields, also typed in the preview. */
  shortName: string;
  tagline: string;
  /** A newly picked logo, its preview URL, or a request to remove the saved one. */
  logoFile: File | null;
  logoPreview: string | null;
  removeLogo: boolean;
};

type Props = {
  draft: BrandingDraft;
  onChange: (next: BrandingDraft) => void;
  /** The logo already saved for this business ("" when none, or on create). */
  savedLogoUrl: string;
  businessName: string;
  code: string;
  /** True while the business is still on the classic lockup and nothing in the
   * header has been arranged yet — the preview then shows exactly what the
   * app shows today (headline falls back to the business name). */
  classic: boolean;
  isCreate: boolean;
};

type ColorKey = "color" | "secondaryColor" | "onBrandTextColor" | "navTextColor";

const COLOR_PICKER: Record<ColorKey, { title: string; auto: string | null }> = {
  color: { title: "Primary", auto: null },
  secondaryColor: { title: "Secondary", auto: "Auto · darker primary" },
  onBrandTextColor: { title: "Text on primary", auto: "Auto · readable" },
  navTextColor: { title: "Sidebar text", auto: "Auto · readable" },
};

const BG_SWATCHES = ["#6054bf", "#1a3e93", "#0e2a5c", "#14213d", "#c08a1e", "#b8861b", "#2f6b4f", "#7a1f3d", "#f6f1e4"];
const TEXT_SWATCHES = ["#ffffff", "#f6f1e4", "#e2b33f", "#1b1d2a", "#000000"];

const HEX = /^#[0-9a-f]{6}$/i;
const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/* A draft's identity for undo history. A File cannot be compared, so the new
 * logo stands in by its preview URL. */
const draftKey = (d: BrandingDraft) => JSON.stringify({ ...d, logoFile: d.logoFile ? d.logoPreview : null });

export default function BrandingStep({ draft, onChange, savedLogoUrl, businessName, code, classic, isCreate }: Props) {
  // Latest draft for async work (logo palette, history) that outlives a render.
  const draftRef = useRef(draft);
  useLayoutEffect(() => {
    draftRef.current = draft;
  });
  // View state. Declared up front: undo/redo below clears both.
  const [selected, setSelected] = useState<HeaderItem | null>(null);
  const [picker, setPicker] = useState<{ key: ColorKey; top: number; left: number } | null>(null);
  const set = useCallback((patch: Partial<BrandingDraft>) => onChange({ ...draftRef.current, ...patch }), [onChange]);
  const setLayout = useCallback(
    (patch: Partial<HeaderLayout>) => onChange({ ...draftRef.current, layout: { ...draftRef.current.layout, ...patch } }),
    [onChange]
  );

  const logoUrl = draft.removeLogo ? "" : draft.logoPreview || savedLogoUrl;
  const logoName = draft.removeLogo ? "" : draft.logoFile ? draft.logoFile.name : savedLogoUrl ? "Current logo" : "";
  const theme = {
    primary: HEX.test(draft.color) ? draft.color : DEFAULT_BRAND_COLOR,
    secondary: draft.secondaryColor,
    navText: draft.navTextColor,
    onBrandText: draft.onBrandTextColor,
  };
  const colors = resolveBrandColors(theme);
  const [palette, setPalette] = useState<string[]>([]);

  /* ---------- undo / redo ---------- */
  const hist = useRef({ past: [] as BrandingDraft[], future: [] as BrandingDraft[], last: draft, lastKey: draftKey(draft) });
  const [histCounts, setHistCounts] = useState({ undo: 0, redo: 0 });
  const bumpHist = () => setHistCounts({ undo: hist.current.past.length, redo: hist.current.future.length });
  const commit = useCallback(() => {
    const h = hist.current;
    const now = draftRef.current;
    const k = draftKey(now);
    if (k === h.lastKey) return;
    h.past.push(h.last);
    if (h.past.length > 100) h.past.shift();
    h.future = [];
    h.last = now;
    h.lastKey = k;
    bumpHist();
  }, []);
  // A burst of changes (dragging a colour, a resize handle) settles into one step.
  useEffect(() => {
    if (draftKey(draft) === hist.current.lastKey) return;
    const t = window.setTimeout(commit, 300);
    return () => window.clearTimeout(t);
  }, [draft, commit]);

  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 900);
    return () => window.clearTimeout(t);
  }, [toast]);

  const restore = useCallback(
    (d: BrandingDraft) => {
      hist.current.last = d;
      hist.current.lastKey = draftKey(d);
      setSelected(null);
      setPicker(null);
      onChange(d);
      bumpHist();
    },
    [onChange]
  );
  const undo = useCallback(() => {
    commit();
    const h = hist.current;
    const prev = h.past.pop();
    if (!prev) return;
    h.future.push(h.last);
    restore(prev);
    setToast("Undone");
  }, [commit, restore]);
  const redo = useCallback(() => {
    const h = hist.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(h.last);
    restore(next);
    setToast("Redone");
  }, [restore]);

  /* Ctrl+Z / Ctrl+Shift+Z (or Ctrl+Y), once the preview has been clicked.
   * Typing in a text field keeps that field's own undo. */
  const canvasRef = useRef<HTMLDivElement>(null);
  const [previewActive, setPreviewActive] = useState(false);
  useEffect(() => {
    const onDown = (e: PointerEvent) => setPreviewActive(!!canvasRef.current?.contains(e.target as Node));
    const onKey = (e: KeyboardEvent) => {
      if (!previewActive || !(e.ctrlKey || e.metaKey)) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, [contenteditable='true']")) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [previewActive, undo, redo]);

  /* ---------- logo ---------- */
  function pickLogo(file: File) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const wide = img.naturalWidth / img.naturalHeight > WIDE_LOGO_RATIO;
      const d = draftRef.current;
      const shown = headerItems(d.layout.tree);
      let tree = d.layout.tree;
      if (!shown.includes("logo")) tree = appendItem(tree, "logo");
      // A wide logo leaves no room beside it, so text goes under it.
      tree = presetLayoutTree(wide ? "stack" : "side", headerItems(tree));
      onChange({
        ...d,
        logoFile: file,
        logoPreview: url,
        removeLogo: false,
        layout: { ...d.layout, tree, logoShape: wide ? "wide" : "square", logoWidth: wide ? LOGO_WIDTH_WIDE : LOGO_WIDTH_SQUARE },
      });
    };
    img.src = url;
    /* Fill Primary/Secondary from the logo, but only a colour still at its
     * untouched PLATFORM default — an existing business's saved colour is a
     * deliberate choice and is never overwritten by a re-upload. */
    void extractPaletteFromImage(file).then((p) => {
      setPalette(p.colors);
      const d = draftRef.current;
      const [first, second] = p.colors;
      const patch: Partial<BrandingDraft> = {};
      if (first && d.color === DEFAULT_BRAND_COLOR) patch.color = first;
      if (second && !d.secondaryColor) patch.secondaryColor = second;
      if (Object.keys(patch).length) onChange({ ...draftRef.current, ...patch });
    });
  }

  function removeLogo() {
    const d = draftRef.current;
    onChange({ ...d, logoFile: null, logoPreview: null, removeLogo: !!savedLogoUrl, layout: { ...d.layout, tree: removeItem(d.layout.tree, "logo") } });
  }

  function setShape(shape: HeaderLayout["logoShape"]) {
    const d = draftRef.current;
    const w = shape === "wide" ? Math.max(d.layout.logoWidth, 170) : Math.min(d.layout.logoWidth, 56);
    setLayout({ logoShape: shape, logoWidth: w });
  }

  /* ---------- selection, drag and drop, resize ---------- */
  const [dragging, setDragging] = useState<HeaderItem | null>(null);
  const [drop, setDrop] = useState<{ target: HeaderItem | "end"; side?: DropSide } | null>(null);
  const [resizing, setResizing] = useState<HeaderItem | null>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest?.(".bs-blk") && !t.closest?.(".bs-cp")) setSelected(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, []);

  function sideOf(el: HTMLElement, e: DragEvent): DropSide {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    const dx = Math.min(x, 1 - x) * r.width;
    const dy = Math.min(y, 1 - y) * r.height;
    return dx < dy ? (x < 0.5 ? "left" : "right") : y < 0.5 ? "top" : "bottom";
  }

  function startDrag(item: HeaderItem, e: DragEvent, ghost: HTMLElement | null) {
    setDragging(item);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item);
    if (ghost) e.dataTransfer.setDragImage(ghost, 10, 10);
  }
  const endDrag = () => {
    setDragging(null);
    setDrop(null);
  };

  function startResize(item: HeaderItem, e: ReactPointerEvent<HTMLSpanElement>) {
    e.preventDefault();
    e.stopPropagation();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    setSelected(item);
    setResizing(item);
    const x0 = e.clientX;
    const l = draftRef.current.layout;
    const start =
      item === "logo" ? l.logoWidth : item === "title" ? titleSizePx(l, titleText) : subSizePx(l, subText);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (item === "logo") setLayout({ logoWidth: Math.round(Math.min(LOGO_WIDTH_MAX, Math.max(LOGO_WIDTH_MIN, start + dx))) });
      if (item === "title") setLayout({ titleSize: Math.round(Math.min(TITLE_SIZE_MAX, Math.max(TITLE_SIZE_MIN, start + dx / 4))) });
      if (item === "sub")
        setLayout({ subSize: Math.round(Math.min(SUB_SIZE_MAX, Math.max(SUB_SIZE_MIN, start + dx / 10)) * 2) / 2 });
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      setResizing(null);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  }

  /* ---------- text shown in the header ---------- */
  const lockup = resolveLockup({ name: businessName, shortName: draft.shortName, lockupTagline: draft.tagline });
  const titleText = classic ? lockup.top : draft.shortName;
  const subText = classic ? lockup.bottom : draft.tagline;

  function renderItem(item: HeaderItem, content: ReactNode): ReactNode {
    // No logo: the app draws nothing in its place, so neither does the preview.
    if (item === "logo" && !logoUrl) return null;
    const l = draft.layout;
    let body = content;
    let size = "";
    if (item === "title") {
      size = `${titleSizePx(l, titleText)}px`;
      body = (
        <EditableText
          className="bh-title bs-ed"
          style={titleStyle(l, titleText)}
          value={titleText}
          placeholder="Short name"
          onChange={(v) => set({ shortName: v.replace(/\n/g, " ").trim() })}
        />
      );
    } else if (item === "sub") {
      size = `${subSizePx(l, subText)}px`;
      body = (
        <EditableText
          className="bh-sub bs-ed"
          style={subStyle(l, subText)}
          value={subText}
          placeholder="Subtitle"
          multiline
          onChange={(v) => set({ tagline: v })}
        />
      );
    } else {
      size = `${l.logoWidth}px`;
    }
    const cls = [
      "bs-blk",
      item === "logo" ? "is-logo" : "",
      selected === item ? "sel" : "",
      dragging === item ? "dragging" : "",
      drop && drop.target === item && drop.side ? `drop-${drop.side}` : "",
      resizing === item ? "resizing" : "",
    ]
      .filter(Boolean)
      .join(" ");
    return (
      <div
        className={cls}
        onPointerDown={() => setSelected(item)}
        onDragOver={(e) => {
          if (!dragging || dragging === item) return;
          e.preventDefault();
          e.stopPropagation();
          setDrop({ target: item, side: sideOf(e.currentTarget, e) });
        }}
        onDrop={(e) => {
          if (!dragging || dragging === item) return;
          e.preventDefault();
          e.stopPropagation();
          const side = sideOf(e.currentTarget, e);
          const moved = dragging;
          endDrag();
          setLayout({ tree: placeItem(draftRef.current.layout.tree, moved, item, side) });
          setSelected(moved);
        }}
      >
        <div className="bs-tools">
          <button
            type="button"
            className="bs-grip"
            draggable
            title="Drag to move"
            aria-label="Drag to move"
            onDragStart={(e) => startDrag(item, e, e.currentTarget.closest(".bs-blk"))}
            onDragEnd={endDrag}
          >
            ⠿
          </button>
          <button
            type="button"
            title="Hide"
            aria-label="Hide"
            onClick={(e) => {
              e.stopPropagation();
              setLayout({ tree: removeItem(draftRef.current.layout.tree, item) });
              setSelected(null);
            }}
          >
            ×
          </button>
        </div>
        {body}
        <span className="bs-edge" title="Drag to resize" onPointerDown={(e) => startResize(item, e)} />
        {resizing === item && <span className="bs-size">{size}</span>}
      </div>
    );
  }

  const shown = headerItems(draft.layout.tree);
  const hidden: { id: HeaderItem; label: string }[] = [];
  if (logoUrl && !shown.includes("logo")) hidden.push({ id: "logo", label: "Logo" });
  if (!shown.includes("title")) hidden.push({ id: "title", label: "Title" });
  if (!shown.includes("sub")) hidden.push({ id: "sub", label: "Subtitle" });
  const preset = matchingPreset(draft.layout.tree);
  const empty = shown.filter((i) => i !== "logo" || logoUrl).length === 0;

  /* ---------- tab preview: the very icon the app will build ---------- */
  const monogram = classic
    ? undefined
    : !logoUrl || draft.layout.logoShape === "wide"
      ? monogramFor(draft.shortName, code, businessName) || undefined
      : undefined;
  const [favicon, setFavicon] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void buildFavicon({ logoUrl, brandColor: colors.brand, name: draft.shortName || businessName, monogram }).then(
      (icon) => live && setFavicon(icon)
    );
    return () => {
      live = false;
    };
  }, [logoUrl, colors.brand, draft.shortName, businessName, monogram]);

  /* ---------- colour picker ---------- */
  const rootRef = useRef<HTMLDivElement>(null);
  function openPicker(key: ColorKey, anchor: HTMLElement) {
    const root = rootRef.current?.getBoundingClientRect();
    const a = anchor.getBoundingClientRect();
    if (!root) return;
    setPicker({
      key,
      left: Math.max(8, Math.min(a.left - root.left, root.width - 240)),
      top: Math.max(8, Math.min(a.bottom - root.top + 6, root.height - 330)),
    });
  }
  const resolvedOf: Record<ColorKey, string> = {
    color: colors.brand,
    secondaryColor: colors.nav,
    onBrandTextColor: colors.onBrand,
    navTextColor: colors.navFg,
  };
  const isAuto = (k: ColorKey) => k !== "color" && !draft[k];

  const priRatio = hexContrast(colors.onBrand, colors.brand);
  const secRatio = hexContrast(colors.navFg, colors.nav);

  return (
    <div className="bs" ref={rootRef}>
      {/* ------------------------------ settings ------------------------------ */}
      <div className="bs-panel">
        <section>
          <p className="bs-grp-h">Logo</p>
          <div className="bs-logo">
            <div className="bs-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {logoUrl && <img src={logoUrl} alt="" />}
            </div>
            <div className="bs-logo-meta">
              <b>{logoName || "No logo"}</b>
              <small>PNG, JPG or WebP{isCreate && logoUrl ? " · uploaded on create" : ""}</small>
            </div>
            <label className="bs-ibtn">
              {logoUrl ? "Replace" : "Upload"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) pickLogo(f);
                  e.target.value = "";
                }}
              />
            </label>
            {logoUrl && (
              <button type="button" className="bs-x" title="Remove logo" aria-label="Remove logo" onClick={removeLogo}>
                ×
              </button>
            )}
          </div>
          <div className="bs-line" style={{ marginTop: 10 }}>
            <span>Shape</span>
            <Seg
              value={draft.layout.logoShape}
              options={[
                ["square", "Square"],
                ["wide", "Wide"],
              ]}
              onChange={(v) => setShape(v as HeaderLayout["logoShape"])}
            />
          </div>
          <div className="bs-line">
            <span>Backing</span>
            <Seg
              value={draft.logoDisplay || "transparent"}
              options={[
                ["transparent", "None"],
                ["light-pad", "Light"],
                ["dark-pad", "Dark"],
              ]}
              onChange={(v) => set({ logoDisplay: v })}
            />
          </div>
        </section>

        <section>
          <p className="bs-grp-h">Colours</p>
          <ColorRow
            name="Primary"
            hint="buttons, links"
            bg={colors.brand}
            fg={colors.onBrand}
            bgLabel={colors.brand.toUpperCase()}
            fgLabel={draft.onBrandTextColor ? colors.onBrand.toUpperCase() : "Auto"}
            ratio={priRatio}
            onPickBg={(el) => openPicker("color", el)}
            onPickFg={(el) => openPicker("onBrandTextColor", el)}
            onFix={() => set({ onBrandTextColor: "" })}
          />
          <ColorRow
            name="Secondary"
            hint="sidebar, sign-in"
            bg={colors.nav}
            fg={colors.navFg}
            bgLabel={draft.secondaryColor ? colors.nav.toUpperCase() : "Auto"}
            fgLabel={draft.navTextColor ? colors.navFg.toUpperCase() : "Auto"}
            ratio={secRatio}
            onPickBg={(el) => openPicker("secondaryColor", el)}
            onPickFg={(el) => openPicker("navTextColor", el)}
            onFix={() => set({ navTextColor: "" })}
          />
          <p className="bs-note">Click any colour to pick it or type a hex code. Text is automatic until you change it.</p>
        </section>

        <section>
          <p className="bs-grp-h">
            Header {preset === null && <em>Custom</em>}
          </p>
          <div className="bs-layouts">
            {LAYOUT_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="bs-lay"
                aria-pressed={preset === p.id}
                onClick={() => setLayout({ tree: presetLayoutTree(p.id, headerItems(draftRef.current.layout.tree)) })}
              >
                <PresetIcon id={p.id} />
                {p.label}
              </button>
            ))}
          </div>
          <div className="bs-line" style={{ marginTop: 10 }}>
            <span>Align</span>
            <Seg
              value={draft.layout.align}
              options={[
                ["start", "Left"],
                ["center", "Center"],
                ["spread", "Spread"],
              ]}
              onChange={(v) => setLayout({ align: v as HeaderAlign })}
            />
          </div>
          <div className="bs-line">
            <span>Spacing</span>
            <Seg
              value={draft.layout.pad}
              options={[
                ["compact", "S"],
                ["normal", "M"],
                ["roomy", "L"],
              ]}
              onChange={(v) => setLayout({ pad: v as HeaderPad })}
            />
          </div>
          <p className="bs-note">Pick a starting layout, then fine-tune by dragging in the preview.</p>
        </section>

        <section>
          <p className="bs-grp-h">Typography</p>
          <div className="bs-line">
            <span>Font</span>
            <Seg
              value={draft.fontFamily}
              options={Object.keys(FONT_FAMILIES).map((k) => [k, titleCase(k)] as [string, string])}
              onChange={(v) => set({ fontFamily: v })}
            />
          </div>
          <div className="bs-line">
            <span>Text size</span>
            <Seg
              value={draft.fontScale}
              options={Object.keys(FONT_SCALES).map((k) => [k, titleCase(k)] as [string, string])}
              onChange={(v) => set({ fontScale: v })}
            />
          </div>
        </section>
      </div>

      {/* ------------------------------ preview ------------------------------ */}
      <div
        ref={canvasRef}
        className={`bs-canvas ${previewDisplayFont.variable} ${previewSansFont.variable} ${previewLoraFont.variable} ${previewPoppinsFont.variable}${previewActive ? " active" : ""}`}
        style={
          {
            ...brandPreviewVars(theme),
            /* The two variables the app sets on the page (app.css body) for the
             * business's font and text size, so the preview follows them too. */
            "--brand-font-family": FONT_FAMILIES[draft.fontFamily] ?? FONT_FAMILIES[DEFAULT_FONT_FAMILY],
            "--brand-font-scale": String(FONT_SCALES[draft.fontScale] ?? FONT_SCALES[DEFAULT_FONT_SCALE]),
          } as CSSProperties
        }
      >
        <div className="bs-bar">
          <div className="bs-tab">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {favicon ? <img src={favicon} alt="" /> : <span className="bs-tab-blank" />}
            <span>{(draft.shortName.trim() || businessName || "Business") + " · Dashboard"}</span>
          </div>
          <div className="bs-hist">
            <button type="button" title="Undo (Ctrl+Z)" aria-label="Undo" disabled={histCounts.undo === 0} onClick={undo}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            </button>
            <button type="button" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled={histCounts.redo === 0} onClick={redo}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m15 14 5-5-5-5" />
                <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
              </svg>
            </button>
          </div>
        </div>

        <aside className="bs-rail">
          {/* Dropping on empty header space puts the item on its own line at the
            * bottom; drops onto an item are handled (and stopped) by that item. */}
          <div
            className="bs-head"
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              setDrop({ target: "end" });
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
            }}
            onDrop={(e) => {
              if (!dragging) return;
              e.preventDefault();
              const moved = dragging;
              endDrag();
              setLayout({ tree: appendItem(draftRef.current.layout.tree, moved) });
              setSelected(moved);
            }}
          >
          <BrandHeader
            layout={draft.layout}
            logoUrl={logoUrl}
            logoDisplay={draft.logoDisplay}
            title={titleText}
            subtitle={subText}
            logoAlt={businessName}
            showEmpty
            renderItem={renderItem}
            className={`${drop?.target === "end" ? "bs-drop-end" : ""}${empty ? " bs-empty" : ""}`}
          />
          </div>
          <nav className="bs-nav" aria-hidden>
            <div className="bs-nav-grp">Overview</div>
            <div className="bs-nav-a on">
              <NavIcon d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />
              Dashboard
            </div>
            <div className="bs-nav-a">
              <NavIcon d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
              Reports
            </div>
            <div className="bs-nav-a">
              <NavIcon d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              Loans
            </div>
            <div className="bs-nav-btn">+ New Gold Loan</div>
          </nav>
        </aside>

        {/* Running text on a page: what Font and Text size change most. */}
        <div className="bs-page" aria-hidden>
          <b>Loan GL-2026-00418</b>
          <span>Principal ₹1,25,000 · 32.40 g gold · due 14 Nov 2026</span>
        </div>

        <div className="bs-hidden">
          {hidden.length > 0 && <span>Hidden, drag back in:</span>}
          {hidden.map((h) => (
            <button
              key={h.id}
              type="button"
              className="bs-add"
              draggable
              onDragStart={(e) => startDrag(h.id, e, null)}
              onDragEnd={endDrag}
              onClick={() => {
                setLayout({ tree: appendItem(draftRef.current.layout.tree, h.id) });
                setSelected(h.id);
              }}
            >
              ⠿ {h.label}
            </button>
          ))}
        </div>
        <p className="bs-tip">
          Drag ⠿ onto any side of another item. Drag the right edge to resize. Click text to type. × hides. Ctrl+Z
          undoes, Ctrl+Shift+Z redoes.
        </p>
      </div>

      {picker && (
        <ColorPopover
          key={picker.key}
          title={COLOR_PICKER[picker.key].title}
          autoLabel={COLOR_PICKER[picker.key].auto}
          isAuto={isAuto(picker.key)}
          value={resolvedOf[picker.key]}
          swatches={[
            ...(picker.key === "onBrandTextColor" || picker.key === "navTextColor"
              ? [...TEXT_SWATCHES, colors.brand]
              : [...palette, ...BG_SWATCHES]),
          ].filter((c, i, all) => all.indexOf(c) === i)}
          style={{ top: picker.top, left: picker.left }}
          onPick={(hex) => set({ [picker.key]: hex.toLowerCase() } as Partial<BrandingDraft>)}
          onAuto={() => set({ [picker.key]: "" } as Partial<BrandingDraft>)}
          onClose={() => setPicker(null)}
        />
      )}

      <div className={`bs-toast${toast ? " show" : ""}`} role="status">
        {toast}
      </div>
    </div>
  );
}
