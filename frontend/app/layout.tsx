import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

// Load Inter as the primary UI font
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

// Load JetBrains Mono for badges, stats, and mono-style text
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

// Load Instrument Serif for retailer logo letters and headline italics
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-serif",
});

export const metadata: Metadata = {
  title: "ShopScan — Compare prices instantly",
  description:
    "One search. Four scrapers. Compare prices, ratings, and availability from Amazon, Best Buy, Walmart, and Newegg.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // inter.className applies font-family directly; jetbrainsMono.variable
    // exposes --font-mono as a CSS variable used in globals.css
    <html lang="en" className={`${inter.className} ${jetbrainsMono.variable} ${instrumentSerif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
