import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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
    <html lang="en" className={`${inter.className} ${jetbrainsMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
