import { defineConfig } from "vitest/config";

// Runner boxes here are shared with sibling worktrees during a drain batch —
// an unbounded worker pool starves them (see the runner-load finding cited in
// docs/adr/0002-work-executes-on-github-hosted-runners-never-on-the-workstat.md).
// Capping the pool keeps one `vitest run` from claiming every core.
// Ten of this repo's test files drive their subject as a real process — a hook, a CLI, a `git`
// invocation — because that is the only honest way to test a thing whose contract IS its exit
// code and its log file. Process spawns are where a shared runner is slowest: `backfill.test.ts`
// runs in 0.8s on the workstation and 10.1s on a two-core hosted runner, and vitest's 5s default
// made that difference the test's verdict. A timeout sized for the fastest venue is a gate that
// goes red for environment reasons, which is how a repo learns to ignore its gates —
// see docs/adr/0015-a-test-s-timeout-is-sized-for-the-slowest-venue-it-runs-in-n.md.
export default defineConfig({
  test: {
    include: [".Workflow/**/*.test.ts", ".claude/**/*.test.ts"],
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
