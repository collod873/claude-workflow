import { defineConfig } from "vitest/config";

// Runner boxes here are shared with sibling worktrees during a drain batch —
// an unbounded worker pool starves them (see the runner-load finding cited in
// docs/adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md).
// Capping the pool keeps one `vitest run` from claiming every core.
export default defineConfig({
  test: {
    include: [".Workflow/**/*.test.ts"],
    maxWorkers: 4,
  },
});
