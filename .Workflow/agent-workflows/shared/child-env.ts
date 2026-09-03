/**
 * Environment variables through which git names *where* it operates rather
 * than *how* — the ones an ambient process (a parent shell, a hook host) can
 * set to redirect a `git` invocation at a different repository than the one
 * named on its command line. `GIT_DIR` in particular wins over an argv
 * `-C <dir>`, and git exports it (plus `GIT_WORK_TREE`) into every hook it
 * spawns — including `pre-push` — so a seam that shells out to `git` from
 * inside a hook inherits a location override its caller never asked for.
 */
export const GIT_LOCATION_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_CEILING_DIRECTORIES",
] as const;

/**
 * The machine's own location variable: `TARGET_WORKSPACE` names *which checkout* a machine script
 * acts on (ADR-0055, ADR-0139), and every one of them reads it ambiently — `bin/new-adr:26`,
 * `bin/gauntlet`, `acceptance.ts`, `shape.ts`, `review.ts` and the rest all resolve their target as
 * `TARGET_WORKSPACE || cwd`. It is `GIT_DIR` wearing this repository's name: set in the
 * environment, it beats a script's own location and beats its argv.
 *
 * Lane 05 exports it for the whole implement step, so the suite that step runs inherits it — and a
 * fixture that copies `bin/new-adr` into a scratch tree and runs it there had that script resolve
 * `docs/adr` to the *target* instead. Run 33698888723: three fixture ADRs (0146, 0147, 0148)
 * numbered off the real corpus and written into the repository under test, and the `corpus` check
 * racing beside the suite then reported the fixture stale and refused the push. It cannot happen on
 * a workstation, where the variable is never set — which is why it cost forty-five minutes.
 *
 * Unlike the git variables there is no decoy needed here (`bin/gauntlet`'s git sandbox): nothing
 * outside this repository honours this name, so removing it from the worker removes it from every
 * process a fixture can spawn. A fixture that means to point a script at another checkout sets it
 * back explicitly on that one call, which is the seam `new-adr.test.ts` already uses.
 */
export const TARGET_LOCATION_VARS = ["TARGET_WORKSPACE"] as const;

/**
 * Deletes the machine's location variable from `env` in place and returns it. The suite calls this
 * on `process.env` itself (see `./scrub-git-env.setup.ts`), for the same reason the git scrub is
 * there rather than at a seam: a fixture spawns a machine script with the inherited environment and
 * never passes through one.
 *
 * Deliberately not part of `childEnv()` — the production seams that shell out to a machine script
 * *do* mean to name a target, and say so on the call (`run-gauntlet.ts` sets it after the spread).
 */
export function scrubTargetLocationVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of TARGET_LOCATION_VARS) delete env[key];
  return env;
}

/**
 * `process.env`, minus the git location variables, for handing to a `git`
 * (or `gh`, which shells out to `git` internally) child process. Everything
 * else — `PATH`, `HOME`, author/committer identity, `GIT_AUTHOR_DATE`, etc.
 * — passes through untouched; only the variables that can redirect *which*
 * repository the child touches are stripped, so a caller's own `-C <dir>`
 * (or the child's cwd) is what decides that, not whatever the parent
 * process happened to inherit.
 */
export function childEnv(): NodeJS.ProcessEnv {
  return scrubGitLocationVars({ ...process.env });
}

/**
 * Deletes the git location variables from `env` in place and returns it. The
 * seam calls this on a *copy* of `process.env`; the test suite calls it on
 * `process.env` itself (see `./scrub-git-env.setup.ts`), because a fixture
 * that shells out to `git` with the default inherited environment has no seam
 * to scrub — the only place left to remove the variable is the process the
 * fixture is running in.
 */
export function scrubGitLocationVars(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of GIT_LOCATION_VARS) delete env[key];
  return env;
}
