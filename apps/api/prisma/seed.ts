// `prisma db seed` entrypoint. The seeding itself lives in src/services/demo.ts so the API's
// "Re-seed demo data" action and this CLI run identical code — see that file for the profiles.
// Run: pnpm --filter @assay/api exec prisma db seed
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/lib/prisma";
import { seedDemoData } from "../src/services/demo";

const here = dirname(fileURLToPath(import.meta.url));

seedDemoData({ samplesDir: resolve(here, "../../../samples"), log: (m) => console.log(m) })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
