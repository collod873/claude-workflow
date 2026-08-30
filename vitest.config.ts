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
// `setupFiles` runs inside each worker, which is the only place the scrub can go: a fixture that
// spawns `git` with the default inherited environment reads the *worker's* `process.env`, not
// this config's. It is listed here rather than imported per test file because the tests that need
// it are the ones nobody has written yet — see the file's own comment and #86.
// `tests/acceptance/` is in `include` because nothing else can put it there. A positional argument
// to `vitest run` is a *filter over* `include`, never an addition to it — so `push-gate.ts`'s
// `npx vitest run tests/acceptance/` and `verify.yml`'s per-slice `npx vitest run <file...>` both
// selected from a set that never contained an acceptance test, and each reported "no test files
// found" as a clean run. Lane 04 could author a test, land it on `main` and have the gate that is
// supposed to judge it see nothing (#188). An acceptance test is *expected* to be red until the
// ticket it names is built, which is what makes it an acceptance test rather than a report on
// working code — so a red `npm test` here is the suite doing its job, and the venue that decides
// whether one may land is `acceptance/push-gate.ts`, not this list.
// `.claude/worktrees/` is excluded because `.claude/**` is included: an agent session working in a
// worktree puts a whole second checkout under that path, and the suite ran every test in it —
// three worktrees, three extra copies of `tests/acceptance/`, and `gauntlet-test-slot.test.ts`
// red on files that were never this tree's.
export default defineConfig({
  test: {
    include: [".Workflow/**/*.test.ts", ".claude/**/*.test.ts", "tests/acceptance/**/*.test.ts"],
    exclude: ["**/node_modules/**", ".claude/worktrees/**"],
    setupFiles: [".Workflow/agent-workflows/shared/scrub-git-env.setup.ts"],
    maxWorkers: 4,
    testTimeout: 30_000,
  },
});
