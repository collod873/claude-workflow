import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/**"],
    maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)),
    testTimeout: 30_000,
  },
});
