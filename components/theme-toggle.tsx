"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/** A three-way segmented control rather than a flip switch: the third state
 *  (follow the OS) is real and hiding it makes the control lie. Rendered as a
 *  radiogroup so a screen reader announces which skin is active. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the stored theme, so the control is inert until
  // hydration — rendering the "active" ring early would flash the wrong one.
  useEffect(() => setMounted(true), []);

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`inline-flex items-center gap-0.5 rounded-full border border-border/70 bg-foreground/5 p-0.5 ${className}`}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mounted && theme === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} theme`}
            title={`${label} theme`}
            onClick={() => setTheme(value)}
            className={`flex size-8 min-h-8 items-center justify-center rounded-full transition-colors ${
              active
                ? "bg-gradient-to-br from-[var(--grad-1)] to-[var(--grad-2)] text-white shadow-[0_6px_18px_-8px_var(--grad-1)]"
                : "text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            }`}
          >
            <Icon aria-hidden className="size-4" />
          </button>
        );
      })}
    </div>
  );
}
