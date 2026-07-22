# Product

## Register

product

## Platform

web

## Users

Data stewards and data owners working a governance backlog. They arrive with a
catalog of datasets somebody else uploaded and one question per row: *can I
trust this, and is anyone actually using it?* Their context is a work session at
a desk, moving fast across many datasets and then slowly through one — the shape
of every screen is **scan → drill → explain**. The job to be done is triage: find
the datasets that are unreliable, over-exposed, or dead weight, decide what
happens to each, and be able to defend that decision to somebody who asks why.

A second audience reads the same surface differently: technical reviewers
assessing how the system was built (`docs/00-SPEC.md` §1 names them explicitly).
They are not triaging data — they are auditing judgment. Settings, the score
breakdowns, and the System panel exist partly for them, which is why every
weight and threshold is visible and editable rather than buried in a config file.

## Product Purpose

`assay` turns a raw file into a governed catalog entry. Upload a CSV or XLSX and
it profiles every column's type and completeness, classifies sensitive fields
(email, phone, national ID, card, DOB, name, address) by header and value
pattern, and scores the dataset three separate ways — Quality, Trust, Value —
each on 0–100 with a Keep / Optimize / Archive / Retire recommendation attached.

The distinction the product exists to make is that those three are not the same
question. Trust is a superset of Quality: a clean, fully-classified dataset earns
it. Value is orthogonal to both, derived only from access frequency, recency and
trend. That separation is what lets the catalog surface a pristine table nobody
queries as a `RETIRE` candidate. Success is a steward looking at the Overview,
knowing within seconds which datasets need them today, and being able to open any
score and see the exact sub-scores and weights that produced it.

## Positioning

The governance catalog where every number can be interrogated: Quality, Trust and
Value are scored on independent inputs and each one opens to show its own
arithmetic.

## Brand Personality

Calm, exact, quiet. A precision instrument rather than a product with opinions
about itself. The voice in the interface is plain and specific — it names what a
control does, states what a limit is, and explains a refusal where the reader can
act on it ("Enter it under Data → Admin token", "These weights sum to 0.950. They
must sum to 1.000 for the score to stay on a 0–100 scale"). It never oversells,
never uses exclamation, and never says "oops". Empty and failed states teach
rather than apologize. The feeling to evoke is confidence under scrutiny: this
thing was built by someone who expected to be asked how it works.

## Anti-references

Not a marketing surface. No hero copy, no oversized display type, no eyebrow
kickers, no numbered section scaffolding, no testimonial or logo strip anywhere
in the app shell.

Not a generated-looking analytics template: no purple gradients, no gradient
text, no glow, no decorative blobs, no cards inside cards, no identical
icon-heading-paragraph card grids. Colour never decorates.

Not a black-box scorer. Any number that cannot be opened and explained is a
regression, not a simplification.

Not a playful or neon "data tool" — no rainbow categorical palettes on ordered
data, no emoji status, no bouncing or elastic motion, no orchestrated page-load
choreography that makes a steward wait to start reading.

## Design Principles

**Every score explains itself.** The circular gauge is a button; it opens the
weighted breakdown wired to the stored `scoreBreakdown`. Transparency is the
product, not a feature of it.

**Colour only where it encodes.** One restrained blue is the brand hue and it
marks primary action, current selection and state. Everything else structural is
neutral. The score ramp and the status hues are data, not decoration, and they
are the only saturated colour on a screen.

**Never colour alone.** Sensitivity, recommendation and severity always ship an
icon and a word; scores double-encode as arc sweep plus ramp darkness plus
numeral. The interface has to survive greyscale and colour-vision deficiency
without losing a single reading.

**Degradation is designed, not discovered.** `PROCESSING`, `FAILED`, an empty
catalog, a cold-start API, a missing AI layer and an unset admin token each have
a drawn state with a next action. Nothing is allowed to render as a blank box or
a spinner in a void.

**Tight core over more surface.** A smaller set of screens done exactly beats a
larger set done approximately. New scope has to displace something, not sit
beside it.

## Accessibility & Inclusion

Target WCAG 2.1 AA, with contrast computed rather than eyeballed
(`docs/05-DESIGN-SYSTEM.md` §3.5 carries the table for both themes). Body and
label ink clears 4.5:1; UI and large text clear 3:1; the muted ink ramp is
restricted to meta, axis and caption use and never carries body copy. The one
sub-3:1 mark in the system — status warning on the light canvas — is only legal
because it never appears without its icon and word.

Colourblind-safe by construction: sequential single-hue ramp for magnitude,
categorical status hues used only for genuinely categorical entities, and an
icon plus word on every status.

Reduced motion has two triggers, not one: the OS setting and an in-app override
under Settings → Appearance, for readers on a shared or managed machine who
cannot change the system preference. Both collapse every duration to zero and
render gauges and bars at their final value. The cursor spotlight additionally
requires a fine hover pointer, so touch never pays for it.

Keyboard reach is complete: visible 2px focus rings on every interactive element,
sortable table headers as real buttons carrying `aria-sort`, `Esc`-closable
popovers that return focus to their trigger, native radio and checkbox semantics
behind the segmented controls and switches, and live regions announcing upload
progress and completion.
