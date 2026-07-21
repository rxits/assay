# 05 — Design System & UX (assay)

> Purpose: the single UX/visual contract for the `assay` web app — tokens, data-color
> semantics, component specs, wireframes, chart specs, and accessibility. **Derived from
> 00-SPEC.md** (all entity/field/enum names, scores, and pages come from there; this doc
> adds no new domain concepts). Grounded in three skills: `ui-ux-pro-max:design-system`
> (token architecture), `dataviz` (all chart/gauge/color rules, contrast targets, and the
> palette validator), and `ecc:frontend-design-direction` (direction & restraint).

---

## 0. Scope & sources

- **No code imports this doc.** It is read by the README's design-decisions section and by
  `10-BUILD-PLAN.md`; component/enum/route names are the ones fixed in `00-SPEC.md`.
- **Stack (pinned in 00-SPEC §4):** React 18 + Vite 5, **Tailwind v3 + shadcn/ui**, Recharts
  2.x, TanStack Query 5. Tokens below are expressed as **shadcn CSS variables** so shadcn
  primitives inherit them and Recharts reads the same values.
- **Colour is computed, not eyeballed.** Every data colour traces to `dataviz`'s reference
  palette (`references/palette.md`) and was run through `scripts/validate_palette.js`. Cited
  numbers in §3 and §8 are real validator / WCAG outputs, not estimates.
- Dates are ISO-8601 at rest (per 00-SPEC §13); the UI renders them humanised with the ISO
  string in a `title`/`datetime` attribute.

---

## 1. Design direction / vibe

`assay` is a **governance instrument**, not a marketing surface. A reviewer grading a hire
decision must trust it at a glance and be able to interrogate any number. The five direction
choices (per `ecc:frontend-design-direction`):

| Axis | Decision |
|---|---|
| **Purpose** | Read the health of an uploaded dataset (quality / trust / value) and drill to column evidence. |
| **Audience** | Data stewards & reviewers scanning many datasets, then auditing one deeply. Optimise for *scan → drill → explain*. |
| **Tone** | Calm, dense, quiet, scannable — a **precision tool**. Utilitarian with a premium finish, never playful, never neon. |
| **Memorable detail** | **Every score explains itself** — the circular gauge is a button that opens a weighted "explain this score" breakdown wired to `Dataset.scoreBreakdown`. Transparency *is* the brand (00-SPEC §2.4). |
| **Constraints** | Tailwind + shadcn/ui, Recharts, WCAG 2.1 AA, colourblind-safe, light + dark, responsive ≥ 360px. |

**Vibe rules (locked):**

1. **Trustworthy & calm** — one restrained blue as the only brand hue; neutrals do the
   structural work. Colour appears only where it *encodes* (scores, sensitivity, severity),
   never as decoration.
2. **Data-dense, not cluttered** — 14px base, tight 4px spacing grid, hairline dividers
   instead of boxes, generous whitespace *between* groups. Tables breathe by row rhythm, not
   by padding bloat.
3. **Premium, not flashy** — subtle low shadows, 1px borders, system sans throughout (no
   display/serif face), muted surfaces. Explicitly **avoid** the generated-UI tells called out
   by `ecc:frontend-design-direction`: purple gradients, glow, decorative blobs, oversized hero
   copy, cards-inside-cards.
4. **Graceful degradation is visible design** — `PROCESSING`, `FAILED`, missing
   `healthNarrative`, empty catalog, and cold-start each have a designed state (§5.4, §7),
   because 00-SPEC §2.3 forbids anything that makes the demo look broken.

---

## 2. Design tokens

### 2.1 Token architecture (three layers, per `design-system`)

```
Primitive  (raw, brand-neutral)      blue-500 = #256abf ; neutral-950 = #0b0b0b
      ↓
Semantic   (purpose / shadcn role)   --primary ; --background ; --muted-foreground
      ↓
Component  (per-component)           --gauge-track ; --badge-high-bg ; --table-header-bg
```

Only the **semantic** layer is themed (light↔dark swap). Components reference semantic tokens;
raw hex never appears in a component. Surfaces and inks are deliberately aligned to the
`dataviz` chart chrome so a Recharts figure sits *native* inside a shadcn `Card` with no seam.

### 2.2 Colour — semantic tokens (shadcn CSS variables)

Values are concrete hex (shadcn stores HSL triplets; the hex is the source of truth here).
Neutrals are a **warm** grey family matched to the dataviz surfaces — not cold slate — which
reads calmer and more premium.

