// Resolve DATABASE_URL for tests before any Prisma client is built.
// Priority: ambient env (CI sets it) > TEST_DATABASE_URL > apps/api/.env.
// ponytail: local runs reuse the dev DB from .env; set TEST_DATABASE_URL to a
// throwaway (e.g. .../assay_test) to isolate once seed data matters.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Keep the oversized-upload test cheap: pin the cap to 1 MB under test so it
// allocates ~1 MB instead of the 100 MB production default.
process.env.MAX_UPLOAD_MB ??= "1";

if (!process.env.DATABASE_URL) {
  if (process.env.TEST_DATABASE_URL) {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  } else {
    try {
      const here = dirname(fileURLToPath(import.meta.url));
      const envFile = readFileSync(resolve(here, "../.env"), "utf8");
      const match = envFile.match(/^DATABASE_URL=(.*)$/m);
      if (match) process.env.DATABASE_URL = match[1]!.trim();
    } catch {
      /* no .env present — rely on ambient env */
    }
  }
}
