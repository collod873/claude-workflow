import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// that manufactured Lumaria's `booking-embed-panel` and `eslint-boundaries` failures out of
export default defineConfig({
  test: {
    include: [".claude/**/*.test.ts", "bin/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**"],
    maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)),
    testTimeout: 30_000,
  },
});
