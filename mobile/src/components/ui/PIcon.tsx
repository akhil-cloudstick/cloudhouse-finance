import React from "react";
import Svg, { Circle, Line, Path, Polygon, Polyline, Rect } from "react-native-svg";

// Exact port of the ICONS map in ui-demos/staff-app-prototype.html — same
// paths, default sizes and stroke widths, so every glyph matches the design.
type Def = { size: number; stroke?: number; fill?: boolean; body: React.ReactNode };

const DEFS: Record<string, Def> = {
  search: { size: 17, stroke: 2, body: <><Circle cx="11" cy="11" r="7" /><Line x1="21" y1="21" x2="16.65" y2="16.65" /></> },
  bell: { size: 17, stroke: 2, body: <><Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><Path d="M13.73 21a2 2 0 0 1-3.46 0" /></> },
  dots: { size: 17, fill: true, body: <><Circle cx="5" cy="12" r="1.6" /><Circle cx="12" cy="12" r="1.6" /><Circle cx="19" cy="12" r="1.6" /></> },
  home: { size: 19, stroke: 2, body: <><Path d="M3 11l9-8 9 8" /><Path d="M5 10v10h14V10" /></> },
  note: { size: 19, stroke: 2, body: <><Path d="M7 3h8l4 4v14H7z" /><Path d="M14 3v5h5" /><Path d="M9 13h6M9 17h6" /></> },
  user: { size: 22, stroke: 2, body: <><Circle cx="12" cy="8" r="4" /><Path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></> },
  plus: { size: 20, stroke: 2.4, body: <><Line x1="12" y1="5" x2="12" y2="19" /><Line x1="5" y1="12" x2="19" y2="12" /></> },
  chevron: { size: 15, stroke: 2.4, body: <Polyline points="9 6 15 12 9 18" /> },
  chevdown: { size: 13, stroke: 2.6, body: <Polyline points="6 9 12 15 18 9" /> },
  chevright: { size: 15, stroke: 2.4, body: <Polyline points="9 6 15 12 9 18" /> },
  card: { size: 18, stroke: 2, body: <><Rect x="2" y="5" width="20" height="14" rx="2.5" /><Line x1="2" y1="10" x2="22" y2="10" /></> },
  back: { size: 17, stroke: 2.4, body: <Polyline points="15 18 9 12 15 6" /> },
  share: { size: 17, stroke: 2, body: <><Circle cx="18" cy="5" r="3" /><Circle cx="6" cy="12" r="3" /><Circle cx="18" cy="19" r="3" /><Line x1="8.6" y1="10.5" x2="15.4" y2="6.5" /><Line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /></> },
  doc: { size: 18, stroke: 2, body: <><Path d="M7 3h8l4 4v14H7z" /><Path d="M14 3v5h5" /><Path d="M9 13h6M9 17h6" /></> },
  download: { size: 19, stroke: 2.2, body: <><Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><Polyline points="7 10 12 15 17 10" /><Line x1="12" y1="15" x2="12" y2="3" /></> },
  bolt: { size: 18, stroke: 2, body: <Polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /> },
  calendar: { size: 18, stroke: 2, body: <><Rect x="3" y="5" width="18" height="16" rx="2" /><Line x1="16" y1="3" x2="16" y2="7" /><Line x1="8" y1="3" x2="8" y2="7" /><Line x1="3" y1="10" x2="21" y2="10" /></> },
  coin: { size: 18, stroke: 2, body: <><Circle cx="12" cy="12" r="9" /><Path d="M9 9h3.5a1.8 1.8 0 1 1 0 3.5H9m0 0h3.8a1.9 1.9 0 1 1 0 3.5H9M11 7v10" /></> },
  check: { size: 18, stroke: 2.2, body: <Polyline points="20 6 9 17 4 12" /> },
  edit: { size: 18, stroke: 2, body: <><Path d="M12 20h9" /><Path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></> },
  transfer: { size: 18, stroke: 2, body: <><Polyline points="17 1 21 5 17 9" /><Path d="M3 11V9a4 4 0 0 1 4-4h14" /><Polyline points="7 23 3 19 7 15" /><Path d="M21 13v2a4 4 0 0 1-4 4H3" /></> },
  alert: { size: 18, stroke: 2, body: <><Path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" /><Line x1="12" y1="9" x2="12" y2="13" /><Line x1="12" y1="17" x2="12.01" y2="17" /></> },
  layers: { size: 19, stroke: 2, body: <><Polygon points="12 2 2 7 12 12 22 7 12 2" /><Polyline points="2 17 12 22 22 17" /><Polyline points="2 12 12 17 22 12" /></> },
  // Not in the prototype's map, used by screens the prototype doesn't draw
  // (admin modules, QR packet lookup) — same stroke language.
  shield: { size: 18, stroke: 2, body: <Path d="M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6Z" /> },
  gear: { size: 18, stroke: 2, body: <><Circle cx="12" cy="12" r="3" /><Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></> },
  scan: { size: 18, stroke: 2, body: <Path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16" /> },
  chart: { size: 18, stroke: 2, body: <Path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8" /> },
  gavel: {
    size: 18,
    stroke: 2,
    body: <><Path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" /><Path d="m16 16 6-6" /><Path d="m8 8 6-6" /><Path d="m9 7 8 8" /><Path d="m21 11-8-8" /></>,
  },
  logout: { size: 18, stroke: 2, body: <><Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><Polyline points="16 17 21 12 16 7" /><Line x1="21" y1="12" x2="9" y2="12" /></> },
  close: { size: 16, stroke: 2.4, body: <><Line x1="18" y1="6" x2="6" y2="18" /><Line x1="6" y1="6" x2="18" y2="18" /></> },
};

export type PIconName = keyof typeof DEFS;

export function PIcon({ name, color, size, strokeWidth }: { name: PIconName | string; color: string; size?: number; strokeWidth?: number }) {
  const def = DEFS[name as string];
  if (!def) return null;
  const s = size ?? def.size;
  return (
    <Svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={def.fill ? color : "none"}
      stroke={def.fill ? "none" : color}
      strokeWidth={strokeWidth ?? def.stroke ?? 2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {def.body}
    </Svg>
  );
}
