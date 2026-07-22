// Settings (R3) — the one place every tunable in assay is visible and editable.
//
// Two very different kinds of setting share this page, and the split is deliberate:
//   • Appearance is device-local (lib/preferences → localStorage) and applies on the keystroke.
//     There is nothing to save, so there is no Save button for it.
//   • Everything else is catalog-wide state behind /api/settings, so it is edited as a *draft*
//     and committed together. Only the top-level keys that actually changed are PATCHed, which
//     keeps the API's `overridden` list an honest answer to "what have we tuned?".
//
// The weight sets must sum to 1.0 or the score leaves 0–100, so the same rule the server enforces
// (services/settings.ts) is mirrored here and shown live: a running Σ per group, an inline reason,
// and a Save that is genuinely disabled — never a round-trip to be told what we already knew.
//
// Numeric drafts are held as STRINGS. Parsing on every keystroke means typing "0." or clearing a
// field fights the user (Number("0.") === 0 re-renders as "0" and eats the dot); strings are
// parsed once, at validation.
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  ChevronDown,
  Database,
  Download,
  ExternalLink,
  FileUp,
  KeyRound,
  Loader2,
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldHalf,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type {
  AppSettings,
  AppSettingsKey,
  AppSettingsPatch,
  DatasetSummary,
  PiiCategory,
  Sensitivity,
  ValueRecommendation,
} from "@assay/shared";
import { StatusPill } from "@/components/dataset/SensitivityBadge";
import {
  ApiClientError,
  listDatasets,
  setAdminToken,
  useAdminToken,
  useDeleteAllDatasets,
  usePatchSettings,
  useRecomputeScores,
  useReseedDemoData,
  useResetSettings,
  useSettings,
  useSystem,
} from "@/lib/api";
import { formatBytes, formatCount, relativeTime } from "@/lib/format";
import { springs, useReduceMotion } from "@/lib/motion";
import {
  resetPreferences,
  setPreference,
  usePreferences,
  type DensityPreference,
  type MotionPreference,
  type ThemePreference,
} from "@/lib/preferences";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const GLASS_CARD = "glass rounded-xl border border-[color:var(--glass-border)]";
const HAIRLINE = "border-[color:var(--glass-border)]";
const CAPTION = "text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";
const FIELD =
  "h-9 rounded-lg border border-[color:var(--glass-border)] bg-background/35 px-2.5 text-[13px] text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const BTN =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-[color:var(--glass-border)] bg-background/35 px-3 text-[13px] font-medium text-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";
const BTN_PRIMARY =
  "inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground outline-none transition-[opacity,transform] duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";

const REPO_URL = "https://github.com/rxits/assay";
const DOCS_URL = `${REPO_URL}/tree/main/docs`;

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "scoring", label: "Scoring", icon: SlidersHorizontal },
  { id: "classification", label: "Classification", icon: ShieldHalf },
  { id: "ingestion", label: "Ingestion", icon: FileUp },
  { id: "data", label: "Data", icon: Database },
  { id: "system", label: "System", icon: Activity },
] as const;

const SENSITIVITIES: Sensitivity[] = ["NONE", "LOW", "MEDIUM", "HIGH"];

/** "classificationCoverage" → "Classification coverage". Field names are already the vocabulary. */
const humanize = (k: string): string =>
  k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

// ---- Draft model ---------------------------------------------------------

type NumStr<T> = { [K in keyof T]: string };

interface Draft {
  quality: NumStr<AppSettings["quality"]>;
  trust: NumStr<AppSettings["trust"]>;
  value: NumStr<AppSettings["value"]>;
  recommend: NumStr<AppSettings["recommend"]>;
  /** A range input can only ever produce a valid number, so this one stays numeric. */
  classifyThreshold: number;
  freqCap: string;
  halfLifeDays: string;
  sensitivity: Record<PiiCategory, Sensitivity>;
}

const WEIGHT_GROUPS = ["quality", "trust", "value"] as const;
type WeightGroup = (typeof WEIGHT_GROUPS)[number];

// `object`, not `Record<string, number>`: the weight/threshold types are interfaces, and an
// interface has no index signature, so it is not assignable to Record<string, number>.
const strs = <T extends object>(o: T): NumStr<T> =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) as NumStr<T>;

function toDraft(s: AppSettings): Draft {
  return {
    quality: strs(s.quality),
    trust: strs(s.trust),
    value: strs(s.value),
    recommend: strs(s.recommend),
    classifyThreshold: s.classifyThreshold,
    freqCap: String(s.freqCap),
    halfLifeDays: String(s.halfLifeDays),
    sensitivity: { ...s.sensitivity },
  };
}

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));

interface Validation {
  /** The draft as settings — null while anything is invalid, so Save cannot fire. */
  next: AppSettings | null;
  /** Field path ("quality.validity") or group key ("quality") → the reason. */
  errors: Record<string, string>;
  sums: Record<WeightGroup, number>;
}

/**
 * Mirrors apps/api/src/services/settings.ts `settingsPatchSchema` — bounds, the sum-to-1 rule and
 * the ascending-cutoffs rule. Kept in sync by hand rather than shared: the server owns the truth
 * and still rejects a bad body; this exists so the UI can say why *before* the round trip.
 */
