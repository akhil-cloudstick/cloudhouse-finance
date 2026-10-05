import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "@/product/styles/app.css";
import { AuthProvider } from "@/product/providers/auth-context";
import { DesktopTitleBar } from "@/product/components/DesktopTitleBar";
import { DESKTOP_RUNTIME_LOADER } from "@/product/services/desktopBridge";
import { BrandingProvider } from "@/product/providers/BrandingProvider";
import { BrandPreload } from "./brand-preload";
import { NEUTRAL_DOCUMENT_TITLE } from "@/product/config/theme";

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
/* Self-hosted (next/font/local) rather than next/font/google: the frontend
 * build container's network has no outbound internet access, so a build-time
 * fetch to fonts.googleapis.com fails. Both files are the same Google Fonts
 * variable-font woff2s (latin subset), just vendored into the repo. */
const inter = localFont({
  src: "./fonts/Inter-Variable-latin.woff2",
  variable: "--font-sans",
  weight: "400 700",
  display: "swap",
});

const montserrat = localFont({
  src: "./fonts/Montserrat-Variable-latin.woff2",
  variable: "--font-display",
  weight: "600 800",
  display: "swap",
});

/* DELIBERATELY UNBRANDED.
 *
 * next.config.ts sets output: "export", so whatever is written here is baked
 * into the HTML of every page for every business. It used to be the platform
 * name and mark, which meant each business's own staff saw CloudHouse in the
 * tab and on the tab icon for the first frames of every cold load, before
 * BrandingProvider's fetch could replace them. A business must only ever see
 * its own identity — showing the vendor's, or any other tenant's, even for a
 * few hundred milliseconds is not allowed.
 *
 * So the baked values are neutral: a "Loading…" tab and an empty icon. The
 * business's real name and logo are installed before the first paint by
 * app/brand-preload.tsx from the per-slug cache, and again by applyFavicon /
 * applyDocumentTitle once branding loads. Only a browser that has never seen
 * this business before sees the neutral pair, and only until the first
 * response arrives.
 */
export const metadata: Metadata = {
  title: NEUTRAL_DOCUMENT_TITLE,
  icons: {
    icon: "/blank-icon.svg",
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
        {/* Last in <head>: the scripts it writes sit after every node React hydrates. */}
        <script dangerouslySetInnerHTML={{ __html: DESKTOP_RUNTIME_LOADER }} />
      </head>
      <body>
        {/* BrandingProvider wraps AuthProvider: the sign-in page itself needs
            the business's logo and colour, and that is rendered before any
            session exists. */}
        <BrandingProvider>
          <DesktopTitleBar />
          <AuthProvider>{children}</AuthProvider>
        </BrandingProvider>
      </body>
    </html>
  );
}
