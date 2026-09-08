import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Toaster } from "@/components/ui/sonner";
import { SiteChrome } from "@/components/site-chrome";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

/* Self-hosted (app/fonts/, SIL OFL 1.1 — licences sit beside the files) so
   `pnpm build` never touches the network: next/font/google fetched these exact
   faces from fonts.googleapis.com at build time, which fails on any machine
   without a route to Google — precisely the third-party dependency invariant 8
   forbids. The variables below are the ones globals.css actually reads;
   `--font-milan-sans` was referenced there for months without a definition,
   which silently degraded every page to the browser default font. */
const notoSans = localFont({
  src: "./fonts/noto-sans-latin-wght-normal.woff2",
  variable: "--font-milan-sans",
  weight: "100 900",
  display: "swap",
});

/* Half of Milan renders in Devanagari. Loading the face explicitly means the
   Hindi original does not fall back to a system font of a different weight —
   the citizen text must sit beside the English copy at equal weight. */
const notoDevanagari = localFont({
  src: "./fonts/noto-sans-devanagari-devanagari-wght-normal.woff2",
  variable: "--font-milan-devanagari",
  weight: "100 900",
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
  /* The browser chrome follows the skin the user actually picked. */
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fc" },
    { media: "(prefers-color-scheme: dark)", color: "#05060f" },
  ],
};

/* Async because the single navbar (<SiteChrome />) reads the request headers
   to tell the landing site from the app. Every page renders one header from
   here and none anywhere else. */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${notoSans.variable} ${notoDevanagari.variable} h-full`}
    >
      <body className="min-h-full flex flex-col antialiased">
        <ThemeProvider>
          <SiteChrome />
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
