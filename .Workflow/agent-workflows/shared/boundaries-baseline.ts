import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { type Delta, formatDelta, isMainModule, runBaselineCli } from "./baseline-gate.ts";

/**
 * The module-boundaries gate (#305, §4 of #226). `.dependency-cruiser.cjs` answers "may this
 * import that?" for three rules — a lane may not deep-import another lane, `shared/` may never
 * import a lane, no cycles — but every rule in that config is deliberately `severity: "warn"`,
 * because the tree it runs against already carries 67 standing violations. This file is what
 * turns a `warn` into a failing push, on the delta only, using `baseline-gate.ts`'s shared
 * `check|update` CLI — the same shape `wiring-baseline.ts` (#183) uses for knip.
 */

/** Where the standing set lives, relative to the repo root. */
export const BASELINE_RELATIVE_PATH = ".Workflow/agent-workflows/shared/boundaries-baseline.json";

const TARGET = ".Workflow/agent-workflows";

/** One dependency-cruiser rule violation. `rule` plus the two file paths is dependency-cruiser's own identity for an edge. */
export interface Violation {
  /** The rule name from `.dependency-cruiser.cjs` — `no-lane-to-lane-<lane>`, `shared-no-lane`, or `no-circular`. */
  rule: string;
  /** Repo-relative path of the file the edge starts at. */
  from: string;
  /** Repo-relative path of the file the edge points at. */
  to: string;
}

function identity(violation: Violation): string {
  return `${violation.rule} ${violation.from} ${violation.to}`;
}

function byIdentity(a: Violation, b: Violation): number {
  return identity(a) < identity(b) ? -1 : identity(a) > identity(b) ? 1 : 0;
}

/** dependency-cruiser's own binary in `root`, or `undefined` when that root does not have it. */
export function depcruiseBin(root: string): string | undefined {
  const bin = join(root, "node_modules", ".bin", "depcruise");
  return existsSync(bin) ? bin : undefined;
}

/**
 * Whether `root` is a tree this check describes at all. Keyed on the committed config, the same
 * way `wiring-baseline.ts`'s `isConfigured` keys on `knip.config.ts` — a repo that never adopted
 * the gate loses this check on a visible deletion, not a silently empty directory.
 */
export function isConfigured(root: string): boolean {
  return existsSync(join(root, ".dependency-cruiser.cjs"));
}

/** Runs dependency-cruiser against `.Workflow/agent-workflows` and flattens its JSON into violations. */
export function collectViolations(root: string): Violation[] {
  const bin = depcruiseBin(root);
  if (bin === undefined) {
    throw new Error(`dependency-cruiser is not installed in ${root} — run \`npm install\``);
  }

  const run = spawnSync(
    bin,
    ["--config", ".dependency-cruiser.cjs", "--output-type", "json", TARGET],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  if (run.error) throw new Error(`could not run dependency-cruiser: ${run.error.message}`);
  // Every rule in .dependency-cruiser.cjs is severity "warn", so a clean run and a run that
  // found violations both exit 0. Anything else is dependency-cruiser itself failing — a broken
  // gate, which must never be reported as a finding about the code.
  if (run.status !== 0) {
    throw new Error(`dependency-cruiser exited ${run.status}: ${run.stderr.trim()}`);
  }

  let parsed: { summary?: { violations?: Array<Record<string, unknown>> } };
  try {
    parsed = JSON.parse(run.stdout);
  } catch (err) {
    throw new Error(`dependency-cruiser did not emit JSON: ${(err as Error).message}`);
  }

  const violations: Violation[] = [];
  for (const v of parsed.summary?.violations ?? []) {
    violations.push({
      rule: String((v.rule as { name?: string } | undefined)?.name ?? ""),
      from: String(v.from ?? ""),
      to: String(v.to ?? ""),
    });
  }
  return violations.sort(byIdentity);
}

/** The gate's message, or `undefined` when the delta is empty — wording only; `formatDelta` owns the scaffold. */
export function describeDelta(delta: Delta<Violation>): string | undefined {
  return formatDelta(delta, {
    describeItem: (v) => `  ${v.rule}: ${v.from} → ${v.to}`,
    addedHeader: (count) => [
      `${count} new module-boundary violation(s) (#305). A lane deep-importing another lane, or`,
      "shared/ importing a lane, needs a different route — through shared/, an event, or a",
      "published seam. See docs/agents/module-boundaries.md:",
    ],
    resolvedHeader: (count) => [
      `${count} baseline entry(s) no longer violate — debt paid. Drop them from the standing set`,
      "so it keeps measuring something:",
    ],
    updateScriptPath: BASELINE_RELATIVE_PATH.replace(/\.json$/, ".ts"),
  });
}

const isMain = isMainModule(import.meta.url);

if (isMain) {
  runBaselineCli<Violation>({
    scriptName: "boundaries-baseline.ts",
    label: "boundaries",
    baselineRelativePath: BASELINE_RELATIVE_PATH,
    isConfigured,
    collect: collectViolations,
    identity,
    defaultWhy:
      "Standing module-boundary debt at the day this gate landed (#305). The gate fails on " +
      "anything added to this set, never on the set itself; entries leave as each edge is " +
      "routed through shared/ or a published seam instead.",
    describeDelta,
  });
}
