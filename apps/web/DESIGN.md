---
name: assay
description: A dark-first, glass-panelled governance instrument for profiling, classifying and scoring datasets.
colors:
  # Chrome — dark theme (the default identity; `.dark` on <html>)
  charcoal-canvas: "#090b0e"
  charcoal-card: "#14161a"
  charcoal-popover: "#15181e"
  charcoal-muted: "#1d2025"
  charcoal-border: "#21252b"
  ink-high: "#f9fafb"
  ink-muted: "#a8b0bd"
  instrument-blue: "#3c8bec"
  instrument-blue-ink: "#0a0a0a"
  blue-wash: "#192b43"
  focus-ring: "#4996f3"
  # Chrome — light theme (warm-neutral inversion of the same structure)
  bone-canvas: "#f8f8f6"
  bone-card: "#fdfdfc"
  bone-border: "#e4e2dc"
  bone-muted: "#efeeeb"
  ink-high-light: "#0a0a0a"
  ink-muted-light: "#51504d"
  instrument-blue-light: "#256bc1"
  blue-wash-light: "#e9f0fc"
  focus-ring-light: "#2977d6"
  # Score ramp — sequential single-hue magnitude, banded 0-24/25-49/50-74/75-89/90-100
  score-ramp-light-0: "#86b6ef"
  score-ramp-light-1: "#5598e7"
  score-ramp-light-2: "#2a78d6"
  score-ramp-light-3: "#1c5cab"
  score-ramp-light-4: "#104281"
  score-ramp-dark-0: "#184f95"
  score-ramp-dark-1: "#1c5cab"
  score-ramp-dark-2: "#256abf"
  score-ramp-dark-3: "#3987e5"
  score-ramp-dark-4: "#86b6ef"
  gauge-track-light: "#cde2fb"
  # Status hues — categorical, mode-invariant, never used for magnitude
  status-good: "#0ca30c"
  status-warning: "#fab219"
  status-critical: "#d03b3b"
  status-muted: "#898781"
  destructive: "#cf3a3a"
typography:
  display:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "36px"
    letterSpacing: "normal"
  headline:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: "32px"
    letterSpacing: "-0.015em"
  title:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: "22px"
    letterSpacing: "-0.01em"
  body:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: "18px"
    letterSpacing: "normal"
  caption:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "normal"
  micro:
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: "14px"
    letterSpacing: "0.05em"
  mono:
    fontFamily: "ui-monospace, SF Mono, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
    letterSpacing: "normal"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  xl: "12px"
  2xl: "16px"
  full: "9999px"
spacing:
  hair: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
  3xl: "32px"
  page-gutter: "16px"
  page-gutter-wide: "32px"
components:
  button-primary:
    backgroundColor: "{colors.instrument-blue}"
    textColor: "{colors.instrument-blue-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.instrument-blue}"
    textColor: "{colors.instrument-blue-ink}"
  button-secondary:
    backgroundColor: "{colors.charcoal-canvas}"
    textColor: "{colors.ink-high}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.ink-high}"
  glass-card:
    backgroundColor: "{colors.charcoal-card}"
    textColor: "{colors.ink-high}"
    rounded: "{rounded.xl}"
    padding: "20px"
  status-pill:
    backgroundColor: "{colors.charcoal-card}"
    textColor: "{colors.ink-high}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  input-field:
    backgroundColor: "{colors.charcoal-canvas}"
    textColor: "{colors.ink-high}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: "0 10px"
    height: "36px"
  nav-rail-item:
    backgroundColor: "{colors.charcoal-canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "40px"
  nav-rail-item-active:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.ink-high}"
  table-header-cell:
    backgroundColor: "{colors.charcoal-canvas}"
    textColor: "{colors.ink-muted}"
    typography: "{typography.micro}"
    padding: "10px 12px"
  table-row:
    backgroundColor: "{colors.charcoal-card}"
    textColor: "{colors.ink-high}"
    typography: "{typography.body}"
    padding: "10px 12px"
  table-row-hover:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.ink-high}"
---

# Design System: assay

## 1. Overview

**Creative North Star: "The Lit Instrument"**

`assay` is a governance instrument, not a marketing surface. The canvas is a deep
cool charcoal — a darkened control room — and everything above it is a
translucent glass panel that appears to be lit from its own top edge. Depth comes
from light passing through material, never from a drop shadow drawn under a
white box. A single restrained blue is the only brand hue, and it is spent
exclusively on the things that matter: the primary action, the current selection,
and the focus ring. Every other saturated colour on the screen is data.

