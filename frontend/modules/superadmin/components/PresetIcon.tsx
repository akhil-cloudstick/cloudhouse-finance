"use client";

import { type ReactNode } from "react";
import { type LayoutPreset } from "@/common/config/headerLayout";

type PresetIconProps = { id: LayoutPreset };

export function PresetIcon({ id }: PresetIconProps) {
  const rects: Record<LayoutPreset, ReactNode> = {
    side: (
      <>
        <rect x="2" y="7" width="12" height="12" rx="3" fill="currentColor" opacity=".55" />
        <rect x="18" y="8" width="20" height="5" rx="2" fill="currentColor" />
        <rect x="18" y="16" width="14" height="3" rx="1.5" fill="currentColor" opacity=".5" />
      </>
    ),
    stack: (
      <>
        <rect x="2" y="2" width="10" height="10" rx="3" fill="currentColor" opacity=".55" />
        <rect x="2" y="15" width="22" height="5" rx="2" fill="currentColor" />
        <rect x="2" y="22" width="15" height="2.5" rx="1.2" fill="currentColor" opacity=".5" />
      </>
    ),
    split: (
      <>
        <rect x="2" y="2" width="10" height="10" rx="3" fill="currentColor" opacity=".55" />
        <rect x="2" y="16" width="16" height="7" rx="2" fill="currentColor" />
        <rect x="22" y="18" width="18" height="3" rx="1.5" fill="currentColor" opacity=".5" />
      </>
    ),
    inline: (
      <>
        <rect x="2" y="8" width="10" height="10" rx="3" fill="currentColor" opacity=".55" />
        <rect x="15" y="9" width="12" height="7" rx="2" fill="currentColor" />
        <rect x="30" y="11" width="12" height="3" rx="1.5" fill="currentColor" opacity=".5" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 44 26" aria-hidden>
      {rects[id]}
    </svg>
  );
}
