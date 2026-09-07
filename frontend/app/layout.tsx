import type { Metadata, Viewport } from "next";
import { Montserrat, Inter } from "next/font/google";
import "./globals.css";
import "./app/app.css";
import { AuthProvider } from "@/common/auth-context";
import { BRAND } from "@/common/config/brand";

/* Montserrat carries the CTFI wordmark's voice — bold, geometric, tightly
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
    <html lang="en" className={`${inter.variable} ${montserrat.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
