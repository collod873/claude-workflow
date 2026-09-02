import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow";

/**
 * The gate for the defect class ADR-0055 (amended by ADR-0132) introduced: a workflow file whose
 * only trigger is `workflow_call` can never itself carry a run — GitHub records a run reached
 * through `uses:` against the *caller's* file (confirmed on run 33649164483: every job of
 * `verify-caller.yml`'s run comes back `verify / <job name>`, and `verify.yml` itself has carried
 * no run of its own since the split). Anything that names such a file expecting to find its own
 * run history — `actions/workflows/<file>/runs`, or a `workflow_run: workflows:` trigger — is
 * reading a page that can never grow.
 *
 * Two things follow, and this file checks both:
 *
 * 1. No non-test code names a call-only file as the workflow whose runs to read. The fix each
 *    time (`bypass-counter.ts`'s own `verifyWorkflow`, mirrored by `integrate.ts`,
 *    `lost-dispatch-counter.ts` and `bin/close-ticket`'s `verify_workflow_file()`) is a required
 *    input threaded from the caller stub, never a literal baked into the reusable file's own
 *    module — so a literal naming a call-only file appearing anywhere it could be read as "the
 *    workflow to ask the Actions API about" is exactly the mistake this gate exists to catch
 *    before a runner does.
 * 2. Every `workflow_run: workflows: [...]` entry in this repository names a file that actually
 *    can produce the run it is listening for — a caller stub, or any file with a trigger of its
 *    own.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const AGENT_WORKFLOWS_DIR = join(REPO_ROOT, ".Workflow/agent-workflows");
const BIN_DIR = join(REPO_ROOT, "bin");

/** A directory this walk skips outright — build output, dependencies, or a fixture tree carrying its own unrelated `.github/workflows`. */
function skipDir(name: string): boolean {
  return name === "node_modules" || name === "__pycache__" || name.endsWith(".fixtures") || name === ".git";
}

/** Every regular file under `dir`, recursively, skipping the directories `skipDir` names. */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (skipDir(entry)) continue;
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

/**
 * `source` with every comment-only line blanked out — the leading `//`, `/*` and continuation `*`
 * lines this codebase's JSDoc uses, plus `#` for the Python and shell files under `bin/`. A
 * backtick-quoted mention in prose (`` `verify.yml` ``'s own docstring, `bin/close-ticket`'s) is
 * documentation, not a string literal a program reads — this gate is for the latter, so a
 * straight-quoted match inside a comment must not count.
 */
function stripCommentLines(source: string): string {
  return source
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*|#)/.test(line) ? "" : line))
    .join("\n");
}

/** Whether `source` (comments stripped) contains `file` as an actual quoted string literal — `"file"` or `'file'`, never a backtick code-span. */
function quotesLiteral(source: string, file: string): boolean {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["']${escaped}["']`).test(stripCommentLines(source));
}

interface WorkflowShape {
  name?: string;
  on?: Record<string, unknown> | string[];
}

const workflowFiles = readdirSync(WORKFLOWS_DIR).filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"));

const parsed = workflowFiles.map((name) => {
  const { workflow, source } = readWorkflow<WorkflowShape>(name);
  return { name, source, displayName: workflow.name, on: workflow.on };
});

/**
 * Whether a workflow's own `on:` block can ever produce a run of *this* file. `workflow_call`
 * alone cannot — every other trigger (`push`, `repository_dispatch`, `workflow_run`,
 * `workflow_dispatch`, `issues`, `schedule`, …) can, including one that sits alongside
 * `workflow_call` on a file that is reusable *and* directly triggerable.
 */
function canProduceRuns(on: WorkflowShape["on"]): boolean {
  if (on === undefined) return false;
  if (Array.isArray(on)) return on.length > 0 && !(on.length === 1 && on[0] === "workflow_call");
  const keys = Object.keys(on);
  return !(keys.length === 1 && keys[0] === "workflow_call");
}

const callOnly = parsed.filter((workflow) => !canProduceRuns(workflow.on));

describe("a workflow file whose only trigger is workflow_call can never carry a run", () => {
  it("actually finds some call-only files, so this suite is not vacuous", () => {
    expect(callOnly.length).toBeGreaterThan(0);
  });

  const tsFiles = walk(AGENT_WORKFLOWS_DIR).filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"));
  const binFiles = walk(BIN_DIR);

  it.each(callOnly.map((workflow) => workflow.name))(
    "no non-test .ts file under .Workflow/agent-workflows names %s as a string literal",
    (name) => {
      const offenders = tsFiles.filter((path) => quotesLiteral(readFileSync(path, "utf8"), name));
      expect(
        offenders,
        `${name} can never carry a run of its own (ADR-0055, ADR-0132) — reading its history is ` +
          `a frozen page. Thread the caller's own file through as a required input instead ` +
          `(bypass-counter.ts's verifyWorkflow is the pattern).`,
      ).toEqual([]);
    },
  );

  it.each(callOnly.map((workflow) => workflow.name))("no file under bin/ names %s as a string literal", (name) => {
    const offenders = binFiles.filter((path) => quotesLiteral(readFileSync(path, "utf8"), name));
    expect(
      offenders,
      `${name} can never carry a run of its own (ADR-0055, ADR-0132) — reading its history is a ` +
        `frozen page. Require the caller's file from the environment instead (bin/close-ticket's ` +
        `verify_workflow_file() is the pattern).`,
    ).toEqual([]);
  });
});

describe("every workflow_run trigger names a file that can actually produce the run it listens for", () => {
  const triggers = parsed.flatMap((workflow) => {
    const on = workflow.on;
    const workflowRun = on && !Array.isArray(on) ? (on as Record<string, unknown>).workflow_run : undefined;
    const names = (workflowRun as { workflows?: string[] } | undefined)?.workflows ?? [];
    return names.map((named) => ({ from: workflow.name, named }));
  });

  it("actually finds some workflow_run triggers, so this suite is not vacuous", () => {
    expect(triggers.length).toBeGreaterThan(0);
  });

  it.each(triggers)("$from's workflow_run names $named, which resolves to a file that can produce runs", ({ from, named }) => {
    const target = parsed.find((workflow) => workflow.displayName === named);
    expect(target, `${from}'s workflow_run names "${named}", which matches no workflow file's own name:`).toBeDefined();
    expect(
      target && canProduceRuns(target.on),
      `${from}'s workflow_run names "${named}" (${target?.name}), which is call-only and can ` +
        `never produce the run this trigger is listening for.`,
    ).toBe(true);
  });
});
