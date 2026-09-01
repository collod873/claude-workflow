import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINE_RELATIVE_PATH, isConfigured } from "./boundaries-baseline.ts";
import { isMainModule, readBaselineFile } from "./baseline-gate.ts";
import { runGeneratorCli } from "./regenerate-diff-cli.ts";
import type { Violation } from "./boundaries-baseline.ts";

/**
 * The planner's map for #305's module-boundary gate. `.dependency-cruiser.cjs` is the law —
 * three rules, enforced by CI — but a planner deciding whether a new cross-lane edge is
 * warranted should read one committed sentence, not the config's regexes. This generates that
 * sentence from the same two files the gate itself reads, so the doc and the law cannot drift:
 * `.dependency-cruiser.cjs`'s own header comment (the rules, in the words their author already
 * wrote) and `boundaries-baseline.json` (how much standing debt the gate currently excuses).
 *
 * Same `regenerate && diff` shape ADR-0056 uses for `.claude/contract.json` — this file's own
 * `diffDoc` is what `bin/gauntlet push` runs, so a baseline that grows or shrinks without the
 * doc being regenerated goes red instead of the doc quietly lying about the count.
 */

/** Where the generated doc lives, relative to the repo root. */
export const DOC_RELATIVE_PATH = "docs/agents/module-boundaries.md";

const CONFIG_RELATIVE_PATH = ".dependency-cruiser.cjs";

/**
 * Pulls the three numbered rules straight out of `.dependency-cruiser.cjs`'s own header
 * comment — the `1. no-lane-to-lane`, `2. shared-no-lane`, `3. no-circular` block — rather than
 * re-describing them, so a rule's wording can only ever come from the one place that also
 * enforces it.
 */
export function extractRulesProse(configText: string): string {
  const match = configText.match(/ \* Three rules[\s\S]*?\n \*\n \* Violations/);
  if (match === null) {
    throw new Error(
      `${CONFIG_RELATIVE_PATH} no longer has the "Three rules" header block this doc reads from`,
    );
  }
  return match[0]
    .replace(/\n \*\n \* Violations$/, "")
    .split("\n")
    .map((line) => line.replace(/^ \* ?/, ""))
    .join("\n")
    .trim();
}

/** Builds the doc's text from a fresh read of `root`'s config and baseline. */
export function generateBoundariesDoc(root: string): string {
  const configText = readFileSync(join(root, CONFIG_RELATIVE_PATH), "utf8");
  const rulesProse = extractRulesProse(configText);
  const baseline = readBaselineFile<Violation>(join(root, BASELINE_RELATIVE_PATH));

  return `# Module boundaries

Generated from \`${CONFIG_RELATIVE_PATH}\` and \`${BASELINE_RELATIVE_PATH}\` by
\`shared/generate-boundaries-doc.ts\` — edit those, not this file. \`bin/gauntlet push\` fails if
this file disagrees with a fresh regeneration.

${rulesProse}

## Baseline

${baseline.items.length} standing violation(s) as of ${baseline.generated}, excused by the
baseline so the gate fires on a new violation only, never on this debt:

${baseline.why}

A ticket that pays down part of the baseline drops those entries with:

\`\`\`
node .Workflow/agent-workflows/shared/boundaries-baseline.ts update <root>
\`\`\`

## What this is not

Not a per-edge grant manifest. Every lane gets the same three rules — none gets a different
allowance than another (a repo-wide scan for lane-to-lane deep imports outside \`shared/\` and
against these rules found no edge treated differently by design, only by debt) — and \`shared/\`
has no subdirectory doors yet to enumerate grants against. That door split is #226's, filed once
this gate has run long enough to show what the doors should be.
`;
}

/** `undefined` when `committedPath` already matches a fresh regeneration of `root`; otherwise a message naming the fix. */
export function diffDoc(root: string, committedPath: string): string | undefined {
  const fresh = generateBoundariesDoc(root);
  const committed = readFileSync(committedPath, "utf8");
  if (fresh === committed) return undefined;
  return [
    `${committedPath} is stale against a fresh regeneration of ${root}. Regenerate it:`,
    `  node .Workflow/agent-workflows/shared/generate-boundaries-doc.ts ${root} > ${DOC_RELATIVE_PATH}`,
  ].join("\n");
}

// `node generate-boundaries-doc.ts <root>` prints the doc for <root> to stdout; `diff <root>
// <path>` is the `bin/gauntlet push` mode — see `regenerate-diff-cli.ts`'s `runGeneratorCli`.
const isMain = isMainModule(import.meta.url);

if (isMain) {
  runGeneratorCli({
    scriptName: "generate-boundaries-doc.ts",
    pathArgName: "<docPath>",
    generate: generateBoundariesDoc,
    diff: diffDoc,
    isConfigured,
  });
}
