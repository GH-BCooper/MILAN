import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `seed-data/challenges.csv` is read at runtime by the /demo reset button
   * (lib/demo/reset.ts), which restores each challenge to the status the seed
   * gave it. Next's file tracing only bundles files it can see being imported,
   * and this one is read by path — so without this the button silently restored
   * nothing on Vercel while working perfectly on a laptop. That is exactly the
   * class of failure the demo console exists to prevent, so it is declared here
   * rather than worked around.
   */
  outputFileTracingIncludes: {
    "/demo": ["./seed-data/challenges.csv"],
    "/api/demo/reset": ["./seed-data/challenges.csv"],
  },
};

export default nextConfig;
