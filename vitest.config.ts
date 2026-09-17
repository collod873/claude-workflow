import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// that manufactured Lumaria's `booking-embed-panel` and `eslint-boundaries` failures out of
export default defineConfig({
  test: {
    include: [".Workflow/**/*.test.ts", ".claude/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**"],
    setupFiles: [
      ".Workflow/agent-workflows/shared/scrub-git-env.setup.ts",
      ".Workflow/agent-workflows/shared/isolate-checkpoints.setup.ts",
    ],
    maxWorkers: Math.max(1, Math.floor(availableParallelism() / 2)),
    testTimeout: 30_000,
  },
});