function validate(d: Draft): Validation {
  const errors: Record<string, string> = {};
  const sums = { quality: 0, trust: 0, value: 0 } as Record<WeightGroup, number>;
  const weights = {} as Record<WeightGroup, Record<string, number>>;

  for (const g of WEIGHT_GROUPS) {
    const entries = Object.entries(d[g]).map(([k, v]) => [k, num(v)] as const);
    let sum = 0;
    let sane = true;
    for (const [k, v] of entries) {
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        errors[`${g}.${k}`] = "Each weight is between 0 and 1.";
        sane = false;
      } else sum += v;
    }
    sums[g] = sum;
    weights[g] = Object.fromEntries(entries);
    if (sane && Math.abs(sum - 1) > 0.001) {
      errors[g] = `These weights sum to ${sum.toFixed(3)}. They must sum to 1.000 for the score to stay on a 0–100 scale.`;
    }
  }

  const freqCap = num(d.freqCap);
  if (!Number.isInteger(freqCap) || freqCap < 1 || freqCap > 100_000) {
    errors.freqCap = "A whole number between 1 and 100,000.";
  }
  const halfLifeDays = num(d.halfLifeDays);
  if (!Number.isFinite(halfLifeDays) || halfLifeDays < 0.5 || halfLifeDays > 3650) {
    errors.halfLifeDays = "Between 0.5 and 3,650 days.";
  }

  // Keys originate from the draft, which was built from AppSettings, so the shape is known-good.
  // The double assertion is only needed because Object.fromEntries widens to an index signature.
  const recommend = Object.fromEntries(
    Object.entries(d.recommend).map(([k, v]) => [k, num(v)]),
  ) as unknown as AppSettings["recommend"];
  for (const [k, v] of Object.entries(recommend)) {
    if (!Number.isFinite(v) || v < 0 || v > 100) errors[`recommend.${k}`] = "A score between 0 and 100.";
  }
  if (
    !errors["recommend.retireBelow"] &&
    !errors["recommend.archiveBelow"] &&
    !errors["recommend.optimizeBelow"] &&
    !(recommend.retireBelow <= recommend.archiveBelow && recommend.archiveBelow <= recommend.optimizeBelow)
  ) {
    // Bands are first-match-wins, so an out-of-order set makes one silently unreachable.
    errors.recommend = "Cutoffs must ascend: RETIRE ≤ ARCHIVE ≤ OPTIMIZE.";
  }

  if (Object.keys(errors).length > 0) return { next: null, errors, sums };
  return {
    next: {
      // Same widening as `recommend` above: keys come from WEIGHT_GROUPS over the typed draft.
      quality: weights.quality as unknown as AppSettings["quality"],
      trust: weights.trust as unknown as AppSettings["trust"],
      value: weights.value as unknown as AppSettings["value"],
      classifyThreshold: d.classifyThreshold,
      freqCap,
      halfLifeDays,
      recommend,
      sensitivity: d.sensitivity,
    },
    errors,
    sums,
  };
}

const SETTINGS_KEYS: AppSettingsKey[] = [
  "quality", "trust", "value", "classifyThreshold", "freqCap", "halfLifeDays", "recommend", "sensitivity",
];

/** Only the top-level keys that actually differ — an untouched key stays un-overridden. */
function diffPatch(next: AppSettings, current: AppSettings): AppSettingsPatch {
  const patch: Record<string, unknown> = {};
  for (const k of SETTINGS_KEYS) {
    if (JSON.stringify(next[k]) !== JSON.stringify(current[k])) patch[k] = next[k];
  }
  return patch as AppSettingsPatch;
}

// ---- Page ----------------------------------------------------------------

export function SettingsPage() {
  const settingsQ = useSettings();
  const server = settingsQ.data;
  const [draft, setDraft] = useState<Draft | null>(null);
  const active = useActiveSection();

  // Seed once, then only on an explicit save/reset (below). A background refetch must never
  // overwrite what someone is halfway through typing.
  useEffect(() => {
    if (server && !draft) setDraft(toDraft(server.settings));
  }, [server, draft]);

  const validation = useMemo(() => (draft ? validate(draft) : null), [draft]);
  const dirty =
    !!draft && !!server && JSON.stringify(draft) !== JSON.stringify(toDraft(server.settings));

  const patchM = usePatchSettings();
  const resetM = useResetSettings();
  const adopt = (s: AppSettings) => setDraft(toDraft(s));

  function save() {
    if (!validation?.next || !server) return;
    patchM.mutate(diffPatch(validation.next, server.settings), {
      onSuccess: (data) => {
        adopt(data.settings);
        toast("Settings saved. Run “Recompute all scores” to apply them to the existing catalog.");
      },
    });
  }

  function resetToDefaults() {
    resetM.mutate(undefined, {
      onSuccess: (data) => {
        adopt(data.settings);
        toast("Settings reset to defaults.");
      },
    });
  }

  const update = (fn: (d: Draft) => Draft) => setDraft((d) => (d ? fn(d) : d));

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 md:px-8">
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 max-w-prose text-pretty text-[13px] text-muted-foreground">
          How assay looks on this device, and how it scores, classifies and ingests every dataset in
          the catalog.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[168px_minmax(0,1fr)] lg:gap-10">
        <SectionNav active={active} />

        <div className="flex min-w-0 flex-col gap-8">
          <AppearanceSection />

          {settingsQ.isLoading && <SettingsSkeleton />}
          {settingsQ.isError && (
            <ErrorCard
              message={
                settingsQ.error instanceof Error ? settingsQ.error.message : "Couldn't load settings."
              }
              onRetry={() => void settingsQ.refetch()}
            />
          )}

          {draft && server && validation && (
            <>
              <ScoringSection
                draft={draft}
                validation={validation}
                overridden={server.overridden}
                updatedAt={server.updatedAt}
                update={update}
                onReset={resetToDefaults}
                resetting={resetM.isPending}
                resetError={resetM.error}
              />
              <ClassificationSection
                draft={draft}
                overridden={server.overridden}
                defaults={server.defaults}
                update={update}
              />
            </>
          )}

          <IngestionSection />
          <DataSection />
          <SystemSection />

          <SaveBar
            dirty={dirty}
            blocked={!!validation && Object.keys(validation.errors).length > 0}
            saving={patchM.isPending}
            error={patchM.isError ? actionErrorText(patchM.error) : null}
            onSave={save}
            onDiscard={() => server && adopt(server.settings)}
          />
        </div>
      </div>
    </div>
  );
}

const errorText = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong.");