| Semantic role (shadcn var) | Light | Dark | Notes |
|---|---|---|---|
| `--background` (page plane) | `#f9f9f7` | `#0d0d0d` | dataviz page plane |
| `--card` / `--popover` (surface) | `#fcfcfb` | `#1a1a19` | **= dataviz chart surface** |
| `--foreground` (primary ink) | `#0b0b0b` | `#ffffff` | body/headings |
| `--muted-foreground` (secondary ink) | `#52514e` | `#c3c2b7` | labels, meta |
| *(disabled/axis ink)* | `#898781` | `#898781` | mode-invariant muted |
| `--muted` (subtle fill: table header, chips) | `#f0efec` | `#242422` | |
| `--border` / `--input` (hairline) | `#e5e3dd` | `#2c2c2a` | 1px dividers |
| *(baseline / axis line)* | `#c3c2b7` | `#383835` | chart baseline |
| `--primary` (brand blue) | `#256abf` | `#3987e5` | buttons, active, focus |
| `--primary-foreground` | `#ffffff` | `#0b0b0b` | text on primary |
| `--accent` (hover wash) | `#eaf1fc` | `#1e2a3a` | row/item hover |
| `--ring` (focus) | `#2a78d6` | `#3987e5` | 2px focus ring |
| `--destructive` | `#d03b3b` | `#d03b3b` | destructive actions |

> Data-encoding colours (score ramp, sensitivity, severity, recommendation) are **not** in the
> theme table above — they are reserved semantic scales specified in §3, because they must stay
> stable and validated independent of chrome theming.

### 2.3 Typography

System sans only (dataviz mandate — no display/serif anywhere): 
`--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. 
Mono for IDs, cuIDs, and raw sample values: `--font-mono: ui-monospace, "SF Mono", Menlo, monospace`.
**`tabular-nums`** on every number in a table column, axis tick, and score readout so digits
align; **proportional** figures for the large gauge numeral (a `121` in tabular looks loose).

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-display` | 32 / 36 | 700 | gauge centre numeral, single hero figure |
| `text-h1` | 24 / 32 | 600 | page title (dataset name) |
| `text-h2` | 18 / 26 | 600 | section headers ("Columns", "Usage") |
| `text-h3` | 15 / 22 | 600 | card titles |
| `text-body` | 14 / 21 | 400 | default body, table cells |
| `text-label` | 13 / 18 | 500 | form labels, buttons, badges |
| `text-caption` | 12 / 16 | 400 | meta (uploaded-at, row counts) |
| `text-micro` | 11 / 14 | 600 | table column headers & axis labels — UPPERCASE, `letter-spacing: 0.04em` |

### 2.4 Spacing — 4px grid

`0 · 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 · 64`. Component padding pulls from this only.
Table row height 44px (comfortable) / 36px (compact toggle). Card padding 20px. Page gutter
24px desktop, 16px mobile. Filter bar height 52px.

### 2.5 Radius (`--radius` base = 8px)

| Token | px | Use |
|---|---|---|
| `radius-sm` | 6 | badges, chips, inputs |
| `radius-md` | 8 | buttons, table container |
| `radius-lg` | 10 | cards, popover |
| `radius-xl` | 12 | dialog / upload dropzone |
| `radius-full` | 9999 | pill badges, gauge caps, avatars |

Modest radii — sharp enough to read as a tool, soft enough to read as premium.

### 2.6 Elevation / shadow

Calm = low, single-source shadows. Colour is `rgba(11,11,11,·)` in light.

| Token | Light value | Use |
|---|---|---|
| `shadow-xs` | `0 1px 2px rgba(11,11,11,.04)` | resting card, table |
| `shadow-sm` | `0 1px 3px rgba(11,11,11,.06), 0 1px 2px rgba(11,11,11,.04)` | hovered row/card |
| `shadow-md` | `0 4px 12px rgba(11,11,11,.08), 0 2px 4px rgba(11,11,11,.04)` | popover, dropdown |
| `shadow-lg` | `0 12px 32px rgba(11,11,11,.12)` | dialog, upload modal |

**Dark mode:** shadows are near-invisible on `#0d0d0d`; elevation is carried by **surface lift**
(card `#1a1a19` above page `#0d0d0d`) + a `--border` hairline + a 1px top inner-highlight
`rgba(255,255,255,.04)`. Never scale up black shadow in dark mode.

### 2.7 Motion tokens

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 120ms | hover, focus ring, badge |
| `--dur-base` | 200ms | popover/panel open, row expand |
| `--dur-slow` | 320ms | gauge sweep, page transitions |
| `--ease-standard` | `cubic-bezier(.2,0,0,1)` | enter/move |
| `--ease-exit` | `cubic-bezier(.4,0,1,1)` | leave |

