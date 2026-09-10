import type { Metadata, Viewport } from "next";
import { Montserrat, Inter } from "next/font/google";
import "./globals.css";
import "./app/app.css";
import { AuthProvider } from "@/common/auth-context";
import { BrandingProvider } from "@/common/BrandingProvider";
import { BrandPreload } from "./brand-preload";
import { BRAND } from "@/common/config/brand";

/* Montserrat carries the CloudHouse wordmark's voice — bold, geometric, tightly
 * tracked — so it takes the display role that Bodoni Moda used to hold.
 * Bodoni was dropped outright: its thick/thin contrast belonged to the old
 * jewellery brand, and mobile had already aliased it away as unreadable at
 * phone size (see mobile/src/theme/typography.ts).
 *
 * Unlike the fonts they replace, these are consumed through their CSS
 * variables — app.css and login.css reference var(--font-sans)/(--font-display)
 * rather than a hardcoded family string. The old --font-jost/--font-bodoni-moda
 * variables were declared here but never actually referenced by any rule,
 * which is how the stylesheets and this file were free to drift apart. */
const inter = Inter({
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

const montserrat = Montserrat({
  variable: "--font-display",
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // Short form in the tab: the full legal name truncates to nothing useful
  // at typical tab widths.
  title: BRAND.shortName,
  description: BRAND.legalName,
  icons: {
    icon: BRAND.markSrc,
  },
};

// Without this, mobile browsers render at a default ~980px desktop-width
// viewport and shrink the whole page to fit the screen instead of actually
// laying it out at the device's real width — so none of app.css's
// max-width:900px/480px mobile media queries ever match on a phone.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    /* suppressHydrationWarning is required, not cosmetic, and applies to THIS
     * element only (it does not cascade to children).
     *
     * BrandPreload below runs before React hydrates and writes the brand ramp
     * onto document.documentElement.style — that is its whole purpose, since a
     * static export has no server render to inject the colour into. So by the
     * time React arrives, <html> carries a style attribute the server-rendered
     * markup never had, and React reports the mismatch.
     *
     * The alternative — rendering the style server-side — is impossible here:
     * the colour depends on which business the visitor belongs to, which is
     * only known in the browser (localStorage, keyed by slug). Suppressing on
     * the one element we deliberately mutate is the narrowest correct fix. */
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${montserrat.variable}`}>
      <head>
        {/* Ahead of everything: paints the business's own brand colour
            before the first frame. See BrandPreload for why a static
            export leaves no other place to do this. */}
        <BrandPreload />
      </head>
      <body>
        {/* BrandingProvider wraps AuthProvider: the sign-in page itself needs
            the business's logo and colour, and that is rendered before any
            session exists. */}
        <BrandingProvider>
          <AuthProvider>{children}</AuthProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
