import type { ReactNode } from "react";
import type { IconName } from "../types/dashboard-types";

/* Inline SVGs rather than an icon package: 24x24 stroke icons on currentColor, so they take the colour
 * of whatever row they sit in. The one icon set of every console. */
const PATHS: Record<IconName, ReactNode> = {
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
	tag: (
		<>
			<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
			<circle cx="7.5" cy="7.5" r="1.5" />
		</>
	),
	mail: (
		<>
			<rect x="3" y="5" width="18" height="14" rx="2" />
			<path d="m3 7 9 6 9-6" />
		</>
	),
	lock: (
		<>
			<rect x="4" y="11" width="16" height="10" rx="2" />
			<path d="M8 11V7a4 4 0 0 1 8 0v4" />
		</>
	),
	eye: (
		<>
			<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
			<circle cx="12" cy="12" r="3" />
		</>
	),
	eyeOff: (
		<>
			<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
			<path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
		</>
	),
	menu: <path d="M4 6h16M4 12h16M4 18h16" />,
}

// The console's own line icons (gold-app superadmin set), drawn at the size the .sa-* rules give .sa-icon.

export function SuperAdminIcon({ name, className = "sa-icon" }: { name: IconName; className?: string | undefined }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
