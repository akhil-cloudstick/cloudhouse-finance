# Console kit — the one super admin design

This folder is the **master copy** of the super admin UI shared by every product console:

| Where | Path |
| --- | --- |
| ERP (master) | `Project-Management-System/src/modules/software-console/kit/` |
| Gold Finance's own super admin | `gold-app/frontend/modules/superadmin/kit/` |
| CloudHouse POS's own super admin | `pos-application/src/modules/superadmin/kit/` |

## Rules

1. **Change it here first**, then copy the whole folder to the two products. The three folders must stay
   byte-identical: `diff -r` between any two shows nothing.
2. Files inside the kit import each other with **relative paths only** (`./`, `../`) — never an app alias
   such as `@/…` — so the same file works in every app.
3. **No data calls** in the kit. A product passes its data and actions in through props (or a small adapter
   in its own folder, e.g. `toCards` for build progress).
4. Styles use the console's `sa-` classes and `--sa-*` variables only (no Tailwind), so the kit looks the same
   in the ERP (React 18, Vite), Gold Finance (React 19, Next) and POS (React 19, Vite).
5. A new product console uses these components as they are; it adds only its own fields and services.

## What is here

- `components/RebuildModal.tsx`, `BuildFields.tsx` (Build for, Version), `BuildProgress.tsx` — desktop builds.
- `components/DesktopVersions.tsx` — a business's Desktop app card with "View all versions" by OS.
- `components/WizardFrame.tsx`, `BrandingStep.tsx` and the small parts (`ReasonField`, `ReviewRow`, `Stat`,
  `GrantChips`, `Seg`, `Select`, `EditableText`, `Color*`, `PresetIcon`, `NavIcon`, `SuperAdminIcon`,
  `DevToolsPinModal`).
- `common/` — header layout, theme, brand lockup, OS names and version helpers (`desktopOs.tsx`).
- `styles/` — `superadmin.css` (the console), `desktop.css`, `branding-step.css`, `brand-header.css`, `fonts.css`.
