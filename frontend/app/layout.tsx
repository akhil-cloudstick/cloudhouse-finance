import type { Metadata, Viewport } from "next";
import { Jost, Bodoni_Moda } from "next/font/google";
import "./globals.css";
import "./app/app.css";
import { AuthProvider } from "@/common/auth-context";

// Matches the Google Fonts <link> weights used across the legacy index.html
// and app.html pages (union of both).
const jost = Jost({
  variable: "--font-jost",
  weight: ["300", "400", "500", "600"],
  subsets: ["latin"],
  display: "swap",
});

const bodoniModa = Bodoni_Moda({
  variable: "--font-bodoni-moda",
  weight: ["400", "500", "600", "700", "800"],
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Ambika Gold",
  description: "Ambika Gold Finance",
  icons: {
    icon: "/ambika-gold.jpeg",
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
    <html lang="en" className={`${jost.variable} ${bodoniModa.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