/**
 * The admin gate's 401 is the one failure on this page the reader can actually fix, so it gets
 * a pointer to the field instead of a bare refusal. Its 403 (no ADMIN_TOKEN on the API at all)
 * already explains itself and has no client-side fix, so it passes through untouched.
 */
const actionErrorText = (e: unknown): string =>
  e instanceof ApiClientError && e.code === "admin_token_required"
    ? `${e.message} Enter it under Data → Admin token.`
    : errorText(e);

/** A refused action says so where its button is: a toast can be missed or land off-screen. */
function ActionError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="mt-2 flex w-full items-start gap-1.5 text-pretty text-[12px] leading-relaxed text-[color:var(--status-critical)]"
    >
      <TriangleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      {actionErrorText(error)}
    </p>
  );
}

/** Highlights the section the reader is actually looking at. No-ops where IO is unavailable. */
function useActiveSection(): string {
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.add(e.target.id);
          else visible.delete(e.target.id);
        }
        // The topmost section touching the band under the app bar wins.
        const first = SECTIONS.find((s) => visible.has(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-80px 0px -55% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, []);
  return active;
}

function SectionNav({ active }: { active: string }) {
  const reduce = useReduceMotion();
  return (
    <nav aria-label="Settings sections" className="hidden lg:block">
      <ul className="sticky top-[4.5rem] flex flex-col gap-0.5">
        {SECTIONS.map((s) => {
          const on = active === s.id;
          return (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                aria-current={on ? "true" : undefined}
                className="group relative flex h-9 items-center gap-2.5 rounded-lg px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {on && (
                  <motion.span
                    layoutId="settings-section"
                    aria-hidden="true"
                    transition={reduce ? { duration: 0 } : springs.snappy}
                    className={cn("absolute inset-0 rounded-lg bg-accent ring-1 ring-inset", HAIRLINE)}
                  />
                )}
                <s.icon
                  aria-hidden="true"
                  strokeWidth={2.1}
                  className={cn(
                    "relative z-10 h-4 w-4 shrink-0 transition-colors",
                    on ? "text-primary" : "text-muted-foreground group-hover:text-foreground",
                  )}
                />
                <span
                  className={cn(
                    "relative z-10 text-[13px] font-medium transition-colors",
                    on ? "text-foreground" : "text-muted-foreground group-hover:text-foreground",
                  )}
                >
                  {s.label}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// ---- Section / row primitives -------------------------------------------

function Section({
  id,
  icon: Icon,
  title,
  description,
  aside,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    // tabIndex={-1} so an anchor jump moves focus here, not just the scroll position.
    <section id={id} tabIndex={-1} aria-labelledby={`${id}-heading`} className="scroll-mt-20 outline-none">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div className="flex items-center gap-2">
          <Icon aria-hidden="true" className="h-4 w-4 text-muted-foreground" strokeWidth={2.1} />
          <h2 id={`${id}-heading`} className="text-[15px] font-semibold tracking-tight text-foreground">
            {title}
          </h2>
        </div>
        {aside}
      </div>
      {description && (
        <p className="mb-2.5 max-w-prose text-pretty text-[12.5px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}) {
  const text = "text-[13.5px] font-medium text-foreground";
  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2.5 border-b px-4 py-3.5 last:border-0",
        HAIRLINE,
      )}
    >
      <div className="min-w-0">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={cn(text, "cursor-pointer")}>
            {label}
          </label>
        ) : (
          <span className={text}>{label}</span>
        )}
        {hint && (
          <p className="mt-0.5 max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** A value the API owns and the UI may not change — stated as data, not as a dead input. */
function ReadRow({ label, hint, value }: { label: string; hint?: ReactNode; value: ReactNode }) {
  return (
    <Row label={label} hint={hint}>
      <span className="text-[13px] tabular-nums text-foreground">{value}</span>
    </Row>
  );
}

function OverriddenChip({ keys }: { keys: AppSettingsKey[] }) {
  if (keys.length === 0) return null;
  return (
    <span
      title={`Overridden: ${keys.join(", ")}`}
      className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/[0.07] px-2 py-0.5 text-[11px] font-medium text-foreground"
    >
      {keys.length} override{keys.length === 1 ? "" : "s"}
    </span>
  );
}

// ---- Controls ------------------------------------------------------------

interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * Segmented control built on a real radio group: arrow-key navigation, grouping semantics and
 * focus all come from the platform. Only the selected wash is ours, and it rides a shared
 * layoutId so it springs between segments — the same language as the shell's nav rail.
 */
function Segmented<T extends string>({
  name,
  legend,
  value,
  options,
  onChange,
}: {
  name: string;
  legend: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (v: T) => void;
}) {
  const reduce = useReduceMotion();
  return (
    <fieldset className={cn("inline-flex rounded-lg border bg-background/35 p-0.5", HAIRLINE)}>
      <legend className="sr-only">{legend}</legend>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <label key={o.value} className="relative cursor-pointer">
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={on}
              onChange={() => onChange(o.value)}
              className="peer sr-only"
            />
            {on && (
              <motion.span
                layoutId={`segment-${name}`}
                aria-hidden="true"
                transition={reduce ? { duration: 0 } : springs.snappy}
                className={cn("absolute inset-0 rounded-md bg-accent ring-1 ring-inset", HAIRLINE)}
              />
            )}
            <span
              className={cn(
                "relative z-10 flex h-8 items-center rounded-md px-3 text-[13px] font-medium transition-colors",
                "peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

/** A checkbox with role="switch" — real checked state, real keyboard, our paint. */
function Switch({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    // -m-2/p-2 grows the hit area to ~40px without changing the drawn size.
    <label htmlFor={id} className="relative -m-2 inline-flex cursor-pointer items-center p-2">
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          "h-6 w-11 rounded-full bg-muted ring-1 ring-inset transition-colors duration-150",
          "ring-[color:var(--glass-border)] peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
        )}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-muted-foreground transition-[transform,background-color] duration-150 peer-checked:translate-x-5 peer-checked:bg-primary-foreground"
      />
    </label>
  );
}

function Select({
  id,
  value,
  onChange,
  active,
  label,
  children,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  active?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        id={id}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          FIELD,
          "cursor-pointer appearance-none pr-7 font-medium",
          active && "border-primary/25 bg-primary/[0.07]",
        )}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

function NumberField({
  id,
  value,
  onChange,
  invalid,
  describedBy,
  step,
  min,
  max,
  width = "w-[5.5rem]",
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  describedBy?: string;
  step: number;
  min: number;
  max: number;
  width?: string;
}) {
  return (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      value={value}
      step={step}
      min={min}
      max={max}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        FIELD,
        width,
        "text-right tabular-nums",
        invalid && "border-[color:var(--status-critical)] bg-[color:var(--status-critical)]/[0.06]",
      )}
    />
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    // status, not alert: this text changes on every keystroke and alert would interrupt each time.
    <p
      id={id}
      role="status"
      className="mt-2 flex items-start gap-1.5 text-pretty text-[12px] leading-relaxed text-[color:var(--status-critical)]"
    >
      <TriangleAlert aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
      {children}
    </p>
  );
}

/** Destructive-but-recoverable actions get inline friction rather than a modal. */
function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  busy,
  icon: Icon,
  className,
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  busy?: boolean;
  icon: LucideIcon;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          if (armed) {
            setArmed(false);
            onConfirm();
          } else setArmed(true);
        }}
        className={cn(BTN, armed && "border-[color:var(--status-critical)] text-[color:var(--status-critical)]", className)}
      >
        {busy ? <Spinner /> : <Icon aria-hidden="true" className="h-3.5 w-3.5" />}
        {armed ? confirmLabel : children}
      </button>
      {armed && (
        <button
          type="button"
          onClick={() => setArmed(false)}
          className="rounded-md px-1.5 py-1 text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Cancel
        </button>
      )}
    </span>
  );
}

function Spinner() {
  return <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />;
}

// ---- Appearance ----------------------------------------------------------

const THEMES: Option<ThemePreference>[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];
const DENSITIES: Option<DensityPreference>[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];
const MOTIONS: Option<MotionPreference>[] = [
  { value: "system", label: "System" },
  { value: "reduced", label: "Reduced" },
];

function AppearanceSection() {
  const prefs = usePreferences();
  const spotlightId = useId();

  return (
    <Section
      id="appearance"
      icon={Palette}
      title="Appearance"
      description="Stored on this device only — nothing here touches the catalog or other people's sessions. Every change applies immediately."
      aside={
        <button
          type="button"
          onClick={() => {
            resetPreferences();
            toast("Appearance reset to defaults.");
          }}
          className="rounded-md px-1.5 py-1 text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          Reset appearance
        </button>
      }
    >
      <div className={GLASS_CARD}>
        <Row label="Theme" hint="“System” follows your OS and keeps following it as it changes.">
          <Segmented
            name="theme"
            legend="Theme"
            value={prefs.theme}
            options={THEMES}
            onChange={(v) => setPreference("theme", v)}
          />
        </Row>
        <Row label="Table density" hint="Compact tightens catalog rows without shrinking any hit area below 32px.">
          <Segmented
            name="density"
            legend="Table density"
            value={prefs.density}
            options={DENSITIES}
            onChange={(v) => setPreference("density", v)}
          />
        </Row>
        <Row
          label="Motion"
          hint="“Reduced” stills every animation in the app. It is an override on top of your OS setting, never a way to switch motion back on."
        >
          <Segmented
            name="motion"
            legend="Motion"
            value={prefs.motion}
            options={MOTIONS}
            onChange={(v) => setPreference("motion", v)}
          />
        </Row>
        <Row
          label="Cursor spotlight"
          hint="A faint glow that follows the pointer. Off automatically on touch devices and under reduced motion."
          htmlFor={spotlightId}
        >
          <Switch
            id={spotlightId}
            checked={prefs.spotlight}
            onChange={(v) => setPreference("spotlight", v)}
          />
        </Row>
      </div>
    </Section>
  );
}

// ---- Scoring -------------------------------------------------------------

const SCORING_KEYS: AppSettingsKey[] = ["quality", "trust", "value", "freqCap", "halfLifeDays", "recommend"];

const WEIGHT_COPY: Record<WeightGroup, { title: string; hint: string }> = {
  quality: { title: "Quality weights", hint: "How much each profiling signal contributes to the Quality score." },
  trust: { title: "Trust weights", hint: "Trust folds Quality back in alongside type consistency and how much of the dataset is classified." },
  value: { title: "Value weights", hint: "Value is derived from access events: how often, how recently, and which way the trend is going." },
};

function ScoringSection({
  draft,
  validation,
  overridden,
  updatedAt,
  update,
  onReset,
  resetting,
  resetError,
}: {
  draft: Draft;
  validation: Validation;
  overridden: AppSettingsKey[];
  updatedAt: string | null;
  update: (fn: (d: Draft) => Draft) => void;
  onReset: () => void;
  resetting: boolean;
  resetError: unknown;
}) {
  const recomputeM = useRecomputeScores();
  const freqId = useId();
  const halfLifeId = useId();
  const { errors } = validation;

  return (
    <Section
      id="scoring"
      icon={SlidersHorizontal}
      title="Scoring & thresholds"
      description={
        <>
          The weights behind every Quality, Trust and Value score in the catalog. Saving stores them;
          existing datasets keep their current scores until you recompute.
          {updatedAt && <> Last changed {relativeTime(updatedAt)}.</>}
        </>
      }
      aside={<OverriddenChip keys={overridden.filter((k) => SCORING_KEYS.includes(k))} />}
    >
      <div className={GLASS_CARD}>
        {WEIGHT_GROUPS.map((g) => (
          <WeightSet
            key={g}
            group={g}
            values={draft[g]}
            sum={validation.sums[g]}
            error={errors[g]}
            errors={errors}
            onChange={(k, v) => update((d) => ({ ...d, [g]: { ...d[g], [k]: v } }))}
          />
        ))}

        <Row
          label="Frequency cap"
          hint="The access count at which the Frequency input saturates — a dataset read this often scores full marks."
          htmlFor={freqId}
        >
          <div className="flex flex-col items-end">
            <NumberField
              id={freqId}
              value={draft.freqCap}
              step={1}
              min={1}
              max={100000}
              invalid={!!errors.freqCap}
              describedBy={errors.freqCap ? `${freqId}-err` : undefined}
              onChange={(v) => update((d) => ({ ...d, freqCap: v }))}
            />
            {errors.freqCap && <FieldError id={`${freqId}-err`}>{errors.freqCap}</FieldError>}
          </div>
        </Row>

        <Row
          label="Recency half-life"
          hint="Days after which an unread dataset's Recency input has decayed by half."
          htmlFor={halfLifeId}
        >
          <div className="flex flex-col items-end">
            <div className="flex items-center gap-2">
              <NumberField
                id={halfLifeId}
                value={draft.halfLifeDays}
                step={1}
                min={0.5}
                max={3650}
                invalid={!!errors.halfLifeDays}
                describedBy={errors.halfLifeDays ? `${halfLifeId}-err` : undefined}
                onChange={(v) => update((d) => ({ ...d, halfLifeDays: v }))}
              />
              <span className="text-[12px] text-muted-foreground">days</span>
            </div>
            {errors.halfLifeDays && <FieldError id={`${halfLifeId}-err`}>{errors.halfLifeDays}</FieldError>}
          </div>
        </Row>

        <Cutoffs draft={draft} errors={errors} update={update} />

        <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
          <button
            type="button"
            disabled={recomputeM.isPending}
            onClick={() =>
              recomputeM.mutate(undefined, {
                onSuccess: (r) =>
                  toast(
                    `Rescored ${formatCount(r.updated)} dataset${r.updated === 1 ? "" : "s"}` +
                      (r.tagsUpdated ? ` · ${formatCount(r.tagsUpdated)} tags remapped` : "") +
                      (r.skipped ? ` · ${formatCount(r.skipped)} skipped` : ""),
                  ),
                // Failures are reported inline below, not as a toast — see <ActionError>.
              })
            }
            className={BTN_PRIMARY}
          >
            {recomputeM.isPending ? <Spinner /> : <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
            {recomputeM.isPending ? "Recomputing…" : "Recompute all scores"}
          </button>

          <ConfirmButton
            icon={RotateCcw}
            confirmLabel="Reset every setting?"
            onConfirm={onReset}
            busy={resetting}
          >
            Reset to defaults
          </ConfirmButton>

          <p className="w-full text-pretty text-[12px] leading-relaxed text-muted-foreground sm:w-auto sm:flex-1">
            Recompute re-weights the stored profile of every dataset and re-derives Value from its
            access events. Datasets that never produced scores (failed or still processing) are
            skipped rather than invented.
          </p>

          <ActionError error={recomputeM.error} />
          <ActionError error={resetError} />
        </div>
      </div>
    </Section>
  );
}

function WeightSet({
  group,
  values,
  sum,
  error,
  errors,
  onChange,
}: {
  group: WeightGroup;
  values: Record<string, string>;
  sum: number;
  error?: string;
  errors: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const copy = WEIGHT_COPY[group];
  const errId = `${group}-sum-error`;
  const ok = !error;
  return (
    <div className={cn("border-b px-4 py-3.5 last:border-0", HAIRLINE)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-[13.5px] font-medium text-foreground">{copy.title}</span>
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium tabular-nums"
          style={{
            background: `color-mix(in srgb, var(${ok ? "--status-good" : "--status-critical"}) 12%, hsl(var(--card)))`,
            borderColor: `color-mix(in srgb, var(${ok ? "--status-good" : "--status-critical"}) 24%, transparent)`,
          }}
        >
          <span className="text-muted-foreground">Σ</span>
          {Number.isFinite(sum) ? sum.toFixed(3) : "—"}
        </span>
      </div>
      <p className="mt-0.5 max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground">
        {copy.hint}
      </p>
      <div className="mt-2.5 flex flex-wrap gap-3">
        {Object.entries(values).map(([k, v]) => {
          const id = `${group}-${k}`;
          const fieldInvalid = !!errors[`${group}.${k}`];
          return (
            <div key={k} className="flex flex-col gap-1">
              <label htmlFor={id} className={CAPTION}>
                {humanize(k)}
              </label>
              <NumberField
                id={id}
                value={v}
                step={0.05}
                min={0}
                max={1}
                invalid={fieldInvalid || !ok}
                describedBy={error ? errId : undefined}
                onChange={(nv) => onChange(k, nv)}
              />
            </div>
          );
        })}
      </div>
      {error && <FieldError id={errId}>{error}</FieldError>}
    </div>
  );
}

// Recommendation bands are first-match-wins over 0–100, so three bare numbers say very little.
// The strip is the same colour vocabulary the RecommendationBadge uses, so a band and its badge
// are recognisably the same thing.
const BAND_TONE: Record<ValueRecommendation, string> = {
  RETIRE: "--status-critical",
  ARCHIVE: "--status-muted",
  OPTIMIZE: "--status-warning",
  KEEP: "--status-good",
};

function Cutoffs({
  draft,
  errors,
  update,
}: {
  draft: Draft;
  errors: Record<string, string>;
  update: (fn: (d: Draft) => Draft) => void;
}) {
  const bands = useMemo(() => {
    const r = num(draft.recommend.retireBelow);
    const a = num(draft.recommend.archiveBelow);
    const o = num(draft.recommend.optimizeBelow);
    if (![r, a, o].every((n) => Number.isFinite(n) && n >= 0 && n <= 100)) return null;
    if (!(r <= a && a <= o)) return null;
    return [
      { label: "RETIRE" as const, from: 0, to: r },
      { label: "ARCHIVE" as const, from: r, to: a },
      { label: "OPTIMIZE" as const, from: a, to: o },
      { label: "KEEP" as const, from: o, to: 100 },
    ];
  }, [draft.recommend]);

  return (
    <div className={cn("border-b px-4 py-3.5 last:border-0", HAIRLINE)}>
      <span className="text-[13.5px] font-medium text-foreground">Recommendation cutoffs</span>
      <p className="mt-0.5 max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground">
        The Value score below which a dataset earns each recommendation. Checked in order, so they
        must ascend.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-3">
        {Object.entries(draft.recommend).map(([k, v]) => {
          const id = `recommend-${k}`;
          return (
            <div key={k} className="flex flex-col gap-1">
              <label htmlFor={id} className={CAPTION}>
                {humanize(k)}
              </label>
              <NumberField
                id={id}
                value={v}
                step={1}
                min={0}
                max={100}
                invalid={!!errors[`recommend.${k}`] || !!errors.recommend}
                describedBy={errors.recommend ? "recommend-error" : undefined}
                onChange={(nv) => update((d) => ({ ...d, recommend: { ...d.recommend, [k]: nv } }))}
              />
            </div>
          );
        })}
      </div>

      {bands && (
        <div className="mt-3">
          <div className="flex h-2 w-full overflow-hidden rounded-full" aria-hidden="true">
            {bands.map((b) => (
              <span
                key={b.label}
                style={{ width: `${b.to - b.from}%`, background: `var(${BAND_TONE[b.label]})` }}
                className="h-full"
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11.5px] tabular-nums text-muted-foreground">
            {bands
              .filter((b) => b.to > b.from)
              .map((b) => `${b.label} ${b.from}–${b.to}`)
              .join("  ·  ")}
          </p>
        </div>
      )}
      {errors.recommend && <FieldError id="recommend-error">{errors.recommend}</FieldError>}
    </div>
  );
}

// ---- Classification ------------------------------------------------------

const CLASSIFY_KEYS: AppSettingsKey[] = ["classifyThreshold", "sensitivity"];

function ClassificationSection({
  draft,
  defaults,
  overridden,
  update,
}: {
  draft: Draft;
  defaults: AppSettings;
  overridden: AppSettingsKey[];
  update: (fn: (d: Draft) => Draft) => void;
}) {
  const systemQ = useSystem();
  const llm = systemQ.data?.llm;
  const thresholdId = useId();

  return (
    <Section
      id="classification"
      icon={ShieldHalf}
      title="Classification"
      description="How columns are matched to PII categories, and how sensitive each category is considered to be."
      aside={<OverriddenChip keys={overridden.filter((k) => CLASSIFY_KEYS.includes(k))} />}
    >
      <div className={GLASS_CARD}>
        <Row
          label="Match threshold"
          hint="The share of a column's sampled values that must match a pattern before the column is classified. Applies to future ingests — assay never stores raw values, so past columns cannot be re-decided."
          htmlFor={thresholdId}
        >
          <div className="flex items-center gap-3">
            <input
              id={thresholdId}
              type="range"
              min={0.05}
              max={1}
              step={0.01}
              value={draft.classifyThreshold}
              onChange={(e) => update((d) => ({ ...d, classifyThreshold: Number(e.target.value) }))}
              className="h-9 w-40 cursor-pointer rounded accent-primary outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <span className="w-11 text-right text-[13px] font-medium tabular-nums text-foreground">
              {Math.round(draft.classifyThreshold * 100)}%
            </span>
          </div>
        </Row>

        <Row
          label="AI classification layer"
          hint="An optional second pass for columns the regex layer can't decide. When it isn't configured, assay classifies with patterns alone — never with a guess."
        >
          {systemQ.isLoading ? (
            <span className="text-[13px] text-muted-foreground">Checking…</span>
          ) : llm ? (
            <span className="inline-flex items-center gap-2">
              <StatusPill
                tone={llm.state === "configured" ? "good" : "muted"}
                icon={Sparkles}
                label={llm.state === "configured" ? "Active" : "Regex only"}
                size="sm"
              />
              <span className="font-mono text-[11px] text-muted-foreground">{llm.model}</span>
            </span>
          ) : (
            <span className="text-[13px] text-muted-foreground">Unavailable</span>
          )}
        </Row>

        <div className="px-4 py-3.5">
          <span className="text-[13.5px] font-medium text-foreground">Category sensitivity</span>
          <p className="mt-0.5 max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground">
            The level assigned when a column is auto-classified into each category. Recomputing
            re-maps existing automatic tags; tags a person overrode by hand are never touched.
          </p>
          <div className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {Object.entries(draft.sensitivity).map(([category, level]) => {
              const id = `sensitivity-${category}`;
              const changed = level !== defaults.sensitivity[category as PiiCategory];
              return (
                <div key={category} className="flex items-center justify-between gap-3">
                  <label htmlFor={id} className="truncate font-mono text-[12px] text-muted-foreground">
                    {category}
                  </label>
                  <Select
                    id={id}
                    value={level}
                    active={changed}
                    onChange={(v) =>
                      update((d) => ({
                        ...d,
                        sensitivity: { ...d.sensitivity, [category]: v as Sensitivity },
                      }))
                    }
                  >
                    {SENSITIVITIES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Section>
  );
}

// ---- Ingestion -----------------------------------------------------------

function IngestionSection() {
  const { data, isLoading, isError } = useSystem();
  const ing = data?.ingestion;

  return (
    <Section
      id="ingestion"
      icon={FileUp}
      title="Ingestion"
      description="The limits every upload is profiled under. These come from the API's environment, so they are read-only here — change them where the API runs."
    >
      <div className={GLASS_CARD}>
        {isLoading && <SkeletonRows n={4} />}
        {isError && <InlineError>Couldn't read the API's ingestion limits.</InlineError>}
        {ing && (
          <>
            <ReadRow
              label="Maximum upload size"
              hint="Set by MAX_UPLOAD_MB. A larger file is rejected before it is read."
              value={formatBytes(ing.maxUploadMb * 1024 * 1024)}
            />
            <ReadRow
              label="Preview rows kept"
              hint="Rows persisted per dataset for the preview. The rest of the file is profiled and discarded."
              value={formatCount(ing.sampleRowsCap)}
            />
            <ReadRow
              label="Example values kept"
              hint="Distinct example values stored per column."
              value={formatCount(ing.sampleValuesCap)}
            />
            <ReadRow
              label="Values sampled per column"
              hint="How many values the pattern matcher reads when deciding a column's category."
              value={formatCount(ing.classifySampleSize)}
            />
            <ReadRow
              label="Values sent to the AI layer"
              hint="Only for a column the pattern layer can't decide, and only when the AI layer is configured."
              value={formatCount(ing.aiSampleSize)}
            />
            <ReadRow
              label="Spreadsheets"
              hint="XLSX uploads are profiled from the first sheet only — additional sheets are ignored, not merged."
              value="First sheet"
            />
          </>
        )}
      </div>
    </Section>
  );
}

// ---- Data ----------------------------------------------------------------

const DELETE_PHRASE = "DELETE";

/**
 * The API refuses catalog-wide changes without an `x-admin-token` header, so this is where a
 * deployment's operator supplies it. It is kept in sessionStorage only (see lib/api.ts) — a
 * shared secret has no business outliving the tab it was typed into.
 */
function AdminTokenRow() {
  const token = useAdminToken();
  const id = useId();
  return (
    <Row
      label={
        <span className="inline-flex items-center gap-1.5">
          <KeyRound aria-hidden="true" className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2.1} />
          Admin token
        </span>
      }
      hint="Required by deployed instances for every action on this page that changes the catalog — saving settings, recomputing, re-seeding and deleting. Kept in this browser tab only: never saved to disk, and gone when the tab closes."
      htmlFor={id}
    >
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="password"
          value={token}
          placeholder="Paste to enable"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setAdminToken(e.target.value)}
          className={cn(FIELD, "w-48 font-mono")}
        />
        <button
          type="button"
          disabled={!token}
          onClick={() => setAdminToken("")}
          className="rounded-md px-1.5 py-1 text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
        >
          Clear
        </button>
      </div>
    </Row>
  );
}

function DataSection() {
  const reseedM = useReseedDemoData();
  const deleteM = useDeleteAllDatasets();
  const [exporting, setExporting] = useState(false);
  const [phrase, setPhrase] = useState("");
  const confirmId = useId();

  async function exportCatalog() {
    setExporting(true);
    try {
      // The catalog endpoint caps a page at 100, so walk it rather than asking for everything.
      const rows: DatasetSummary[] = [];
      let total = Infinity;
      while (rows.length < total) {
        const page = await listDatasets({ limit: 100, offset: rows.length, sort: "-uploadedAt" });
        total = page.meta.total;
        if (page.data.length === 0) break;
        rows.push(...page.data);
      }
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), datasets: rows }, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `assay-catalog-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast(`Exported ${formatCount(rows.length)} dataset${rows.length === 1 ? "" : "s"}.`);
    } catch (e) {
      toast(errorText(e), "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Section
      id="data"
      icon={Database}
      title="Data"
      description="The catalog's contents. Everything here acts on the shared database, not on this device."
    >
      <div className={cn(GLASS_CARD, "mb-3")}>
        <AdminTokenRow />
        <Row
          label="Demo catalog"
          hint="Re-runs the five committed sample files through the real ingestion pipeline. Replaces those five by name; anything you uploaded is left alone."
        >
          <button
            type="button"
            disabled={reseedM.isPending}
            onClick={() =>
              reseedM.mutate(undefined, {
                onSuccess: (r) => toast(`Re-seeded ${formatCount(r.datasets)} demo datasets.`),
              })
            }
            className={BTN}
          >
            {reseedM.isPending ? <Spinner /> : <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
            {reseedM.isPending ? "Seeding…" : "Re-seed demo data"}
          </button>
        </Row>
        <Row
          label="Export catalog"
          hint="Downloads every dataset summary — scores, recommendation, sensitivity and usage counts — as JSON."
        >
          <button type="button" disabled={exporting} onClick={() => void exportCatalog()} className={BTN}>
            {exporting ? <Spinner /> : <Download aria-hidden="true" className="h-3.5 w-3.5" />}
            {exporting ? "Exporting…" : "Export JSON"}
          </button>
        </Row>
        {reseedM.isError && (
          <div className="px-4 pb-3.5">
            <ActionError error={reseedM.error} />
          </div>
        )}
      </div>

      <div
        className="glass rounded-xl border p-4"
        style={{ borderColor: "color-mix(in srgb, var(--status-critical) 40%, transparent)" }}
      >
        <div className="flex items-center gap-2">
          <TriangleAlert aria-hidden="true" className="h-4 w-4 text-[color:var(--status-critical)]" />
          <span className="text-[13.5px] font-medium text-foreground">Delete every dataset</span>
        </div>
        <p className="mt-1 max-w-prose text-pretty text-[12px] leading-relaxed text-muted-foreground">
          Removes all datasets, their columns, classifications, quality checks and access history.
          This cannot be undone — the demo catalog can be re-seeded above, but uploads cannot.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={confirmId} className={CAPTION}>
              Type {DELETE_PHRASE} to confirm
            </label>
            <input
              id={confirmId}
              type="text"
              value={phrase}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => setPhrase(e.target.value)}
              className={cn(FIELD, "w-44 font-mono")}
            />
          </div>
          <button
            type="button"
            disabled={phrase !== DELETE_PHRASE || deleteM.isPending}
            onClick={() =>
              deleteM.mutate(undefined, {
                onSuccess: (r) => {
                  setPhrase("");
                  toast(`Deleted ${formatCount(r.datasets)} dataset${r.datasets === 1 ? "" : "s"}.`);
                },
              })
            }
            className={cn(
              BTN,
              "border-[color:var(--status-critical)] text-[color:var(--status-critical)] hover:bg-[color:var(--status-critical)]/10",
            )}
          >
            {deleteM.isPending ? <Spinner /> : <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />}
            {deleteM.isPending ? "Deleting…" : "Delete all datasets"}
          </button>
        </div>
        <ActionError error={deleteM.error} />
      </div>
    </Section>
  );
}

// ---- System --------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

function SystemSection() {
  const { data, isLoading, isError, dataUpdatedAt } = useSystem();

  return (
    <Section
      id="system"
      icon={Activity}
      title="System"
      description="Live status of the API this browser is talking to. Refreshed every 30 seconds."
      aside={
        data && (
          <span className="text-[11.5px] text-muted-foreground">
            checked {relativeTime(new Date(dataUpdatedAt).toISOString())}
          </span>
        )
      }
    >
      <div className={cn(GLASS_CARD, "mb-3")}>
        {isLoading && <SkeletonRows n={4} />}
        {isError && <InlineError>The API didn't answer. It may be waking from a cold start.</InlineError>}
        {data && (
          <>
            <Row label="API" hint={`${data.api.service} · ${data.api.env}`}>
              <span className="inline-flex items-center gap-2">
                <StatusPill tone="good" icon={Activity} label="Reachable" size="sm" />
                <span className="text-[12px] tabular-nums text-muted-foreground">
                  up {formatUptime(data.api.uptimeSeconds)}
                </span>
              </span>
            </Row>
            <Row
              label="Database"
              hint={
                data.database.connected
                  ? `${formatCount(data.database.datasetCount ?? 0)} datasets stored`
                  : "The API is running but cannot reach Postgres."
              }
            >
              <span className="inline-flex items-center gap-2">
                <StatusPill
                  tone={data.database.connected ? "good" : "critical"}
                  icon={Database}
                  label={data.database.connected ? "Connected" : "Unreachable"}
                  size="sm"
                />
                {data.database.latencyMs != null && (
                  <span className="text-[12px] tabular-nums text-muted-foreground">
                    {data.database.latencyMs} ms
                  </span>
                )}
              </span>
            </Row>
            <Row label="AI layer" hint={data.llm.model}>
              <StatusPill
                tone={data.llm.state === "configured" ? "good" : "muted"}
                icon={Sparkles}
                label={data.llm.state === "configured" ? "Configured" : "Regex fallback"}
                size="sm"
              />
            </Row>
            <Row label="Versions">
              <span className="font-mono text-[11.5px] text-muted-foreground">
                api {data.versions.api} · node {data.versions.node} · prisma {data.versions.prisma}
              </span>
            </Row>
          </>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <a href={DOCS_URL} target="_blank" rel="noreferrer" className={BTN}>
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          Documentation
        </a>
        <a href={REPO_URL} target="_blank" rel="noreferrer" className={BTN}>
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          Source
        </a>
      </div>
    </Section>
  );
}

// ---- Save bar ------------------------------------------------------------

/**
 * Sticky rather than fixed: it rides the bottom of the viewport while there is page left, then
 * scrolls away with the content instead of permanently occluding it.
 */
function SaveBar({
  dirty,
  blocked,
  saving,
  error,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  blocked: boolean;
  saving: boolean;
  error: string | null;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const reduce = useReduceMotion();
  return (
    <AnimatePresence>
      {dirty && (
        <motion.div
          role="region"
          aria-label="Unsaved changes"
          initial={{ opacity: 0, y: reduce ? 0 : 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduce ? 0 : 8 }}
          transition={reduce ? { duration: 0 } : springs.instant}
          className={cn(GLASS_CARD, "sticky bottom-4 z-20 flex flex-wrap items-center gap-x-4 gap-y-2 p-3")}
        >
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px]" aria-live="polite">
            {blocked ? (
              <>
                <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--status-critical)]" />
                <span className="text-muted-foreground">Fix the highlighted fields to save.</span>
              </>
            ) : error ? (
              <>
                <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[color:var(--status-critical)]" />
                <span className="text-muted-foreground">{error}</span>
              </>
            ) : (
              <span className="text-muted-foreground">You have unsaved changes.</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onDiscard} disabled={saving} className={BTN}>
              Discard
            </button>
            <button type="button" onClick={onSave} disabled={blocked || saving} className={BTN_PRIMARY}>
              {saving && <Spinner />}
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- States --------------------------------------------------------------

function SkeletonRows({ n }: { n: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className={cn("flex items-center justify-between border-b px-4 py-3.5 last:border-0", HAIRLINE)}>
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-20 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function SettingsSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i}>
          <div className="mb-2 h-5 w-44 animate-pulse rounded bg-muted" />
          <div className={cn(GLASS_CARD)}>
            <SkeletonRows n={3} />
          </div>
        </div>
      ))}
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 px-4 py-3.5 text-[13px] text-muted-foreground">
      <TriangleAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-[color:var(--status-critical)]" />
      {children}
    </p>
  );
}

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className={cn(GLASS_CARD, "flex flex-col items-start gap-2 p-5")}>
      <p className="text-[14px] font-medium text-foreground">Couldn't load settings</p>
      <p className="max-w-prose text-pretty text-[13px] text-muted-foreground">
        {message} The API may be waking from a cold start.
      </p>
      <button type="button" onClick={onRetry} className={cn(BTN, "mt-1")}>
        <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
        Try again
      </button>
    </div>
  );
}