All motion is gated by `prefers-reduced-motion: reduce` → durations collapse to 0 and the gauge
renders at final value (§8).

---

## 3. Data-colour semantics (the graded, validated part)

Per `dataviz`: colour comes **last** and does exactly one job. `assay` has four data-colour
scales. Each is reserved — a status/severity hue never doubles as a series hue.

### 3.1 Score gauges (Quality / Trust / Value, 0–100) — **sequential**

The three scores are the *same kind of thing* (a 0–100 magnitude), so they share **one
single-hue blue sequential ramp** (dataviz: magnitude = one hue, light→dark). Using one hue for
all three keeps the header calm/premium (not three traffic-lights) and makes the gauges
**cross-comparable** — a darker ring is unambiguously a higher score. Identity comes from the
**label** (Quality/Trust/Value), never hue.

Blue ramp (from `dataviz` palette.md), mapped by score band, clamped to the ordinal-safe range
(never lighter than step 250 on light / never darker than step 600 on dark, so even a low score
is visible ≥ 2:1):

| Score | Light fill | Dark fill |
|---|---|---|
| 0–24 | `#86b6ef` (250) | `#184f95` (600) |
| 25–49 | `#5598e7` (350) | `#1c5cab` (550) |
| 50–74 | `#2a78d6` (450) | `#256abf` (500) |
| 75–89 | `#1c5cab` (550) | `#3987e5` (400) |
| 90–100 | `#104281` (650) | `#86b6ef` (250) |

- **Track** (unfilled arc) = a lighter step of the same ramp on light (`#cde2fb`, step 100) /
  `--border` on dark — the meter rule "unfilled track = lighter step of the same ramp."
- **Magnitude is double-encoded**: arc *sweep* (0→score angle) **and** ramp darkness both rise
  with the score, so the value survives greyscale/CVD without relying on hue at all.
- **Valence** ("is this good?") is **not** in the ring — it rides a **tier chip** beside the
  numeral (§3.5), using the reserved status scale with **icon + word**, never colour-alone.
- *Sanctioned variant B (documented, not default):* teams wanting valence-first may instead fill
  the ring with the status tier colour (good→warning→serious→critical) per the dataviz *meter*
  pattern, keeping the numeral + tier word inside. We lead with the sequential ramp to preserve
  the calm, comparable header.

### 3.2 Sensitivity scale (`Sensitivity`: NONE / LOW / MEDIUM / HIGH)

These levels are **inherently ordered** (a severity ladder), so per `dataviz` they are treated as
an **ordered status scale**, not four arbitrary categorical hues — built from the reserved status
palette and **always shipped with the level word + a distinct icon** (the mandatory secondary
channel). The enum values are exactly those in 00-SPEC §6/§8; only their colour treatment is
defined here (no divergence).

| Level | Accent / icon hex | Icon | Meaning |
|---|---|---|---|
| `NONE` | `#898781` (muted) | ○ dot | no classification concern |
| `LOW` | `#0ca30c` (status good) | shield | low risk (POSTAL_CODE, OTHER) |
| `MEDIUM` | `#fab219` (status warning) | shield-half | moderate (NAME, ADDRESS, IP_ADDRESS) |
| `HIGH` | `#d03b3b` (status critical) | shield-alert | high (EMAIL, PHONE, ID_NUMBER, CREDIT_CARD, DATE_OF_BIRTH) |

**Validated (ran `scripts/validate_palette.js` on the three chromatic levels `#0ca30c,#fab219,#d03b3b`):**

- **CVD separation PASS** — worst adjacent pair amber↔green **ΔE 11.3 (protanopia)**, 24.4
  (tritanopia); target ≥ 8. Deuteranopia likewise clears.
- **Normal-vision floor PASS** — worst adjacent **ΔE 27.6**; floor ≥ 15.
- Amber trips the categorical **lightness-band** and **sub-3:1 contrast** checks on the light
  surface — this is the *known, by-design* behaviour of the reserved status scale (warning is
  1.79:1 on light), which is exactly why the scale is **never colour-alone**: every badge carries
  its icon + level text. On dark, all three clear 3:1.

**Sensitivity badge render:** pale tint background (status hue at ~10% over surface) + full-strength
status-coloured icon + level word in **ink tokens** (not the status colour). Text contrast on the
tint is 16–18:1 (computed), so the word is always readable regardless of the accent.

### 3.3 Value recommendation (`valueRecommendation`: KEEP / OPTIMIZE / ARCHIVE / RETIRE)

Also an ordered lifecycle state → status scale, icon + word:

