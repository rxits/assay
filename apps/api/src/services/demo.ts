// Demo data (03 §7 / 00-SPEC §10). Loads every committed sample through the REAL ingestion
// pipeline — seeds and live uploads MUST share one code path, or the demo would validate logic
// the API doesn't run — then backdates SEED AccessEvents in four usage profiles and recomputes
// Value via the same value-on-read path, so the catalog shows the full spread on first load:
//   hot → KEEP, stale → OPTIMIZE, declining → ARCHIVE, dead → RETIRE, broken → FAILED.
//
// Lives in src/ (not prisma/) because two callers need it: `prisma db seed` and the Settings
// page's "Re-seed demo data" button. Idempotent: prior seed datasets are deleted by known name
// (ON DELETE CASCADE cleans their columns/tags/checks/events/snapshots). The deleteMany is
// where-scoped — never bare — so live uploads (names outside the seed set) are untouched.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import type { AccessType, FileType } from "@assay/shared";
import { prisma } from "../lib/prisma";
import { ApiHttpError } from "../lib/errors";
import { ingestDataset } from "./ingest";
import { recomputeDatasetValue } from "./catalog";

const DAY_MS = 86_400_000;

type Profile = "hot" | "stale" | "declining" | "dead";

interface SeedSpec {
  name: string; // Dataset.name — the idempotency key (delete-by-name)
  file: string;
  fileType: FileType;
  profile: Profile; // backdated-usage shape → recommendation
}

// broken.csv is intentionally profiled "dead" but ingests to FAILED (ragged), so it carries null
// scores and no events — a graceful-failure catalog citizen (00-SPEC §11), not a recommendation.
export const SEEDS: SeedSpec[] = [
  { name: "events_log", file: "events_log.csv", fileType: "CSV", profile: "hot" }, // → KEEP
  { name: "customers", file: "customers.csv", fileType: "CSV", profile: "stale" }, // → OPTIMIZE
  { name: "employees", file: "employees.xlsx", fileType: "XLSX", profile: "declining" }, // → ARCHIVE
  { name: "messy_orders", file: "messy_orders.csv", fileType: "CSV", profile: "dead" }, // → RETIRE
  { name: "broken", file: "broken.csv", fileType: "CSV", profile: "dead" }, // → FAILED (no events)
];

const SEED_NAMES = SEEDS.map((s) => s.name);
const TYPES: AccessType[] = ["VIEW", "DETAIL_VIEW", "DOWNLOAD"];

// Day-offsets (days before `now`) per profile, tuned so computeValue lands in the target band
// (worked in 06 §6/§7). Boundaries 30/60/90 are avoided so window membership is unambiguous.
const OFFSETS: Record<Profile, number[]> = {
  // hot: 45 in 90d, 20 last-30 vs 12 prev-30 (rising), last ~1d → Value ≈ 94 → KEEP.
  hot: [...range(1, 20), ...range(31, 42), ...range(61, 73)],
  // stale/cooling: 8 in 90d, 1 last-30 vs 5 prev-30 (declining), last ~24d → Value ≈ 43 → OPTIMIZE.
  stale: [24, 31, 36, 41, 46, 51, 61, 71],
  // declining/fading: 4 in 90d, 0 last-30 vs 3 prev-30, last ~40d → Value ≈ 28 → ARCHIVE.
  declining: [40, 45, 50, 61],
  // dead: no events → Value 10 → RETIRE.
  dead: [],
};

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

function eventsFor(datasetId: string, profile: Profile, nowMs: number): Prisma.AccessEventCreateManyInput[] {
  return OFFSETS[profile].map((offset, i) => ({
    datasetId,
    type: TYPES[i % TYPES.length]!, // round-robin; all AccessTypes count equally for Value (06 §6)
    source: "SEED",
    // −3h so a same-day-offset event still sorts strictly before `now`.
    occurredAt: new Date(nowMs - offset * DAY_MS - 3 * 3_600_000),
  }));
}

/**
 * Where the committed sample files live. `prisma db seed` passes its own module-relative path;
 * the API server resolves from cwd (or SAMPLES_DIR), which covers `pnpm dev` from apps/api and a
 * repo-root start. Not found ⇒ a clean 422 rather than a stack trace from readFileSync.
 */
export function resolveSamplesDir(): string {
  const candidates = [
    process.env.SAMPLES_DIR,
    resolve(process.cwd(), "../../samples"), // running from apps/api
    resolve(process.cwd(), "samples"), // running from the repo root
  ].filter((c): c is string => !!c);
  const found = candidates.find((dir) => existsSync(dir));
  if (!found) {
    throw new ApiHttpError(
      422,
      "invalid_file",
      "Sample files are not available on this deployment. Set SAMPLES_DIR to re-seed.",
    );
  }
  return found;
}

export interface SeedResult {
  datasets: number; // seed datasets ingested (including graceful failures)
  events: number; // backdated access events written
}

/** Re-seed the demo catalog. `log` is silent by default (API), verbose for `prisma db seed`. */
export async function seedDemoData(
  { samplesDir = resolveSamplesDir(), now = new Date(), log = () => {} }: {
    samplesDir?: string;
    now?: Date;
    log?: (message: string) => void;
  } = {},
): Promise<SeedResult> {
  const nowMs = now.getTime();

  const removed = await prisma.dataset.deleteMany({ where: { name: { in: SEED_NAMES } } });
  log(`seed: cleared ${removed.count} prior seed dataset(s).`);

  let datasets = 0;
  let eventCount = 0;

  for (const spec of SEEDS) {
    const buffer = readFileSync(resolve(samplesDir, spec.file));

    let summary;
    try {
      summary = await ingestDataset({
        buffer,
        originalFilename: spec.file,
        fileType: spec.fileType,
        sizeBytes: buffer.length,
        name: spec.name,
      });
    } catch (err) {
      // Up-front rejects (empty/invalid) throw with no row created — log and continue.
      log(`seed: ${spec.file} rejected at ingest (${(err as Error).message}); skipping.`);
      continue;
    }
    datasets++;

    if (summary.status !== "READY") {
      log(`seed: ${spec.name} → ${summary.status} (graceful failure; no usage backdated).`);
      continue;
    }

    const events = eventsFor(summary.id, spec.profile, nowMs);
    if (events.length > 0) await prisma.accessEvent.createMany({ data: events });
    eventCount += events.length;
    // Recompute Value from the backdated events so the catalog list shows it without a detail view.
    await recomputeDatasetValue(summary.id, new Date(nowMs));

    const ds = await prisma.dataset.findUniqueOrThrow({
      where: { id: summary.id },
      select: { valueScore: true, valueRecommendation: true },
    });
    log(
      `seed: ${spec.name} [${spec.profile}] → Value ${ds.valueScore?.toFixed(1)} ${ds.valueRecommendation} (${events.length} events)`,
    );
  }

  return { datasets, events: eventCount };
}

/** Danger zone: drop every dataset (cascades to columns, tags, checks, events, snapshots). */
export async function deleteAllDatasets(): Promise<{ datasets: number }> {
  const { count } = await prisma.dataset.deleteMany({});
  return { datasets: count };
}
