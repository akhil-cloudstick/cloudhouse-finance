import type { Metadata } from "next";
import { DesktopContextMenu } from "@/common/components/DesktopContextMenu";

/* Deliberately minimal — no next/font, no shared shell with the tenant app.
 * This is a separate deployable app on its own origin (see the repo root's
 * documents/multitenancy_plan.md): it must never inherit anything the
 * tenant app's layout decides, including its font loading or its
 * BrandingProvider (a tenant's branding has no business appearing here). */
export const metadata: Metadata = {
  title: "CloudHouse Superadmin",
  description: "Manage every business on this deployment.",
  icons: { icon: "/cloudhouse-mark.png" },
};

type SuperAdminRootLayoutProps = { children: React.ReactNode };

export default function SuperAdminRootLayout({ children }: SuperAdminRootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <DesktopContextMenu />
        {children}
      </body>
    </html>
  );
}
