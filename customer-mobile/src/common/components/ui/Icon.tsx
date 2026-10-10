import React from "react";
import Svg, { Circle, Path, Rect } from "react-native-svg";

// Trimmed port of mobile/src/common/components/ui/Icon.tsx (itself ported from
// frontend/lib/icons.tsx) — only the glyphs this app's Batch 1 nav/screens
// need. Keep `d` strings identical to the source files if adding more later.
const PATHS: Record<string, React.ReactNode> = {
  home: <Path d="m3 11 9-7 9 7v9h-6v-6h-6v6H3z" />,
  note: (
    <>
      <Rect x="2.5" y="6" width="19" height="12" rx="2" />
      <Circle cx="12" cy="12" r="2.2" />
      <Path d="M6 12h.01M18 12h.01" />
    </>
  ),
  coin: (
    <>
      <Circle cx="12" cy="12" r="8" />
      <Path d="M12 8v8M9.5 10c0-1 1-1.7 2.5-1.7s2.5.7 2.5 1.7-1 1.4-2.5 1.7-2.5.7-2.5 1.7 1 1.7 2.5 1.7 2.5-.7 2.5-1.7" />
    </>
  ),
  doc: (
    <>
      <Path d="M7 3h7l4 4v14H7z" />
      <Path d="M14 3v4h4M10 12h5M10 16h5" />
    </>
  ),
  dots: (
    <>
      <Circle cx="5" cy="12" r="1.4" />
      <Circle cx="12" cy="12" r="1.4" />
      <Circle cx="19" cy="12" r="1.4" />
    </>
  ),
  bell: (
    <>
      <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <Path d="M10 19a2 2 0 0 0 4 0" />
    </>
  ),
  user: (
    <>
      <Circle cx="12" cy="8" r="4" />
      <Path d="M4 20c0-4 3.6-6.5 8-6.5s8 2.5 8 6.5" />
    </>
  ),
  chevronLeft: <Path d="m15 5-7 7 7 7" />,
  clock: (
    <>
      <Circle cx="12" cy="12" r="8.5" />
      <Path d="M12 7.5V12l3 2.5" />
    </>
  ),
  // Ornament/gold — a stylized bangle/coin glyph for Pledged Gold rows.
  ornament: (
    <>
      <Circle cx="12" cy="12" r="7.5" />
      <Circle cx="12" cy="12" r="3.2" />
    </>
  ),
  // Extension/clock-forward — a clock with a forward arrow, for the Request
  // Extension action.
  extension: (
    <>
      <Circle cx="11" cy="13" r="7.5" />
      <Path d="M11 8.5V13l2.5 2" />
      <Path d="M16.5 3.5 19 6l-2.5 2.5M19 6h-5" />
    </>
  ),
  // Release/unlock — an open shackle padlock, for the Request Release action.
  release: (
    <>
      <Rect x="5" y="11" width="12" height="9" rx="2" />
      <Path d="M8 11V8a4 4 0 0 1 7.5-2" />
      <Circle cx="11" cy="15.5" r="1.4" />
    </>
  ),
  // Logout/exit — a door with an arrow pointing out, for the Dashboard's
  // logout action (Batch 3).
  logout: (
    <>
      <Path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3" />
      <Path d="M15 16l4-4-4-4" />
      <Path d="M19 12H9" />
    </>
  ),
  // Shield/verified badge — for the KYC Verification card on the Profile
  // screen (Batch 4), covers both the overall status and the Aadhaar row
  // (PAN reuses the existing "doc" glyph).
  shield: (
    <>
      <Path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
      <Path d="M9 12l2 2 4-4" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

type IconProps = {
  name: string;
  size?: number;
  color: string;
  strokeWidth?: number;
};

export function Icon({
  name,
  size = 22,
  color,
  strokeWidth = 1.7,
}: IconProps) {
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
