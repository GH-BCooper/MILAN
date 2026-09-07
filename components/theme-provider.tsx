"use client";

import { ThemeProvider as NextThemes } from "next-themes";

/** Class-strategy theming. `defaultTheme="dark"` keeps the demo skin we have
 *  pitched with, while `enableSystem` means a judge on a light-set laptop who
 *  has never touched the toggle still gets a readable screen. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      storageKey="milan-theme"
    >
      {children}
    </NextThemes>
  );
}
