import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./landing.css";

/* A separate root layout on purpose. The (product) layout wraps everything in
 * BrandingProvider/AuthProvider, which fetch a business's branding from the
 * backend and overwrite the tab title and icon. The public landing page has no
 * business and needs no backend, so it gets none of that: plain static HTML,
 * its own title and icon baked in, nothing fetched at runtime.
 *
 * Fonts are the same self-hosted files the product uses (the build container
 * has no internet, so next/font/google is not an option). */
const inter = localFont({
  src: "../(product)/fonts/Inter-Variable-latin.woff2",
  variable: "--font-sans",
  weight: "400 700",
  display: "swap",
});

const montserrat = localFont({
  src: "../(product)/fonts/Montserrat-Variable-latin.woff2",
  variable: "--font-display",
  weight: "600 800",
  display: "swap",
});

export const metadata: Metadata = {
  title: "CloudHouse Finance | Software for licensed gold lenders",
  description:
    "CloudHouse Finance is business software for licensed gold lenders: customer KYC, gold appraisal, loan records, vault tracking and reports, in one staff app.",
  icons: { icon: "/cloudhouse-icon.png", apple: "/cloudhouse-apple-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function LandingRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${montserrat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
