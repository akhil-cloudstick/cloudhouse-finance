import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

// Direct port of frontend/lib/icons.tsx (itself ported from legacy/app.js's
// icon(n)) — same names, same `d` strings, same viewBox/stroke settings, so
// the mobile app draws the exact glyphs the web admin UI draws. Keep the two
// files in sync; do not add glyphs here that the web set doesn't have.
//
// The web version leans on `stroke="currentColor"` and CSS sizing; RN has
// neither, so stroke/size come in as props instead.
const PATHS: Record<string, React.ReactNode> = {
  coin: (
    <>
      <Circle cx="12" cy="12" r="8" />
      <Path d="M12 8v8M9.5 10c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.4-2.5 1.7-2.5.7-2.5 1.7 1 1.7 2.5 1.7 2.5-.7 2.5-1.7" />
    </>
  ),
  plus: <Path d="M12 5v14M5 12h14" />,
  download: <Path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  mail: (
    <>
      <Rect x="3" y="5" width="18" height="14" rx="2.5" />
      <Path d="m4 7 8 6 8-6" />
    </>
  ),
  check: <Path d="M4 12.5 9.5 18 20 6.5" />,
  search: (
    <>
      <Circle cx="11" cy="11" r="7" />
      <Path d="m20 20-3.8-3.8" />
    </>
  ),
  bell: (
    <>
      <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <Path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  clock: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7.5V12l3 2.5" />
    </>
  ),
  unlock: (
    <>
      <Rect x="5" y="11" width="14" height="9" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 7.8-1.3" />
    </>
  ),
  stamp: <Path d="M6 20h12M9 14c-2.5 0-4 1-4 3h14c0-2-1.5-3-4-3l-1-6.5a2.5 2.5 0 0 0-4 0Z" />,
  gavel: <Path d="m9 7 6 6M12 4l6 6M3 21h9M7.5 8.5 12 4l6 6-4.5 4.5zM14 13l6 6" />,
  shield: <Path d="M12 3 5 6v5c0 5 3.5 8.5 7 10 3.5-1.5 7-5 7-10V6Z" />,
  doc: (
    <>
      <Path d="M7 3h7l4 4v14H7z" />
      <Path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  chat: <Path d="M4 5h16v11H8l-4 4z" />,
  phone: <Path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a1.5 1.5 0 0 1-1.7 1.5C10 19.7 4.3 14 3.5 5.7A1.5 1.5 0 0 1 5 4Z" />,
  scan: <Path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M4 12h16" />,
  lock: (
    <>
      <Rect x="5" y="11" width="14" height="9" rx="2" />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  bank: <Path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" />,
  scale: <Path d="M12 4v16M6 7l-3 6a3.5 3.5 0 0 0 6 0zM18 7l-3 6a3.5 3.5 0 0 0 6 0zM7 4h10M9 20h6" />,
  user: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  home: <Path d="m3 11 9-7 9 7v9h-6v-6h-6v6H3z" />,
  list: <Path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  // Banknote — the Loans tab. `list` (its old glyph) says "a table of rows",
  // which every other listing screen is too; this says money lent.
  note: (
    <>
      <Rect x="2.5" y="6" width="19" height="12" rx="2" />
      <Circle cx="12" cy="12" r="2.2" />
      <Path d="M6 12h.01M18 12h.01" />
    </>
  ),
  chart: <Path d="M4 20V4M4 20h16M8 16v-5M13 16V8M18 16v-8" />,
  cal: (
    <>
      <Rect x="4" y="5" width="16" height="16" rx="2" />
      <Path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  box: (
    <>
      <Path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <Path d="M4 7.5 12 12l8-4.5M12 12v9" />
    </>
  ),
  eye: (
    <>
      <Path d="M2 12s3.8-7 10-7 10 7 10 7-3.8 7-10 7-10-7-10-7Z" />
      <Circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <Path d="M3 3l18 18" />
      <Path d="M10.6 5.2A10.6 10.6 0 0 1 12 5c6.2 0 10 7 10 7a17.6 17.6 0 0 1-4 4.7M6.4 6.4A17.7 17.7 0 0 0 2 12s3.8 7 10 7a10.3 10.3 0 0 0 4.2-.9" />
      <Path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  warning: (
    <>
      <Path d="M12 3 2.5 20h19z" />
      <Path d="M12 9.5v5M12 17.5h.01" />
    </>
  ),
  gear: (
    <>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9c.2.4.6.8 1 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  // --- additions beyond the web set, same stroke conventions ---
  // The web sidebar needs neither: it has no nested stacks (so no back
  // affordance) and no overflow menu (the whole nav is always on screen).
  chevronLeft: <Path d="m15 5-7 7 7 7" />,
  dots: (
    <>
      <Circle cx="5" cy="12" r="1.4" />
      <Circle cx="12" cy="12" r="1.4" />
      <Circle cx="19" cy="12" r="1.4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = 1.7,
}: {
  name: string;
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name] ?? PATHS.doc}
    </Svg>
  );
}