| Value | Colour | Icon |
|---|---|---|
| `KEEP` | `#0ca30c` good | check-circle |
| `OPTIMIZE` | `#fab219` warning | sliders |
| `ARCHIVE` | `#898781` muted | archive |
| `RETIRE` | `#d03b3b` critical | trash |

### 3.4 Quality-check severity (`QualityCheck.severity`: INFO / WARNING / ERROR)

`INFO` = muted `#898781` (info icon) · `WARNING` = `#fab219` (triangle) · `ERROR` = `#d03b3b`
(octagon). Reserved status scale, icon + label.

### 3.5 Contrast targets (all computed, not eyeballed)

| Pair | Light | Dark | Target | Result |
|---|---|---|---|---|
| primary ink on surface | 19.17 | 17.42 | 4.5 (text) | PASS |
| secondary ink on surface | 7.73 | 9.72 | 4.5 | PASS |
| muted ink on surface | 3.50 | 4.85 | 3.0 (large/UI only) | PASS — reserved for meta/axis, never body |
| focus ring on surface | 4.30 | 4.79 | 3.0 (non-text) | PASS |
| primary button text | 5.39 | 5.41 | 4.5 | PASS |
| status good on surface | 3.27 | 5.19 | 3.0 (mark) | PASS |
| status warning on surface | **1.79** | 9.49 | 3.0 | light **relief-required** → icon+label present |
| status critical on surface | 4.68 | 3.62 | 3.0 | PASS |
| badge text on tint (HIGH/MED/LOW) | 16.2 / 17.6 / 17.3 | — | 4.5 | PASS |

---

## 4. Component inventory

Specs use the `design-system` state-table pattern where interaction states matter. All
components consume semantic tokens from §2.

### 4.1 Catalog data-table (`components/catalog/CatalogTable`)

The spine of `CatalogPage`. Renders `GET /datasets`. Semantic `<table>` (not divs).

- **Columns:** Name (+ `fileType` icon) · Rows · Cols · **Quality** · **Trust** · **Value** ·
  Recommendation · Top sensitivity · Usage (sparkline) · Uploaded. Score columns render a
  compact inline mini-gauge + tabular numeral.
- **Sortable score columns:** Quality/Trust/Value/Uploaded/Rows headers are buttons that toggle
  sort → drive `?sort=`. `aria-sort` reflects state; a caret shows direction. Sorting only
  re-orders — colours never repaint (dataviz: colour follows the entity, not its rank).
- **Row states:**

| Property | Default | Hover | Selected/focus | Loading |
|---|---|---|---|---|
| Background | `--card` | `--accent` | `--accent` + 2px left `--primary` bar | skeleton shimmer |
| Divider | 1px `--border` | 1px `--border` | — | — |
| Cursor | pointer | pointer | — | default |
| Shadow | none | `shadow-xs` | none | none |

- Row click → `DatasetDetailPage` (`GET /datasets/:id`). Density toggle (44↔36px). Sticky header.
- **PROCESSING** rows show a subtle indeterminate bar in the score cells; **FAILED** rows show a
  critical dot + `errorMessage` on hover, scores dashed `—`.

### 4.2 Dataset row / card (`components/catalog/DatasetCard`)

Responsive fallback: below ~768px the table collapses to stacked cards. One card = name + type,
a 3-up mini-gauge strip (Q/T/V), a recommendation chip, the top sensitivity badge, row/col meta,
and the usage sparkline. No card-in-card (anti-pattern) — the mini-gauges are inline, not nested
cards.

### 4.3 Circular score gauge (`components/dataset/ScoreGauge`)

- **Anatomy:** 132px (detail) / 40px (table inline) SVG ring, `stroke-linecap:round`, ~14px
  stroke on detail. Track = §3.1 track colour; fill = §3.1 ramp by score; sweep angle =
  score/100 × 270° (a 3/4 open gauge). Centre: `text-display` numeral (proportional figures) +
  `text-micro` label ("QUALITY"). Tier chip (§3.5) sits directly under the numeral.
- **It is a button** — the memorable detail. Click/Enter opens the "explain this score" popover
  (§4.5). Cursor pointer, focus ring on the ring group.
- **States:** default → hover (track lightens one step, chip underlines) → active/open (ring
  `--primary` outline). `PROCESSING` → indeterminate rotating arc, no numeral. Score `null` → track
  only + "—".
- **Motion:** on mount the sweep animates 0→score over `--dur-slow` `--ease-standard`; disabled
  under reduced-motion (renders final).

### 4.4 Sensitivity badge (`components/dataset/SensitivityBadge`)