The system is dense without being cluttered. A 14px body, a 4px spacing grid,
hairline dividers instead of nested boxes, and generous space *between* groups
rather than inside them. Tables breathe by row rhythm. The type scale is fixed
in rem/px and deliberately tight (roughly 1.15 between steps) because a
governance catalog has far more type elements than a landing page, and
exaggerated contrast in that context reads as noise, not hierarchy.

Motion is a state channel, not a performance. Springs are named
(`snappy` / `gentle` / `instant`), they act on transform and opacity only,
stagger never exceeds 0.05s, and every animation is gated behind a single
`useReduceMotion()` that reads the OS setting *or* the in-app override. What the
system explicitly rejects: purple gradients, gradient text, glow, decorative
blobs, oversized hero copy, cards inside cards, eyebrow kickers, rainbow
categorical palettes on ordered data, and any number that cannot be opened and
explained.

**Key Characteristics:**

- Dark-first cool charcoal canvas with a warm-neutral light inversion; both are first-class, and `color-scheme` is set so native controls follow.
- One glass material (translucency + backdrop blur + 1px inner top-highlight + ambient shadow), composed into bar, rail, card, table and dialog.
- One system sans across the entire product; mono reserved for IDs, categories and raw sample values.
- Colour encodes or it is absent: a sequential ramp for magnitude, four categorical status hues for entities, neutrals for everything structural.
- Every status carries an icon and a word; every score double-encodes as sweep, ramp darkness and numeral.
- Spring motion on transform/opacity only, with two independent reduced-motion triggers.

## 2. Colors

A near-monochrome chassis carrying exactly one brand hue and two strictly-typed
data scales.

### Primary

- **Instrument Blue** (dark `#3c8bec`, light `#256bc1`): the only brand hue. It marks the primary button, the active nav item's icon, the current sort direction, the selected segment, the range-input track and the focus ring — nothing else. Its light-theme value is darkened so button text (near-black on the dark theme's brighter blue, white on light) clears 4.5:1 in both directions. Never used to fill a chart, tint a card, or signal "important".
- **Blue Wash** (dark `#192b43`, light `#e9f0fc`): the selection and hover surface. It is the `accent` token — the springy pill behind the active nav row, the hovered table row, the hovered ghost button. It is a *state*, never a decoration.

### Secondary

- **The Score Ramp** (5 steps per theme, `score-ramp-light-0…4` / `score-ramp-dark-0…4`): a sequential single-hue blue ramp banded at 0–24 / 25–49 / 50–74 / 75–89 / 90–100. It fills every gauge arc, every meter bar and every breakdown bar. Darkness *is* magnitude; the dark-theme ramp is inverted and clamped so even a band-0 score stays ≥2:1 against the charcoal canvas.
- **Gauge Track** (light `#cde2fb`, dark = the border token): the unfilled remainder of any gauge, meter or composition strip. It is also the "no score yet" fill, so an unscored figure reads as empty rather than as a low score.

### Tertiary

- **Status Good** (`#0ca30c`), **Status Warning** (`#fab219`), **Status Critical** (`#d03b3b`), **Status Muted** (`#898781`): four categorical hues, identical in both themes, bound to entities and not to rank. They carry `KEEP` / `OPTIMIZE` / `RETIRE` / `ARCHIVE`, `LOW` / `MEDIUM` / `HIGH` / `NONE` sensitivity, and `INFO` / `WARNING` / `ERROR` severity. In a pill they appear at 12% tint against the card with a 24% border; the icon alone runs at full strength.
- **Destructive** (`#cf3a3a`): the button and border colour of a genuinely irreversible action (delete-every-dataset). Distinct in role from Status Critical, which is a *reading*, not an action.

### Neutral

- **Charcoal Canvas** (`#090b0e`) / **Bone Canvas** (`#f8f8f6`): the page. Cool and near-black in dark; a warm off-white in light.
- **Charcoal Card** (`#14161a`) / **Bone Card** (`#fdfdfc`): the opaque surface beneath every glass panel, used directly wherever `backdrop-filter` is unsupported.
- **Charcoal Border** (`#21252b`) / **Bone Border** (`#e4e2dc`): opaque panel edges, table dividers, hairline rules.
- **Ink High** (`#f9fafb` / `#0a0a0a`): body, headings, table cells, every number a reader has to trust.
- **Ink Muted** (`#a8b0bd` / `#51504d`): labels, captions, meta, axis ticks, inactive nav. Restricted to meta and large text — it is not a body colour.

