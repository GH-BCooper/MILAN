# Milan — Version Two

A record of everything added or changed in the v2 pass, and the technology each
piece uses. Nothing in Phase 1–3 was rewritten: this is additive, apart from the
two files noted under *Replaced*.

Date: 2026-09-07

---

## 1. What changed, in one paragraph

Milan now has a **public landing site** that is fully separated from the
signed-in dashboards, a **hand-drawn SVG map of India** on that landing page,
**three distinct portals** (citizens, universities, industry) each with its own
overview page and routes into the real product, and a **light theme** across the
entire application alongside the existing dark one.

---

## 2. The landing site

A new route group `app/(landing)/` that owns `/`. It is separate from the
dashboard chrome by design: `components/site-header.tsx` is role-aware and calls
`currentUser()`, so a landing page built on it would render differently for a
signed-out judge. The landing site has its own chrome instead.

| File | Purpose |
|---|---|
| `app/(landing)/page.tsx` | The landing page: hero, India map, three portal cards, four "what holds it up" mechanism cards, a government strip. Statically prerendered (`○ /`). |
| `app/(landing)/landing-chrome.tsx` | `LandingHeader`, `LandingFooter`, `PortalShell`, `FeatureGrid`, `StepList` — the shared building blocks for the landing site and all three portals. |
| `app/(landing)/portals/citizens/page.tsx` | Citizen portal. |
| `app/(landing)/portals/universities/page.tsx` | University / HEI portal. |
| `app/(landing)/portals/industry/page.tsx` | Industry / CSR portal. |

**Replaced:** the old `app/page.tsx` (a three-card citizen action page) was
removed; its content is now the citizen portal plus the landing hero.

### The India SVG map — `components/india-map.tsx`

- **Inline SVG**, hand-authored path in a `0 0 1000 1000` box. No image request,
  no map token, no third-party call — it satisfies invariant 8 (nothing on the
  demo path depends on a live third-party API).
- Fill is a gradient built from the `--grad-1..3` accent ramp, plus a dot-grid
  `<pattern>` clipped to the landmass by `<clipPath>`, so it re-tints itself in
  both themes without a second asset.
- Five markers; Jharkhand is the primary one and carries an SMIL pulse
  (`<animate>`), suppressed automatically by the existing
  `prefers-reduced-motion` rule in `globals.css`.
- It is **schematic, not cartographic**, and the code says so in a comment. The
  only surface allowed to make a spatial claim is the MapLibre + PMTiles basemap
  on `/challenges`.

### Portal split

| Portal | Depth | Routes it exposes |
|---|---|---|
| **Citizens** — `/portals/citizens` | Deliberately shallow. Four steps, six cards, no jargon. | `/submit`, `/track`, `/challenges`, `/me`, `/stats`, `/ledger` |
| **Universities** — `/portals/universities` | Deep. Nine feature cards. | `/hei`, `/hei/inbox`, `/hei/capability`, `/hei/challenge-bank`, `/hei/projects/[id]`, `/ledger`, `/bounties`, `/challenges`, `/register` |
| **Industry** — `/portals/industry` | Deep. Eight feature cards. | `/industry/discover`, `/industry/csr`, `/bounties`, `/industry/interests/[id]`, `/stats`, `/ledger`, `/challenges`, `/register` |

Every feature card is a live `next/link` into an existing route — a portal page
that describes a feature it cannot open is a brochure. Access control is
unchanged: `middleware.ts` still guards `/me`, `/hei`, `/industry`, `/gov`,
`/admin`, `/demo`, and every handler still rechecks the role server-side. The
portal pages themselves are public and static.

---

## 3. Light mode

### Approach

`next-themes` (already a dependency, previously unused for this) with the
**class strategy** — it stamps `.dark` on `<html>`, which matches the
`@custom-variant dark (&:is(.dark *))` already declared in `globals.css`.

`app/globals.css` previously carried one hardcoded dark palette on `:root`, plus
roughly two dozen literal `#fff` / `rgb(255 255 255 / x)` / `rgb(0 0 0 / x)`
values scattered through the component layer. Those literals are why the app
could not be re-skinned. They are now **tokens**:

| New token | Role |
|---|---|
| `--glass-top`, `--glass-bottom`, `--glass-solid` | the glass-panel recipe |
| `--tint`, `--tint-strong`, `--tint-hover` | input / badge / hover surfaces |
| `--ink-strong`, `--ink-soft` | the two emphasis inks |
| `--scrollbar-track`, `--overlay`, `--shadow-deep` | chrome |
| `--aurora` | the three-radial background wash |
| `--headline` | the `h1` gradient ramp |

`:root` now holds the **light** values and `.dark` overrides them. Not one rule
below the token blocks knows which theme it is running in, so a future third
skin (high contrast, print) is a token block and nothing else. The accent ramp
`--grad-1..4` is *darkened* in light mode so gradient text stays legible on a
white ground.

### Files

