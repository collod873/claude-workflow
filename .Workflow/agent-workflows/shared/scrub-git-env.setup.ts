import { scrubGitLocationVars, scrubTargetLocationVars } from "./child-env.ts";

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

/**
 * `TARGET_WORKSPACE` is the same argument with this repository's own name on it: it says *which
 * checkout* a machine script acts on, every machine script reads it ambiently, and lane 05 and the
 * fixer both export it for the whole step the suite runs inside. A fixture that copies `bin/new-adr`
 * into a scratch tree and runs it there therefore had it write into the target checkout instead —
 * three fixture ADRs landed in the repository under test and the `corpus` check, racing beside the
 * suite, refused the push (run 33698888723). See `child-env.ts` for the full account.
 *
 * On a workstation the variable is unset, so this scrub is what makes a runner's suite behave the
 * way the suite that was written against a workstation already assumed it did.
 */
scrubTargetLocationVars(process.env);
