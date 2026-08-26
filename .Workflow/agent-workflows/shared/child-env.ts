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
