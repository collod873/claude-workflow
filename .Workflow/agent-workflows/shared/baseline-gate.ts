import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Whether the running process was invoked as `moduleUrl` directly (`node some-file.ts ...`)
 * rather than imported by something else — the guard every CLI entry point in this family needs
 * before touching `process.argv`, so importing the file for its exports (a test does this) never
 * also runs its CLI. `pathToFileURL(process.argv[1])`, never a hand-built `file://${argv[1]}`: the
 * latter loses percent-encoding on a path with a space, which is this repo's own real checkout
 * path (#139). Call as `isMainModule(import.meta.url)` — `import.meta.url` has to be read at the
 * call site, since it names whichever module the call happens to be written in.
 */
export function isMainModule(moduleUrl: string): boolean {
  return process.argv[1] !== undefined && moduleUrl === pathToFileURL(process.argv[1]).href;
}

/**
 * The `check|update` CLI dispatch and baseline-file plumbing shared by every `<thing>-baseline.ts`
 * gate in this family — commit a standing set of known findings, fail a push only on the delta
 * against a fresh collection, let `update` regenerate the standing set. `wiring-baseline.ts` (#183)
 * had this inline first; `boundaries-baseline.ts` (#305) is what made a second copy the clone gate's
 * problem rather than a coincidence, so the dispatch moved here instead of being copied again.
 */

export interface BaselineFile<Item> {
  /** The day the standing set was last written, so a reader can see how long debt has stood. */
  generated: string;
  why: string;
  items: Item[];
}

/** Serializes a baseline the way it is committed: two-space indent, trailing newline. */
export function serializeBaselineFile<Item>(file: BaselineFile<Item>): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

export function readBaselineFile<Item>(path: string): BaselineFile<Item> {
  return JSON.parse(readFileSync(path, "utf8")) as BaselineFile<Item>;
}

export interface Delta<Item> {
  /** Present now, and not in the standing set — what the gate fails on. */
  added: Item[];
  /** In the standing set, absent now — debt that was paid and should leave the file. */
  resolved: Item[];
}

/** `added`/`resolved` between a baseline and a fresh collection, keyed by `identity`. */
export function compareBaseline<Item>(
  baseline: Item[],
  fresh: Item[],
  identity: (item: Item) => string,
): Delta<Item> {
  const before = new Set(baseline.map(identity));
  const after = new Set(fresh.map(identity));
  return {
    added: fresh.filter((item) => !before.has(identity(item))),
    resolved: baseline.filter((item) => !after.has(identity(item))),
  };
}

export interface DeltaWording<Item> {
  /** One line describing a single item, indented as it should print in a list. */
  describeItem: (item: Item) => string;
  /** The line(s) introducing a nonempty `added` list, ending just before the blank line and the list itself. */
  addedHeader: (count: number) => string[];
  /** The line(s) introducing a nonempty `resolved` list. */
  resolvedHeader: (count: number) => string[];
  /** This gate's own `update` invocation, repo-relative, e.g. `.Workflow/agent-workflows/shared/boundaries-baseline.ts` — printed as the "how to drop this" command after a nonempty `resolved` list. */
  updateScriptPath: string;
}

/**
 * The shape every `describeDelta` in this family builds: a header, a blank line, the list, a
 * blank line — for `added`, then the same for `resolved` — joined with `\n`, or `undefined` when
 * both lists are empty. `wording` carries only the words; this carries the scaffold, once, so a
 * second gate's `describeDelta` doesn't re-lay it out.
 */
export function formatDelta<Item>(delta: Delta<Item>, wording: DeltaWording<Item>): string | undefined {
  if (delta.added.length === 0 && delta.resolved.length === 0) return undefined;

  const lines: string[] = [];
  if (delta.added.length > 0) {
    lines.push(
      ...wording.addedHeader(delta.added.length),
      "",
      ...delta.added.map(wording.describeItem),
      "",
    );
  }
  if (delta.resolved.length > 0) {
    lines.push(
      ...wording.resolvedHeader(delta.resolved.length),
      "",
      ...delta.resolved.map(wording.describeItem),
      "",
      `  node ${wording.updateScriptPath} update <root>`,
      "",
    );
  }
  return lines.join("\n");
}

export interface BaselineGate<Item> {
  /** e.g. "boundaries-baseline.ts" — the CLI's own name, for its usage message. */
  scriptName: string;
  /** e.g. "boundaries" — the label a broken run's error is printed under. */
  label: string;
  /** Repo-relative path the standing set is committed at. */
  baselineRelativePath: string;
  /** Whether `root` is a tree this gate describes at all — a tree that never adopted the gate exits 0 rather than reporting anything. */
  isConfigured: (root: string) => boolean;
  /** Runs the real collector and returns today's items, sorted. Throws on a broken run — a check that could not run is never reported as a finding. */
  collect: (root: string) => Item[];
  /** This gate's own identity for one item, for baseline/fresh comparison. */
  identity: (item: Item) => string;
  /** The `why` a freshly-seeded baseline carries, when there is no prior file to keep the field from. */
  defaultWhy: string;
  /** The gate's message for a nonempty delta, or `undefined` when there's nothing to report. */
  describeDelta: (delta: Delta<Item>) => string | undefined;
}

/**
 * Runs a baseline gate's `check|update [root]` CLI to completion, including `process.exit` — call
 * this as the last line of the file's `isMain` guard. `check` exits 0 (clean), 1 (a new
 * violation or a resolved one the baseline hasn't caught up to), or 2 (could not run — the
 * gauntlet's own broken-check code, ADR-0063). `update` always exits 0 or 2.
 */
export function runBaselineCli<Item>(gate: BaselineGate<Item>): void {
  const [mode, rootArg] = process.argv.slice(2);
  const root = rootArg ?? process.cwd();
  const baselinePath = join(root, gate.baselineRelativePath);

  if (mode !== "check" && mode !== "update") {
    console.error(`usage: ${gate.scriptName} <check|update> [root]`);
    process.exit(2);
  }

  if (!gate.isConfigured(root)) process.exit(0);

  let fresh: Item[];
  try {
    fresh = gate.collect(root);
  } catch (err) {
    console.error(`${gate.label}: ${(err as Error).message}`);
    process.exit(2);
  }

  if (mode === "update") {
    const existing = existsSync(baselinePath) ? readBaselineFile<Item>(baselinePath) : undefined;
    writeFileSync(
      baselinePath,
      serializeBaselineFile({
        generated: new Date().toISOString().slice(0, 10),
        why: existing?.why ?? gate.defaultWhy,
        items: fresh,
      }),
    );
    console.log(`wrote ${fresh.length} item(s) to ${gate.baselineRelativePath}`);
    process.exit(0);
  }

  if (!existsSync(baselinePath)) {
    console.error(`${gate.label}: no baseline at ${gate.baselineRelativePath} — checks not run`);
    process.exit(2);
  }

  const delta = compareBaseline(readBaselineFile<Item>(baselinePath).items, fresh, gate.identity);
  const message = gate.describeDelta(delta);
  if (message !== undefined) {
    console.log(message);
    process.exit(1);
  }
  process.exit(0);
}
