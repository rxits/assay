// Seed (03 §7 / 00-SPEC §10). Loads every committed sample through the REAL ingestion pipeline
// — seeds and live uploads MUST share one code path, or the demo would validate logic the API
// doesn't run — then backdates SEED AccessEvents in four usage profiles and recomputes Value via
// the same value-on-read path, so the catalog shows the full spread on first load:
//   hot → KEEP, stale → OPTIMIZE, declining → ARCHIVE, dead → RETIRE, broken → FAILED.
//
// Idempotent: prior seed datasets are deleted by known name (ON DELETE CASCADE cleans their
// columns/tags/checks/events/snapshots). The deleteMany is where-scoped — never bare — so live
// uploads (names outside the seed set) are untouched. Run: pnpm --filter @assay/api exec prisma db seed.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import type { AccessType, FileType } from "@assay/shared";
import { prisma } from "../src/lib/prisma";
import { ingestDataset } from "../src/services/ingest";
import { recomputeDatasetValue } from "../src/services/catalog";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = resolve(here, "../../../samples");
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
const SEEDS: SeedSpec[] = [
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

async function main(): Promise<void> {
  const nowMs = Date.now();

  const removed = await prisma.dataset.deleteMany({ where: { name: { in: SEED_NAMES } } });
  console.log(`seed: cleared ${removed.count} prior seed dataset(s).`);

  for (const spec of SEEDS) {
    const buffer = readFileSync(resolve(SAMPLES_DIR, spec.file));

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
      console.warn(`seed: ${spec.file} rejected at ingest (${(err as Error).message}); skipping.`);
      continue;
    }

    if (summary.status !== "READY") {
      console.log(`seed: ${spec.name} → ${summary.status} (graceful failure; no usage backdated).`);
      continue;
    }

    const events = eventsFor(summary.id, spec.profile, nowMs);
    if (events.length > 0) await prisma.accessEvent.createMany({ data: events });
    // Recompute Value from the backdated events so the catalog list shows it without a detail view.
    await recomputeDatasetValue(summary.id, new Date(nowMs));

    const ds = await prisma.dataset.findUniqueOrThrow({
      where: { id: summary.id },
      select: { valueScore: true, valueRecommendation: true },
    });
    console.log(
      `seed: ${spec.name} [${spec.profile}] → Value ${ds.valueScore?.toFixed(1)} ${ds.valueRecommendation} (${events.length} events)`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