### Named Rules

**The Encoding Rule.** Colour appears only where it encodes a value. Score, sensitivity, recommendation, severity, selection, focus. If a colour cannot be traced to a field in the data model or a UI state, it does not ship.

**The Never-Alone Rule.** Colour is never the sole channel. Sensitivity, recommendation and severity always carry an icon *and* the word; scores carry sweep angle, ramp darkness *and* a numeral. The word is the accessible name; the icon is `aria-hidden`.

**The Ramp-Is-Magnitude Rule.** Ordered quantities take the sequential ramp; categorical entities take the status hues. Never the reverse. A rainbow across 0–100, or a magnitude read from green-to-red, is a defect.

**The Raw-Hex Rule.** Literal hex values exist in exactly one file, `src/index.css`. A component references `var(--score-band-N)`, `var(--status-*)` or a semantic Tailwind token — never a hex, never an arbitrary rgba.

## 3. Typography

**Display Font:** none — deliberately. There is no display or serif face anywhere in the product.
**Body Font:** system sans (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`)
**Label/Mono Font:** `ui-monospace, "SF Mono", Menlo, monospace`

**Character:** One family in multiple weights, rendered in whatever the reader's
OS considers native. The effect is a tool that belongs to the machine it runs on
rather than to a brand — no webfont request, no flash, no personality competing
with the data. Mono appears only where a string is a literal: PII category keys,
model identifiers, version numbers, admin tokens, raw sample values.

### Hierarchy

- **Display** (700, 32px/36px): the gauge centre numeral and the single hero figure on a KPI tile (rendered at 30px there). Proportional figures, not tabular — a `121` in tabular looks loose at this size.
- **Headline** (600, 24px/32px, `tracking-tight`): the page title. One per screen.
- **Title** (600, 15px/22px, `tracking-tight`): section headings and card titles. The most-used heading in the product.
- **Body** (400, 14px/21px): default text and table cells. Prose blocks are capped with `max-w-prose` and set `text-wrap: pretty`.
- **Label** (500, 13px/18px): form labels, buttons, badges, row labels (13.5px where a settings row label needs a touch more weight against its hint).
- **Caption** (400, 12px/16px): hints, meta, relative timestamps, chart tooltips.
- **Micro** (600, 11px/14px, UPPERCASE, `letter-spacing: 0.05em`): table column headers, KPI tile labels, field captions. The *only* place uppercase is permitted.

### Named Rules

**The Tabular Rule.** Every number that sits in a column, an axis, a score readout or a stat line uses `tabular-nums`. Digits must align down a column or the table stops being scannable. The single exception is the large gauge numeral.

**The One-Family Rule.** No second family, no display face, no serif. Hierarchy is carried by size and weight alone. A display font in a UI label, button or data cell is prohibited.

**The Uppercase-Ceiling Rule.** Uppercase is reserved for 11px micro labels and for enum values that are literally uppercase in the data model (`HIGH`, `RETIRE`, `PROCESSING`). Uppercase headings, uppercase buttons and tracked eyebrow kickers above sections are prohibited.

## 4. Elevation

This system is a hybrid, and the hybrid leans hard toward material rather than
shadow. Every chrome surface — top bar, nav rail, card, table container, modal,
save bar — is the same `.glass` material: a translucent background over the
canvas, `backdrop-filter: blur() saturate(150%)`, a 1px inset top-highlight that
reads as a lit edge, and one soft ambient shadow. Borders are applied per element
(`border-b` on the bar, `border-r` on the rail, a full border on cards) using a
single `--glass-border` hairline, so one material composes into every surface
without a second recipe. Where `backdrop-filter` is unsupported, an `@supports`
fallback swaps the translucent background for the opaque `--card` token and the
layout is unchanged.

The Tailwind shadow scale still exists and is calibrated low and single-source
for the light theme. In dark it is near-invisible by design: elevation there is
carried by surface lift and the top-highlight, never by scaling up black.

### Shadow Vocabulary

- **glass-shadow** (`box-shadow: 0 16px 46px -18px rgba(0,0,0,0.6)` dark / `0 12px 34px -14px rgba(11,11,11,0.22)` light): the ambient pool under any glass surface. Applied by the material, not by hand.
- **glass-highlight** (`box-shadow: inset 0 1px 0 0 hsl(0 0% 100% / 0.055)` dark / `hsl(0 0% 100% / 0.65)` light): the single hairline that sells the glass. Drawn on a `::before` so it inherits the element's radius.
- **shadow-xs** (`0 1px 2px rgba(11,11,11,.04)`): resting opaque card or table in the light theme.
- **shadow-sm** (`0 1px 3px rgba(11,11,11,.06), 0 1px 2px rgba(11,11,11,.04)`): hovered row or card.
- **shadow-md** (`0 4px 12px rgba(11,11,11,.08), 0 2px 4px rgba(11,11,11,.04)`): popover, dropdown.
- **shadow-lg** (`0 12px 32px rgba(11,11,11,.12)`): dialog, upload modal.

### Named Rules

**The One-Material Rule.** There is exactly one glass recipe, and it lives in `.glass` in `src/index.css`. A surface either is glass or is not. Re-deriving translucency with a bespoke `bg-white/10 backdrop-blur-md` on a component is prohibited.

**The Lit-Edge Rule.** In dark mode, depth comes from the top-highlight and the surface lift, never from a heavier black shadow. If a panel needs more presence, raise its translucency or its highlight — do not darken the shadow.

**The No-Nesting Rule.** Glass never sits on glass. A card inside a card is prohibited; group with hairline dividers and spacing instead.

## 5. Components

### Buttons

- **Shape:** softly rounded (8px, `rounded-lg`), 36px tall (`h-9`) so a hit target clears 40px with its surrounding padding.
- **Primary:** solid Instrument Blue with near-black ink in dark and white in light, 12px horizontal padding, 6px icon gap, 13px medium label.
- **Hover / Focus:** hover reduces opacity to 90% (primary) or fills with the blue wash at 60% (secondary); active compresses to `scale(0.97)`; focus shows a 2px `--ring` ring via `focus-visible` only. Transitions are scoped to `[opacity,transform]` or `[background-color,transform]` at 150ms — never `transition-all`.
- **Secondary / Ghost:** hairline border on a 35% canvas fill, same geometry, ink-high label. Disabled drops to 40% opacity and removes pointer events.
- **Destructive:** the secondary shape with the critical hue on border and label, and a 10% critical hover fill. Irreversible actions arm first: the button switches to a confirm label for 4 seconds beside a Cancel, or requires typing `DELETE` into a field. No confirmation modal.

### Chips

- **Status Pill:** the single construction behind sensitivity, recommendation, severity, and system status. Fully rounded, 12% status-hue tint mixed into the card colour, 24% status-hue border, full-strength status icon, and the enum word in ink. Two sizes (11px / 13px). A manually overridden classification adds a hairline ring and a small pencil glyph.
- **Filter Chip:** a hairline-bordered glass control wrapping a native `<select>`, tinted with the primary at 7% when a filter is active so "something is filtering this list" is visible without reading the value.
- **Override Chip:** a rounded primary-tinted count ("3 overrides") beside a settings section heading.

### Cards / Containers

- **Corner Style:** 12px (`rounded-xl`) for cards, tables and the upload dropzone; 16px (`rounded-2xl`) for the upload dialog.
- **Background:** the glass material over the canvas, falling back to the opaque card token.
- **Shadow Strategy:** ambient only, applied by `.glass` — see Elevation.
- **Border:** a single 1px `--glass-border` hairline on all sides.
- **Internal Padding:** 20px for dashboard cards, 16px for KPI tiles, 14px horizontal / 16px vertical for settings rows separated by hairlines.

### Inputs / Fields

- **Style:** 36px tall, 8px radius, hairline border on a 35% canvas fill, 13px ink. Numeric fields are right-aligned and tabular. Native controls are used wherever they exist — `<select>` with a chevron overlay, `<input type="range">` with `accent-color`, real radio inputs behind the segmented control, a real checkbox with `role="switch"` behind the toggle.
- **Focus:** 2px `--ring` ring on `focus-visible`, never a bare `outline: none`.
- **Error:** critical border plus a 6% critical fill, `aria-invalid`, and an inline message with a warning glyph wired through `aria-describedby`. Validation messages use `role="status"` rather than `alert` when they change on every keystroke.
- **Disabled:** 40% opacity, pointer events removed.

### Navigation

- **Top bar:** sticky glass with a bottom hairline, 56px tall, holding the brand mark, a centred ⌘K search affordance, the theme toggle and the primary Upload button.
- **Rail:** sticky glass with a right hairline, 68px collapsed and 240px expanded at `lg`, persisting its state to `localStorage`. Rows are 40px tall with an 18px icon; labels are `sr-only` until expanded so the collapsed rail stays accessible.
- **Active state:** a blue-wash pill with an inset hairline riding a shared `layoutId`, so it springs between rows (`snappy`, stiffness 380 / damping 32) instead of cutting. The same pattern drives the settings section nav and the segmented control.
- **Mobile:** the rail stays as an icon-only strip; the search affordance hides below `sm`; the catalog table swaps to a stacked card list below 768px.

### The Score Gauge (signature)

The defining component. A 3/4-open (270°) SVG ring whose fill is the score ramp
by band and whose sweep angle encodes the same magnitude, so the value survives
greyscale and colour-vision deficiency. Two variants: a 132px **detail** gauge
that is a `<button aria-haspopup="dialog">` opening the "explain this score"
breakdown, and a 40px **inline** gauge with `role="meter"` for table cells, where
the row is the click target. The fill grows from empty via a `stroke-dashoffset`
transition on mount, and renders at its final value under reduced motion. A
`PROCESSING` dataset shows a rotating quarter-arc or a sweeping indeterminate
bar rather than a fake zero; a `FAILED` one shows an em dash. A valence word
("Good" / "Fair" / "Poor") rides a small dot chip beneath the numeral — valence
lives on the chip, never on the ring.

### Loading, Empty and Error States

Every data surface ships all three. Loading is a skeleton holding the final
layout height (glass rectangles at the real card sizes, `animate-pulse` rows in a
table), never a spinner in the middle of content. Empty states name what is
missing, explain what will fill it, and offer the action ("Your catalog is empty
— upload a CSV or XLSX to profile its structure…" with a route to the catalog).
Error states state the failure, name the likely cause (a cold-starting free-tier
API), and give a Retry. A refused action reports inline beside its own button,
not only in a toast.

## 6. Do's and Don'ts

### Do:

- **Do** keep every literal colour value in `src/index.css` and reference it as `var(--score-band-N)`, `var(--status-*)` or a semantic Tailwind token from components.
- **Do** pair every status colour with its icon and its word. The word is the accessible name; the icon is `aria-hidden="true"`.
- **Do** use the sequential ramp for magnitude and the four status hues for categories — and never swap them.
- **Do** compose surfaces from the single `.glass` class plus a per-element border, so the bar, rail, card, table and dialog stay one material.
- **Do** gate every animation behind `useReduceMotion()` (OS setting *or* the in-app override) and animate transform and opacity only.
- **Do** use named springs from `lib/motion.ts` (`snappy`, `gentle`, `instant`) and keep list stagger at or below 0.05s.
- **Do** put `tabular-nums` on every number in a column, axis, score or stat line.
- **Do** design the `PROCESSING`, `FAILED`, empty, cold-start and unconfigured states as deliberately as the happy path.
- **Do** make destructive actions arm inline — a 4-second confirm state or a typed `DELETE` phrase — instead of opening a modal.
- **Do** keep hit areas at 40px even when the drawn control is smaller (grow with negative margin plus padding, as the switch does).
- **Do** reach for the native control first: `<select>`, `<input type="range">`, real radios behind the segmented control, a real checkbox behind the switch.

### Don't:

- **Don't** introduce hero copy, eyebrow kickers, numbered section markers, or oversized display type. This is app UI; it is not a marketing surface.
- **Don't** use purple gradients, gradient text (`background-clip: text`), glow, or decorative blobs.
- **Don't** nest a card inside a card, or glass inside glass. Group with hairline dividers and spacing.
- **Don't** add a second font family, and never set a UI label, button or data cell in a display or serif face.
- **Don't** use colour as the only channel for any reading — no colour-only status, no colour-only score.
- **Don't** apply a rainbow or categorical palette to an ordered quantity, or read magnitude from a green-to-red scale.
- **Don't** use `muted-foreground` ink for body copy. It is calibrated for meta, captions and axis ticks only.
- **Don't** darken the shadow to create depth in dark mode. Raise the surface or the top-highlight instead.
- **Don't** write a bespoke translucency (`bg-white/10 backdrop-blur-md`) on a component when `.glass` exists.
- **Don't** animate layout properties, use bounce or elastic easing, or add an orchestrated page-load sequence. A steward should be able to read the screen immediately.
- **Don't** ship a spinner in the middle of content, an empty state that only says "nothing here", or an error that does not name a next action.
- **Don't** ship a number that cannot be opened and explained. A score with no breakdown is a regression.
- **Don't** reach for a modal first. Exhaust inline and progressive alternatives; the upload dialog is the only modal in the product.
