import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { childEnv } from "../shared/child-env.ts";

/**
 * The generated files this lane refreshes for the implementer, after its answer is on disk and
 * before anything is committed.
 *
 * `bin/gauntlet push` runs each of these as `regenerate && diff` (ADR-0056), so a tree whose
 * generated artifact disagrees with a fresh probe fails the push — and the push is what lane 05's
 * whole run rides on. The implementer cannot be the one to fix that. Two reasons, and either alone
 * would settle it: the artifact is almost never in its ticket's "Files claimed" (nothing about
 * landing an ADR reads as touching a watchdog fixture), and one of these files is 472 KB, which is
 * not a thing to ask a model to reproduce byte-for-byte in a structured answer.
 *
 * Run 33284271370 is the bill for leaving it to the implementer: it wrote its ADR correctly, ran
 * the gate exactly as ADR-0107 asks, found the corpus fixture stale, reverted its own regeneration
 * because the file was outside its claim, and lost the entire run at the push. The generator is
 * deterministic and free. There is nothing to decide here, which is why nothing is asked.
 *
 * The wiring baseline is deliberately **not** on this list. It is an allowlist of standing debt
 * that only ever shrinks, so regenerating it would let new code that nothing runs through the gate
 * that exists to catch it — see `CLAUDE.md` and ADR-0086.
 *
 * The clone-gate baseline **is**, and the difference is what "shrinks" means for each. A wiring
 * entry leaves when the code gets wired; a clone entry leaves when the clone is gone. Pruning the
 * second cannot admit a duplicate — `--prune-baseline` has no way to add — it only stops the push
 * gate refusing a run for having *paid off* a clone, which is how run 33324207385 lost #273 at its
 * push. `prune-clone-baseline.ts` carries the rest of the argument.
 *
 * The timing baseline was here too, once. ADR-0148 removed the committed half of it outright —
 * timing is recorded, never judged, so there is no runner's number left for a step here to own —
 * and what a gauntlet run leaves behind now (`.gauntlet-timings.json`) is gitignored and written by
 * every run, never committed by this one.
 */
export interface GeneratedArtifact {
  /** Repo-relative path of the committed file, for the `git add` that follows. */
  path: string;
  /** Repo-relative path of the script that writes it, invoked with the repo root as its only argument. */
  generator: string;
}

export const GENERATED_ARTIFACTS: readonly GeneratedArtifact[] = [
  {
    path: ".claude/contract.json",
    generator: ".Workflow/agent-workflows/shared/generate-contract.ts",
  },
  {
    path: ".Workflow/agent-workflows/watchdog/adr-corpus.evidence.json",
    generator: ".Workflow/agent-workflows/shared/generate-corpus-fixture.ts",
  },
  {
    path: ".Workflow/agent-workflows/shared/clone-gate.baseline.json",
    generator: ".Workflow/agent-workflows/shared/prune-clone-baseline.ts",
  },
];

/** Runs one generator against `root`, returning what it exited with and said. */
export type GeneratorExec = (generator: string, root: string) => { exitCode: number; output: string };

/**
 * Spawns a generator under the same Node that is running this lane.
 *
 * `process.execPath` rather than a bare `node`: a runner's `PATH` is not this process's guarantee,
 * and the generators are `.ts` files this repo runs under a Node that already resolves them.
 * `childEnv()` for the reason `gh.ts` and `git.ts` take it — `GIT_DIR` beats a cwd, and lane 05
 * runs downstream of hooks that export it. `maxBuffer` because Node's 1 MB default is a cliff, and
 * these generators read every ADR in the repo.
 */
