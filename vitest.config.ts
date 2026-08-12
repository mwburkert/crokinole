import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.{ts,tsx}",
      // `convex/lib/firstNight.test.ts` asserts the money for the 5 August
      // night against the data that seeds it. The Convex bundler ignores
      // `*.test.ts`, so the test can sit beside the data without deploying.
      "convex/**/*.test.ts",
    ],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/core/src/**/*.ts"],
      exclude: [
        "packages/core/src/**/*.test.ts",
        "packages/core/src/testing.ts",
        // Pure re-exports and type declarations — no logic to cover.
        "packages/core/src/index.ts",
        "packages/core/src/types.ts",
      ],
      thresholds: {
        // The rules engine is the critical path (§6.1) — a scoring bug found in
        // Wave 2 invalidates three agents' work at once.
        branches: 95,
        functions: 95,
        lines: 95,
        statements: 95,
      },
    },
  },
});
