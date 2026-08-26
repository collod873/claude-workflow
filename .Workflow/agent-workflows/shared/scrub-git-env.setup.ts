import { scrubGitLocationVars } from "./child-env.ts";

/**
 * Vitest `setupFiles` entry — runs in every worker, before every test file.
 *
 * Ten of this repo's test files build a fixture repository and drive real
 * `git` against it with `execFileSync("git", args, { cwd: dir })`. That form
 * inherits the worker's environment, and an inherited `GIT_DIR` beats the
 * `cwd` (and an argv `-C`) every time — so with `GIT_DIR` exported, every
 * fixture commit in the suite lands on whatever repo the variable names.
 * Twice in one hour that was this checkout: 74 fixture commits walked `main`
 * onto a chain of `seed` / `the release commit` / `mine, inside range`, and
 * the second occurrence was pushed to `origin` before anyone noticed (#86).
 *
 * `GIT_DIR` is not an exotic thing to have set. Git exports it into every
 * hook it invokes, so a suite run from inside `pre-push` — which is a venue
 * this repo actually uses — starts with it already in the environment.
 *
 * `git.ts` and `gh.ts` scrub the same variables at their own seam, which is
 * what fixed the production path. This is the other half: fixtures do not go
 * through that seam, and the next test that shells out to `git` will not go
 * through it either. Scrubbing the worker's own `process.env` covers tests
 * that do not exist yet, which is the only version of this fix that stays
 * true — see `git-env-sandbox.test.ts` for what holds it in place.
 */
scrubGitLocationVars(process.env);