export const execGenerator: GeneratorExec = (generator, root) => {
  const result = spawnSync(process.execPath, [generator, root], {
    encoding: "utf8",
    env: childEnv(),
    maxBuffer: 10 * 1024 * 1024,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? result.error.message : ""}`;
  return { exitCode: result.status ?? 1, output };
};

/**
 * Regenerates every artifact in `GENERATED_ARTIFACTS` that already exists at `root`, and returns
 * their paths, for the caller to add alongside the implementer's own files.
 *
 * Gated on the artifact already being present, the same rule `bin/gauntlet`'s own `clones` check
 * applies to its baseline (ADR-0139): an enrolled repository's target checkout owes only its
 * `.claude/contract.json`, never the corpus fixture or the clone baseline, and `git add`ing a path
 * that was never seeded there fails on the pathspec rather than quietly doing nothing. A target
 * that never seeded one of these has that artifact's check turned off, so there is nothing here to
 * keep true either.
 *
 * Every present path comes back, not only the ones that changed: the question "did this actually
 * differ" is git's to answer at `add` time, and asking it here would mean reading each file twice
 * to learn something the commit already knows. A generator that is a no-op costs a subprocess.
 *
 * **A generator that fails does not fail the run.** It is refreshing something the implementer did
 * not ask about, so the worst case is the tree it was already going to have: the push gate then
 * reports the stale artifact by name, which is a legible failure, and strictly better than a run
 * that dies here saying nothing about the ticket it was building.
 */
/** A root, and the seams around it, spelled however a caller happens to have them at hand. */
export interface RegenerateArtifactsDeps {
  root?: string;
  targetRoot?: string;
  target?: string;
  dir?: string;
  cwd?: string;
  path?: string;
  log?: (line: string) => void;
  logger?: (line: string) => void;
}

function resolveRoot(deps: RegenerateArtifactsDeps): string | undefined {
  return deps.root ?? deps.targetRoot ?? deps.target ?? deps.dir ?? deps.cwd ?? deps.path;
}

function resolveLog(deps: RegenerateArtifactsDeps): ((line: string) => void) | undefined {
  return deps.log ?? deps.logger;
}

/**
 * Regenerates every artifact in `GENERATED_ARTIFACTS` that already exists at `root`, and returns
 * their paths, for the caller to add alongside the implementer's own files.
 *
 * Gated on the artifact already being present, the same rule `bin/gauntlet`'s own `clones` check
 * applies to its baseline (ADR-0139): an enrolled repository's target checkout owes only its
 * `.claude/contract.json`, never the corpus fixture or the clone baseline, and `git add`ing a path
 * that was never seeded there fails on the pathspec rather than quietly doing nothing. A target
 * that never seeded one of these has that artifact's check turned off, so there is nothing here to
 * keep true either.
 *
 * Every present path comes back, not only the ones that changed: the question "did this actually
 * differ" is git's to answer at `add` time, and asking it here would mean reading each file twice
 * to learn something the commit already knows. A generator that is a no-op costs a subprocess.
 *
 * **A generator that fails does not fail the run.** It is refreshing something the implementer did
 * not ask about, so the worst case is the tree it was already going to have: the push gate then
 * reports the stale artifact by name, which is a legible failure, and strictly better than a run
 * that dies here saying nothing about the ticket it was building.
 *
 * Callable either the way lane 05 already does — `regenerateArtifacts(exec, root, log)`, `exec`
 * always first — or by naming just the root (`regenerateArtifacts(root)`), a root plus a bag of
 * seams (`regenerateArtifacts(root, deps)`), the bag alone (`regenerateArtifacts(deps)`), or no
 * argument at all, which falls back to `process.cwd()`. The three-argument form is the only one
 * that can name its own `exec`; the shorthand forms always regenerate for real, because there is
 * no positional slot left to carry a fake one past `root`.
 */
export function regenerateArtifacts(
  execOrRootOrDeps?: GeneratorExec | string | RegenerateArtifactsDeps,
  rootOrDeps?: string | RegenerateArtifactsDeps,
  log?: (line: string) => void,
): string[] {
  if (typeof execOrRootOrDeps === "function") {
    return regenerateArtifactsWith(execOrRootOrDeps, rootOrDeps as string, log ?? (() => {}));
  }

  let root: string | undefined;
  let resolvedLog: ((line: string) => void) | undefined;

  if (typeof execOrRootOrDeps === "string") {
    root = execOrRootOrDeps;
    if (rootOrDeps && typeof rootOrDeps === "object") {
      root = resolveRoot(rootOrDeps) ?? root;
      resolvedLog = resolveLog(rootOrDeps);
    }
  } else if (execOrRootOrDeps && typeof execOrRootOrDeps === "object") {
    root = resolveRoot(execOrRootOrDeps);
    resolvedLog = resolveLog(execOrRootOrDeps);
  }

  return regenerateArtifactsWith(execGenerator, root ?? process.cwd(), resolvedLog ?? (() => {}));
}

function regenerateArtifactsWith(exec: GeneratorExec, root: string, log: (line: string) => void): string[] {
  const present = GENERATED_ARTIFACTS.filter((artifact) => existsSync(join(root, artifact.path)));
  for (const artifact of present) {
    const result = exec(artifact.generator, root);
    if (result.exitCode !== 0) {
      log(`could not regenerate ${artifact.path} (exit ${result.exitCode}): ${result.output.trim()}`);
    }
  }
  return present.map((artifact) => artifact.path);
}
