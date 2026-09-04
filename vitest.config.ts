import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
    // `server-only` is a marker package: it throws unless the importer resolves
    // it under React's "react-server" condition, which Next sets and Vitest does
    // not. Adding the condition lets a test import a server module directly --
    // which is the point, since the guardrail and the state machine are exactly
    // the server code most worth testing.
    conditions: ["react-server", "node", "import", "default"],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Database-backed tests round-trip to Supabase; the legal-edge sweep alone is
    // ~80 transitions, so the default 5s timeout is far too tight.
    //
    // CI needs considerably more than a laptop does. The database is in
    // ap-south-1 and a GitHub runner is not, so every one of those transitions
    // pays a much larger round trip: the sweep takes ~53s here and blew past
    // 180s on the runner. This is latency, not a slow test — the same run's
    // terminal-edge sweep went 14s -> 81s alongside it.
    testTimeout: process.env.CI ? 600_000 : 180_000,
    hookTimeout: 60_000,
    // Database-backed tests open real connections; keep them serial.
    fileParallelism: false,
  },
});
