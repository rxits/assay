import { defineConfig } from "vitest/config";

// setupFiles run before each test file imports the app (and thus the Prisma
// singleton), so DATABASE_URL is resolved before the client is constructed.
export default defineConfig({
  test: {
    setupFiles: ["./tests/setup.ts"],
  },
});