Pill (`radius-full`), pale status tint bg + status icon + level word (§3.2). Sizes: `sm` (table,
20px) / `md` (panel, 24px). A **column** shows its own tag's level; a **dataset** shows its
*highest* column sensitivity ("HIGH" if any HIGH column). `overridden` tags get a hairline ring +
a tiny "edited" pencil glyph so manual overrides (00-SPEC §7 PATCH) are visible. Same construction
reused for `valueRecommendation` and `severity`.

### 4.5 "Explain this score" breakdown popover (`components/dataset/ScoreBreakdown`)

The transparency centrepiece — renders `Dataset.scoreBreakdown` (JSON of the §9 sub-scores).
shadcn `Popover` anchored to the gauge, `shadow-md`, `radius-lg`, max-width 320px.

- **Header:** score name + final value + tier chip.
- **Body:** the weighted formula as a **mini stacked/contribution bar** — one row per component,
  each showing `weight × component`. E.g. Quality:
  - `Completeness 0.40 × 0.98 = 0.392`
  - `Validity 0.30 × 0.91 = 0.273`
  - `Uniqueness 0.30 × 0.85 = 0.255` → **Quality 92.0**
  Trust rows: `0.45·Quality + 0.30·Consistency + 0.25·ClassificationCoverage`.
  Value rows: `0.45·Frequency + 0.35·Recency + 0.20·Trend`.
- Each component bar uses the **sequential blue ramp** (magnitude); the weight is text. Values in
  ink tokens, `tabular-nums`, one decimal. A footnote states weights come from the shared `config`
  (00-SPEC §9). Keyboard-openable, `role="dialog"`, focus trapped, `Esc` closes → focus returns
  to the gauge.

### 4.6 Column-detail panel (`components/dataset/ColumnPanel`)

Opened by expanding a row in the columns table (§6b). Shows one `Column`'s full profile:

- **Header:** `name` (mono) · `dataType` badge · position · `SensitivityBadge` + `PiiCategory` +
  `TagSource` (AUTO_REGEX/AUTO_AI/MANUAL) + confidence%.
- **Manual override control:** a `Select` for category + sensitivity → `PATCH
  /datasets/:id/columns/:columnId/classification`; on save, an optimistic toast "Reclassified —
  Trust recomputed" (the PATCH recomputes ClassificationCoverage + Trust).
- **Profile stats:** completeness, validity, missingPct, distinctCount as labelled meters/figures.
- **Mini-charts:** missing-value meter (§4.7a), type-distribution note, numeric histogram (§4.7c)
  when `dataType ∈ {INTEGER,FLOAT}`, else a top-values list from `sampleValues`.
- **Related quality checks:** the `QualityCheck` rows scoped to this `columnId`, severity-badged.

### 4.7 Mini-charts (`components/charts/*`)

All obey §5. Compact, axis-light, one hue unless encoding demands otherwise.

- **(a) Missing-value bar** — horizontal bar of `missingPct` per column (detail) or a single meter
  (panel). Fill = sequential blue by magnitude; track = ramp step-100. A `MISSING_VALUES`
  `QualityCheck` at WARNING/ERROR adds a status severity pip + sorts that column up. Value label
  `%` at the tip.
- **(b) Type-distribution** — count of columns per `dataType` as a horizontal bar list, **single
  blue hue** (nominal categories, magnitude shown by length — never colour bars by their value),
  sorted desc. Compact 100%-stacked "composition strip" variant available for the header, keyed by
  the 8-slot categorical ramp with a legend (≤7 types ≤ 8 slots, adjacent-pairs → validated).
- **(c) Numeric histogram** — column chart of value frequency across bins for a numeric column.
  Single blue hue, ≤24px bars, 4px rounded caps, 2px surface gap. X = bin ranges, Y = frequency.
- **(d) Usage sparkline** — 12–90 point line of daily `AccessEvent` counts (`GET
  /datasets/:id/usage`). De-emphasis hue (`--muted-foreground` at low weight) with the current
  period end-dot in `--primary`; no axes/gridlines in the table variant. The detail-page usage
  chart (§6) is the full-size version.

---

## 5. Chart specs (per `dataviz`)

### 5.1 Global rules

- **One axis, ever.** Never dual-y. Usage counts and score-trend are separate charts/sparklines,
  never overlaid on two scales.
- **Marks:** bars ≤ 24px, 4px rounded data-end / square at baseline; lines 2px round-join; markers
  ≥ 8px with a 2px surface ring; area fills = hue at ~10%. 2px surface gap between touching marks.
- **Gridlines/axes:** hairline 1px **solid** (never dashed), one-step-off-surface grey
  (`--border`), recessive. Baseline in `#c3c2b7`/`#383835`.