| File | Change |
|---|---|
| `app/globals.css` | Split into `:root` (light) + `.dark`; every hardcoded surface value replaced by a token. `#fff` survives only on gradient-filled buttons/badges/tabs, where it is correct in both skins. |
| `components/theme-provider.tsx` | **New.** Wraps `next-themes` — `attribute="class"`, `defaultTheme="dark"`, `enableSystem`, `disableTransitionOnChange`, `storageKey="milan-theme"`. |
| `components/theme-toggle.tsx` | **New.** A three-way segmented control (Light / Dark / System) as a `role="radiogroup"`. It is inert until `mounted`, because the server cannot know the stored theme and rendering the active ring early would flash the wrong one. |
| `app/layout.tsx` | `<html suppressHydrationWarning>`, wraps children in `ThemeProvider`, `themeColor` is now a light/dark pair, `<Toaster>` no longer pinned to `theme="dark"` (`components/ui/sonner.tsx` already reads `useTheme()`). |
| `components/site-header.tsx` | Renders `<ThemeToggle />` in the right-hand cluster, so every signed-in surface can switch. |
| 15 component/page files | `bg-white/N` → `bg-foreground/N`, `border-white/N` → `border-foreground/N`, and one `text-white` → `text-foreground`. A white wash at 5% opacity is invisible on a light ground; `foreground` inverts with the theme. |

**Default is still dark.** The demo skin we have pitched with is unchanged, and
`enableSystem` means a judge on a light-set laptop who never touches the toggle
still gets a readable screen.

---

## 4. Technology used

Everything here stays inside the locked stack in `CLAUDE.md` §3. **No new
dependency was added.**

| Concern | Technology | Note |
|---|---|---|
| Routing | Next.js 15 App Router, route groups | `(landing)` group owns `/` and `/portals/*` |
| Rendering | React 19 Server Components | The whole landing site is RSC; only `ThemeToggle` and `ThemeProvider` are `"use client"` |
| Styling | Tailwind v4 + CSS custom properties | `@theme inline` already maps the tokens to Tailwind colour utilities, so `bg-foreground/5` works |
| Theming | `next-themes` 0.4.6 | Already in `package.json`; class strategy, no FOUC (its own inline script) |
| Map graphic | Inline SVG (path, `linearGradient`, `pattern`, `clipPath`, SMIL `animate`) | Zero-dependency, offline-safe, theme-aware |
| Icons | `lucide-react` | Already in use |
| Components | shadcn/ui `Button` | Already in use |
| Toasts | `sonner` | Now follows the active theme |

---

## 5. Invariants respected

- **8 — nothing on the demo path needs a live third party.** The India map is
  inline SVG. The theme is CSS plus `localStorage`. Both work with the wifi off.
- **6 — the citizen's original text is never hidden.** Untouched; the citizen
  portal restates the rule in plain language.
- **10 — every number opens its derivation.** The landing "what holds it up"
  cards each link to the surface that proves the claim (`/gov/sla`, `/ledger`,
  `/challenges`, `/admin/routing`).
- **Accessibility.** The map is `role="img"` with an `aria-label`; the theme
  control is a labelled `radiogroup`; the 44px minimum-target rule in
  `globals.css` still applies; the layout holds at 320px.

---

## 6. Verification

```
pnpm exec tsc --noEmit     # clean
pnpm build                 # passes; / and /portals/* prerender as static (○)
pnpm test                  # 76 passed, 1 failed
```

The single failure is `state machine > accepts every legal edge`, and it is a
**timeout, not an assertion failure** — it hit the local `testTimeout: 180_000`
in `vitest.config.ts` exactly (180008ms) while walking ~80 real transitions
against Postgres. CI is already given 600s for this reason. It is environmental
slowness on the dev machine, and it is not attributable to this pass: the v2
diff touches only `app/`, `components/` and `app/globals.css`, nothing in
`lib/`, `packages/` or `tests/`. Every other DB-backed test passed, including
state-machine atomicity, terminal-state refusal, the ledger's append-only
triggers, and invariant 1 (no challenge may silently die).

Not verified: pixel screenshots. No browser binary is available in this
environment, so both skins were checked structurally (token parity between
`:root` and `.dark`, live HTTP 200s and rendered markup on every new route)
rather than visually. Open `/` and press the Light button in the header to
confirm by eye.

Routes added: `/`, `/portals/citizens`, `/portals/universities`,
`/portals/industry` — all four static.

---

## 7. Known limits / declared

- **The India outline is schematic.** It is a stylised silhouette, not survey
  data, and it is not a statement about any boundary. Real geometry lives in the
  PMTiles basemap. If this ever ships beyond a demo, replace the path with an
  official Survey of India outline.
- **Two portal cards link to id-parameterised routes** (`/hei/projects/1`,
  `/industry/interests/1`) so the card is clickable in the demo. They resolve
  against seeded ids; they are not a live "most recent" lookup.
- **Light mode is verified structurally, not pixel-audited on every one of the
  ~35 routes.** Every colour now flows from a token, so a contrast miss is a
  token fix rather than a per-page one.
