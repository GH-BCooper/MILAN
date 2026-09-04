import type { Metadata, Viewport } from "next";
import { Noto_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const notoSans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin"],
  display: "swap",
});

/* Half of Milan renders in Devanagari. Loading the face explicitly means the
   Hindi original does not fall back to a system font of a different weight —
   the citizen text must sit beside the English copy at equal weight. */
const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-noto-devanagari",
  subsets: ["devanagari"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Milan — citizen problems become funded research",
    template: "%s · Milan",
  },
  description:
    "Milan turns a verified local problem into a time-bound, routed research assignment for a university team, with a hash-chained credit ledger and an SLA clock.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#1e3a8a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${notoSans.variable} ${notoDevanagari.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