- **Legend:** present for **≥ 2 series**; a single-series chart gets **no legend box** (title
  names it). Identity is never colour-alone — legend + selective direct labels.
- **Direct labels are sparing** — endpoint / extreme only, never a number on every mark. Text wears
  **ink tokens**, never the series colour.
- **Number formatting:** compact for magnitudes (`1,284` → `12.9K` → `1.2M`); `sizeBytes`
  humanised (`4.2 MB`); scores integer in gauges, one decimal in the breakdown; ratios
  (`completeness`, `validity`, `missingPct`) as `%`; counts thousands-comma'd; `tabular-nums` in
  all columns/ticks/axes. Dates: axis ticks `Jul 18`, cells relative ("3d ago") with ISO in
  `title`/`<time datetime>`.

### 5.2 Tooltips & hover (default-on)

- **Line/area (usage, score-trend):** vertical **crosshair** snaps to nearest X; one tooltip lists
  **every series** at that date; value leads (Strong ink), series name secondary, keyed by a short
  line-stroke (not a box).
- **Bars/histogram/cells:** the **mark is the hit target** (no crosshair); hover lifts the mark
  (slight lighten); tooltip shows category + value. Hit area ≥ 24px including the surface gap.
- Same readout on **keyboard focus** as on hover. Series/category names come from CSV headers →
  inserted via `textContent`, **never** `innerHTML` (untrusted-data rule).
- Tooltips **enhance, never gate** — every value is also in the table view / direct label.

### 5.3 Legend, axes, empty/loading

- Y ticks round to clean numbers, thousands-comma'd. X shows dates, not indices.
- Full-size **usage chart** (detail): area of daily accesses over ~90d, single blue hue, crosshair
  tooltip, a faint marker where seed profile transitions (hot/declining/stale) matter; y = "views".

### 5.4 Empty / loading / skeleton / error states (every chart)

| State | Treatment |
|---|---|
| **Loading (first paint)** | Skeleton: shimmer blocks matching final layout (bars → grey bars, gauge → grey ring). No spinner-in-a-void. |
| **Refetch (filter change)** | Hold previous render at ~50% opacity — **no skeleton, no layout jump** (dataviz "refetch keeps the frame"). |
| **Empty (no data)** | Centered muted line + icon: e.g. "No access events yet" (a fresh upload) / "No numeric columns to chart". Never a blank box. |
| **`healthNarrative` null** | AI layer is optional/graceful (00-SPEC §8): show a neutral placeholder card "Narrative unavailable — scores below are computed deterministically." Never an error. |
| **Chart error** | Fallback to the table view of the same data + a quiet inline notice. Data is never lost behind a broken chart. |

---

## 6. Wireframes (ASCII)

### 6a. CatalogPage

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  assay                                                    [ ⤒ Upload dataset ]   ◐ theme │  ← top bar (56px)
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Catalog  ·  12 datasets                                                                │  h1 + count
│                                                                                        │
│  ┌── filter row (one row, above the table) ─────────────────────────────────────────┐ │
│  │ Sensitivity ▾   Recommendation ▾   Sort: Trust ↓ ▾            [ search datasets ] │ │  ← ?sensitivity ?recommendation ?sort
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │ NAME              ROWS   COLS  QUALITY▲▾ TRUST▲▾  VALUE▲▾  REC.      SENS   USAGE  UPLOADED │
│  ├────────────────────────────────────────────────────────────────────────────────┤  │
│  │ ▦ customers.csv   1,204   9    ◕ 92     ◕ 88     ◔ 71    ◉ KEEP    🛡HIGH  ╱╲__╱  3d ago  │
│  │ ▦ messy_orders…   8,530  14    ◔ 41     ◔ 38     ◑ 55    ⚙ OPTIM.  🛡MED   _╱╲__  1d ago  │
│  │ ▧ employees.xlsx    320  11    ◕ 84     ◕ 80     ◔ 22    ▤ ARCHIV. 🛡HIGH  ____╲  6d ago  │
│  │ ▦ events_log.csv 120,450 6     ◕ 90     ◕ 86     ◕ 95    ◉ KEEP    ○ NONE  ╱╱╱╱╱  2h ago  │
│  │ ▦ broken.csv        —     —    ⚠ FAILED — duplicate headers (hover for errorMessage)      │
│  │ ▦ ingest_now.csv    —     —    ⟳ PROCESSING …                                             │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                          (rows → click → DatasetDetailPage)             │
└──────────────────────────────────────────────────────────────────────────────────────┘
  Notes: score cells = inline mini-gauge (◔◑◕) + tabular numeral. Sort carets drive ?sort;
  aria-sort on header. Sensitivity = highest column level. Usage = 12-pt sparkline.
