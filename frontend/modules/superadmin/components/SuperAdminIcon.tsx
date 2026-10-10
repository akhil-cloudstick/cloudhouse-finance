"use client";

import { IconName } from "@/modules/superadmin/types/dashboard-types";

type SuperAdminIconProps = { name: IconName };

/* Inline SVGs rather than an icon package. This console's dependencies are
 * next + react and nothing else, deliberately, and six glyphs do not justify
 * changing that. All are 24x24 stroke icons on currentColor so they take the
 * colour of whatever row they sit in. */
export function SuperAdminIcon({ name }: SuperAdminIconProps) {
  const paths: Record<IconName, React.ReactNode> = {
    building: (
      <>
        <path d="M3 21h18M5 21V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16M13 21V9h5a1 1 0 0 1 1 1v11" />
        <path d="M8 8h2M8 12h2M8 16h2M16 13h1M16 17h1" />
      </>
    ),
    layers: (
      <>
        <path d="M12 3 3 8l9 5 9-5-9-5Z" />
        <path d="m3 13 9 5 9-5M3 18l9 5 9-5" />
      </>
    ),
    clipboard: (
      <>
        <path d="M9 4h6v3H9zM9 5H7a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2" />
        <path d="M9 12h6M9 16h4" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
        <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </>
    ),
    copy: (
      <>
        <rect x="9" y="9" width="11" height="11" rx="1.5" />
        <path d="M6 15H5a1.5 1.5 0 0 1-1.5-1.5V5A1.5 1.5 0 0 1 5 3.5h8.5A1.5 1.5 0 0 1 15 5v1" />
      </>
    ),
    external: (
      <>
        <path d="M14 4h6v6M20 4 11 13" />
        <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
      </>
    ),
  };
  return (
    <svg
      className="sa-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
