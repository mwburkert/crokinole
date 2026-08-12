import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.{ts,tsx}"],
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