```

### 6b. DatasetDetailPage

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  ‹ Catalog                                                                    ◐ theme  │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  customers.csv                                              CSV · 1,204 rows · 9 cols  │  h1 + meta
│  originalFilename: customers.csv · 248 KB · uploaded 2026-07-18 · status READY         │  caption (ISO)
│                                                                                        │
│  ┌── SCORES (3 gauges — each a button → "explain this score") ───────────────────────┐ │
│  │      ╭───────╮          ╭───────╮          ╭───────╮                               │ │
│  │      │  92   │          │  88   │          │  71   │     [ ⓘ click a gauge to      │ │
│  │      │QUALITY│          │ TRUST │          │ VALUE │        see its breakdown ]     │ │
│  │      │●Good  │          │●Good  │          │●Fair  │  ← tier chip (status+icon+word)│ │
│  │      ╰───────╯          ╰───────╯          ╰───────╯                               │ │
│  │                                              Recommendation:  ◉ KEEP               │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                        ▲ click → ScoreBreakdown popover:               │
│                                        ┌─────────────────────────────┐                 │
│                                        │ Quality  92.0        ●Good   │                 │
│                                        │ Completeness 0.40×0.98 ▇▇▇▇▇ │                 │
│                                        │ Validity     0.30×0.91 ▇▇▇▇  │                 │
│                                        │ Uniqueness   0.30×0.85 ▇▇▇▇  │                 │
│                                        │ weights from config (§9)     │                 │
│                                        └─────────────────────────────┘                 │
│                                                                                        │
│  ┌── AI health narrative ───────────────────────────────────────────────────────────┐ │
│  │ ✦ "Clean customer table. Email, phone and name are HIGH-sensitivity PII and fully  │ │
│  │    classified. Low missingness; value is moderate — steady but not heavy usage."   │ │
│  │   (null → "Narrative unavailable — scores are computed deterministically.")        │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                        │
│  ┌── COLUMNS (9) ──────────────────────────────────────────────────┐  ┌── USAGE ────┐ │
│  │ #  NAME        TYPE     MISSING  DISTINCT  VALIDITY  SENSITIVITY  │  │  views/day  │ │
│  │ ───────────────────────────────────────────────────────────────  │  │   ╱╲        │ │
│  │ 0  id          INTEGER  ▏0%      1,204     100%      ○ NONE      ▸│  │  ╱  ╲╱╲     │ │
│  │ 1  email       STRING   ▏0%        1,204   99%       🛡 HIGH  ✎  ▾│  │ ╱      ╲__  │ │
│  │    ┌─ ColumnPanel (expanded) ──────────────────────────────────┐  │  │ 90d · crosshair│
│  │    │ email · STRING · pos 1        AUTO_REGEX · conf 0.98      │  │  └────────────┘ │
│  │    │ [ Category: EMAIL ▾ ] [ Sensitivity: HIGH ▾ ]  → PATCH    │  │  ┌── TREND ───┐ │
│  │    │ completeness 100%  validity 99%  distinct 1,204           │  │  │ Q/T/V 30d  │ │
│  │    │ missing ▏0%   histogram n/a (string) → top sampleValues   │  │  │ ╱╱╱ spark  │ │
│  │    │ quality checks: none                                       │  │  └────────────┘ │
│  │    └───────────────────────────────────────────────────────────┘  │                 │
│  │ 2  phone       STRING   ▎2%        1,180   96%       🛡 HIGH     ▸│                 │
│  │ 3  signup_date DATE     ▏0%          410   100%      ○ NONE      ▸│                 │
│  │ …                                                                 │                 │
│  └──────────────────────────────────────────────────────────────────┘                 │
│  Type distribution:  STRING ▇▇▇▇▇ 5  · INTEGER ▇▇ 2 · DATE ▇ 1 · FLOAT ▇ 1             │
└──────────────────────────────────────────────────────────────────────────────────────┘
  Notes: columns table rows expand in place (aria-expanded). ✎ = overridden tag.
  Missing shown as a magnitude meter; DATE/INTEGER histogram where numeric.
```

---

## 7. Interaction & motion

- **Hover** — table rows wash to `--accent` + `shadow-xs` (`--dur-fast`); marks lighten; gauge
  track lightens one step. Never a layout shift on hover (dimensions are reserved).
- **Row expand** — column rows expand the `ColumnPanel` in place, height auto-animated
  `--dur-base` `--ease-standard`; `aria-expanded` toggles; caret rotates. Only one panel open at a
  time keeps the page scannable.
- **Popover / panel open** — fade + 4px rise, `--dur-base`; focus moves in; `Esc`/outside-click
  closes and restores focus.
