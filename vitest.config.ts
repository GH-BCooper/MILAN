import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database-backed tests round-trip to Supabase; the legal-edge sweep alone is
    // ~80 transitions, so the default 5s timeout is far too tight.
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Database-backed tests open real connections; keep them serial.
    fileParallelism: false,
  },
});
