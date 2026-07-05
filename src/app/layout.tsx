// src/app/layout.tsx
//
// Root layout: sets up the three fonts (display / body / mono) via
// next/font, which self-hosts and optimizes Google Fonts automatically
// (no CDN flash-of-unstyled-text). Each font is exposed as a CSS variable
// that tailwind.config.ts maps to font-display / font-body / font-mono.

import type { Metadata } from "next";
import { Space_Grotesk, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "FinBoard — AI Research Terminal",
  description: "Multi-agent financial research copilot",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-base text-ink font-body antialiased min-h-screen">{children}</body>
    </html>
  );
}