- **Gauge sweep** — animates 0→score on mount/route (`--dur-slow`); the breakdown bars grow with a
  40ms stagger. All disabled under reduced-motion.
- **Filters** — one row above the table; changing a filter refetches and **holds the frame**
  (previous rows at 50% opacity), never a skeleton flash. Sort toggles are instant, colour-stable.
- **Upload (drag-drop + progress)** — the primary ingestion affordance (`POST /datasets`):
  - Dropzone (`radius-xl`, dashed `--border`) → on drag-over, border → `--primary`, bg → `--accent`
    (`--dur-fast`). Accepts `.csv/.xlsx` only; wrong type → inline critical message, no upload.
  - On drop: filename chip + **determinate progress bar** (upload %) → switches to an
    **indeterminate "Profiling…"** state while the pipeline runs (parse → profile → classify →
    score), because processing is inline (00-SPEC §12, no job queue).
  - Success → toast + the new row appears in the catalog as `PROCESSING` then `READY`.
  - Failure (`broken.csv`, oversized) → the row lands `FAILED` with `errorMessage`; the dropzone
    shows a graceful critical state, never a stack trace. Nothing about a bad file breaks the view.

---

## 8. Accessibility

Target **WCAG 2.1 AA**. Colourblind-safe by construction (validated in §3).

- **Contrast** — see §3.5 (all computed): body/labels ≥ 4.5:1, UI/large ≥ 3:1, focus ring 4.3–4.8:1.
  `muted` ink (3.50/4.85) is restricted to meta/axis/large text — never body. The one sub-3:1 mark
  (status warning on light, 1.79) is legal only because it always ships with **icon + label**.
- **Colour is never the sole channel** — scores double-encode (arc sweep + ramp darkness + numeral);
  sensitivity/recommendation/severity always carry an **icon + word**; a **texture** fill (45°/135°
  hand-drawn, ordered by magnitude) is available under `forced-colors`, print, or an accessibility
  toggle. A **table view** exists for every chart.
- **Keyboard nav** — full tab order: filter row → table. Table is a roving-tabindex grid: `↑/↓`
  move rows, `Enter` opens detail, `→` expands a column row, `Space` on a gauge opens its breakdown.
  Sort headers are `<button>`s (`Enter/Space`). All popovers/dialogs are `Esc`-closable.
- **ARIA roles**
  - *Table:* native `<table>` with `<th scope="col">`; sortable headers carry
    `aria-sort="ascending|descending|none"`; expandable column rows use `aria-expanded` +
    `aria-controls` → the `ColumnPanel` (`role="region"`, `aria-label="{column} detail"`).
  - *Gauge:* `role="meter"` (or `img` with label) + `aria-valuenow`/`aria-valuemin=0`/
    `aria-valuemax=100` + `aria-label="Quality score 92 of 100, Good"`; when it acts as the
    breakdown trigger it is a `<button aria-haspopup="dialog">`.
  - *Breakdown popover:* `role="dialog"`, `aria-modal`, focus-trapped, labelled by the score name;
    the contribution bars have an adjacent visually-hidden text equivalent of each `weight × value`.
  - *Badges:* the status icon is `aria-hidden` (decorative); the **word** is the accessible name.
  - *Charts:* `role="img"` + `aria-label` summary, plus a keyboard-reachable "View as table" toggle;
    live-`aria-live="polite"` announces "Profiling complete" when a `PROCESSING` dataset turns `READY`.
- **Focus management** — visible 2px `--ring` focus on every interactive element (never
  `outline:none` without a replacement); opening a panel/dialog moves focus in, closing returns it
  to the trigger; the upload dropzone is focusable and drop-equivalent via a file `<input>`.
- **Motion** — `prefers-reduced-motion: reduce` zeroes all durations; gauges and bars render at
  final value; refetch still holds the frame (no motion needed).

---

## 9. Divergence from 00-SPEC

**None.** All entities, fields, enums (`Sensitivity`, `PiiCategory`, `ValueRecommendation`,
`DataType`, `QualityCheckType`, `Severity`, `TagSource`), scores (`qualityScore`/`trustScore`/
`valueScore`), the §9 formulas surfaced in §4.5, the value→recommendation mapping, the pages
(`CatalogPage`, `DatasetDetailPage`), and the API routes referenced here are used exactly as
defined in `00-SPEC.md`. This doc only adds *visual/interaction* treatment (colour scales,
tokens, wireframes) — no new domain concepts, no renamed fields. Where 00-SPEC is silent (e.g.
the colour of a sensitivity level), choices follow the `dataviz` skill and are marked as such.
```
