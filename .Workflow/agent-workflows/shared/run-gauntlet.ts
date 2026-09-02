import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { childEnv } from "./child-env.ts";

/**
 * ADR-0139: `bin/gauntlet` has one root where a lane needs two — where its checks live (the
 * machine, this repo) and what they check (the target, `TARGET_WORKSPACE`). An enrolled
 * repository carries no `bin/gauntlet` of its own to shell out to (only `.claude/contract.json`,
 * `docs/adr/`, `CODING_STANDARDS.md`), so every caller that used to run `<repoDir>/bin/gauntlet`
 * against the target — because machine and target were once the same checkout (#315) — has to run
 * the MACHINE's copy instead, the same way `.claude/hooks/gauntlet-hook.mjs` already does.
 *
 * `MACHINE_ROOT` is resolved from *this module's own location*, never `process.cwd()` or a
 * `repoDir`/`root` argument a caller threads through — those name the target once the reusable
 * workflow splits the two checkouts (ADR-0055), and resolving the machine from one of them is
 * exactly the bug this file exists to close.
 *
 * Three levels up, not two: this file sits at `.Workflow/agent-workflows/shared/`, so two `..`
 * lands on `.Workflow/` — a directory with no `bin/gauntlet` in it. `execFileSync` on a path that
 * does not exist throws `ENOENT` with no `status` and no output, which `runRealGauntlet` reports
 * as `no-run` with nothing to read, and lane 08 refused every merge that way for the rest of the
 * afternoon it landed (#332, runs 33668167431 and 33669276843). `run-gauntlet.test.ts` holds the
 * resolved path to a file that exists so the next move of this module fails a test, not a lane.
 */
export const MACHINE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The three venues `bin/gauntlet` understands — see its own header. */
export type GauntletVenue = "turn" | "stop" | "push";

/**
 * The one seam this file exposes: `(command, args, options) => stdout`, throwing on a non-zero
 * exit exactly the way `execFileSync` does (with `status`/`stdout`/`stderr` on the caught error).
 * Real callers never set this; a test hands in a stub so it can assert the spawn's shape —
 * command, args, `cwd`, and the `TARGET_WORKSPACE` this sets — without a real `bin/gauntlet`
 * process on the other end.
 */
export type GauntletExec = (
  command: string,
  args: string[],
  options: { cwd: string; encoding: "utf8"; maxBuffer: number; env: NodeJS.ProcessEnv },
) => string;

const execReal: GauntletExec = (command, args, options) => execFileSync(command, args, options);

/**
 * Shells to the MACHINE's `bin/gauntlet <venue>`, judging `targetRoot` — the one spawn every
 * caller of `bin/gauntlet push` against a target needs, so it lives here once rather than once per
 * lane (`integrate/integrate.ts`'s merge gate and `acceptance/land-gate.ts`'s land gate both call
 * this rather than shelling out themselves, which is also what keeps the clone gate from refusing
 * them as copies of each other).
 *
 * `cwd: MACHINE_ROOT`, not `targetRoot`: `bin/gauntlet` derives its own repo root the same way
 * `bin/new-adr` does, from `dirname "${BASH_SOURCE[0]}"` resolved against its *own* working
 * directory when it was invoked with a relative argv0 — running it with `cwd: targetRoot` would
 * have it resolve its own checks against the target instead of the machine. `TARGET_WORKSPACE` is
 * the other half of the interface (owned elsewhere, per ADR-0139): it is what tells the gauntlet
 * which tree to check, independent of where its own script lives.
 *
 * Returns stdout on a clean run and throws on anything else — the same contract `execFileSync`
 * carries, so an existing caller's `try { … } catch (err) { … err.status / err.stdout / reason(err) … }`
 * needs no reshaping to call this instead of a raw `execFileSync`.
 */
export function runGauntlet(venue: GauntletVenue, targetRoot: string, deps: { exec?: GauntletExec } = {}): string {
  const exec = deps.exec ?? execReal;
  return exec(join(MACHINE_ROOT, "bin/gauntlet"), [venue], {
    cwd: MACHINE_ROOT,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: { ...childEnv(), TARGET_WORKSPACE: targetRoot },
  });
}
