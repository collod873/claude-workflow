---
status: constraint
date: 2026-08-28
reversal: Undoing it means restoring the test suite as knip's entry set, discarding the committed baseline and the `@shell`/`@fixture` annotations now spread across exports, and losing the only check that separates a component no lane invokes from one that merely has tests.
---

# A test importing a thing is not evidence anything runs it, so the push gate measures reachability from lanes instead

`knip.config.ts` reads its entry set out of `.github/workflows`, `bin/`, and `.claude/hooks` — the three places that can invoke this repo's TypeScript — and asks only whether a lane reaches a thing. A test suite is not an entry point: #183 found five components wired to nothing that an ordinary dead-code check would have cleared on their tests.

The gate is on the delta against a committed baseline: it landed against 31 standing findings, each a product decision rather than a lint fix. A baseline entry whose finding is gone also fails, on ADR-0056's `regenerate && diff` reasoning.

**Accepted cost.** Two exemptions exist and both make the export say why in prose — `@shell` for a production caller no static analysis can see, `@fixture` for a builder the suite alone reaches. This reads the module graph only: a branch `main()` never takes, an unused flag, or a defaulted parameter still passes.
