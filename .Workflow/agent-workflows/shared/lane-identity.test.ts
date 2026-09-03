import { describe, expect, it } from "vitest";
import { readWorkflows, STUB_SUFFIX } from "./read-workflow";
import { binSources, laneSources } from "./repo-sources";

function stripCommentLines(source: string): string {
  return source
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/\*|\*|#)/.test(line) ? "" : line))
    .join("\n");
}

function quotesLiteral(source: string, file: string): boolean {
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["']${escaped}["']`).test(stripCommentLines(source));
}

interface WorkflowShape {
  name?: string;
  on?: Record<string, unknown> | string[];
}

const parsed = readWorkflows<WorkflowShape>().map(({ name, workflow }) => ({ name, displayName: workflow.name, on: workflow.on }));

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

  const tsFiles = laneSources().filter((file) => file.path.endsWith(".ts"));
  const binFiles = binSources();

  it.each(callOnly.map((workflow) => workflow.name))(
    "no non-test .ts file under .Workflow/agent-workflows names %s as a string literal",
    (name) => {
      const offenders = tsFiles.filter((file) => quotesLiteral(file.source, name)).map((file) => file.relative);
      expect(
        offenders,
        `${name} can never carry a run of its own (ADR-0055, ADR-0132) — reading its history is ` +
          `a frozen page. Thread the caller's own file through as a required input instead ` +
          `(bypass-counter.ts's verifyWorkflow is the pattern).`,
      ).toEqual([]);
    },
  );

  it.each(callOnly.map((workflow) => workflow.name))("no file under bin/ names %s as a string literal", (name) => {
    const offenders = binFiles.filter((file) => quotesLiteral(file.source, name)).map((file) => file.relative);
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

describe("the caller carries the plain name and the reusable half carries the suffix", () => {
  const REUSABLE_SUFFIX = " (reusable)";

  const laneNames = parsed
    .filter((workflow) => workflow.name.endsWith(STUB_SUFFIX))
    .map((stub) => ({
      lane: stub.name.slice(0, -STUB_SUFFIX.length),
      stub,
      reusable: parsed.find((w) => w.name === `${stub.name.slice(0, -STUB_SUFFIX.length)}.yml`),
    }))
    .filter((pair) => pair.reusable !== undefined);

  it("finds the split lanes, so this suite is not vacuous", () => {
    expect(laneNames.length).toBeGreaterThan(10);
  });

  it.each(laneNames.map((p) => p.lane))("%s's caller stub carries the plain name", (lane) => {
    const pair = laneNames.find((p) => p.lane === lane)!;
    expect(
      pair.stub.displayName?.endsWith(REUSABLE_SUFFIX) || pair.stub.displayName?.includes("(caller)"),
      `${pair.stub.name} is the half that produces runs, so it owns the bare name a reader and a ` +
        `workflow_run trigger both reach for — it must not carry a suffix.`,
    ).toBe(false);
  });

  it.each(laneNames.map((p) => p.lane))("%s's reusable half is suffixed, so its name is never mistaken for the lane", (lane) => {
    const pair = laneNames.find((p) => p.lane === lane)!;
    expect(
      pair.reusable?.displayName,
      `${pair.reusable?.name} can never carry a run of its own, so its name must not read as the ` +
        `lane's — a workflow_run naming it would fire never, silently.`,
    ).toBe(`${pair.stub.displayName}${REUSABLE_SUFFIX}`);
  });
});
