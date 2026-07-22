// Resolve DATABASE_URL for tests before any Prisma client is built.
// Priority: ambient env (CI sets it) > TEST_DATABASE_URL > a *_test sibling of the dev DB.
//
// That last step is the important one. The integration tests TRUNCATE every table, and this
// file used to fall back to .env's DATABASE_URL — so following the README in order (seed the
// demo data, browse it, then run the tests) silently emptied the catalog, and the app looked
// broken through no fault of its own. Deriving a separate `<db>_test` database keeps a test
// run from ever touching data someone is looking at.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Point a connection string at a sibling database, preserving credentials and params. */
function toTestDatabase(url: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.replace(/^\//, "");
    if (!name || name.endsWith("_test")) return url;
    parsed.pathname = `/${name}_test`;
    return parsed.toString();
  } catch {
    return url; // unparseable — leave it alone rather than guess
  }
}

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
      if (match) process.env.DATABASE_URL = toTestDatabase(match[1]!.trim());
    } catch {
      /* no .env present — rely on ambient env */
    }
  }
}
