import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LABELS_APPLIED } from "./shape";

/**
 * The half of this lane's contract that lives on the far side of a language
 * boundary no compiler and no type checker can see across.
 *
 * #63 is what that costs: two lenses built and wired to a dispatch the hook
 * never sent, so every `Audit` run — fourteen of them — skipped, and a skipped
 * run is green (#107). Everything below is a claim about wiring, asserted
 * against the YAML rather than believed about it.
 */

const SHAPE_WORKFLOW = ".github/workflows/shape.yml";
const ACCEPT_WORKFLOW = ".github/workflows/shape-accept.yml";

const shape = readFileSync(SHAPE_WORKFLOW, "utf8");
const acceptWorkflow = readFileSync(ACCEPT_WORKFLOW, "utf8");

/** Every TypeScript entrypoint a workflow hands to `npx tsx`. */
function entrypointsOf(source: string): string[] {
  return [...source.matchAll(/npx tsx (\S+\.ts)/g)].map((match) => match[1]);
}

describe("the chain's trigger", () => {
  it("is the `idea` label, which §00's form applies at creation", () => {
    expect(shape).toMatch(/github\.event\.label\.name == 'idea'/);
  });

  it("also fires on a comment, which is §01's fourth owner verb", () => {
    expect(shape).toMatch(/issue_comment:/);
    expect(shape).toMatch(/contains\(github\.event\.issue\.labels\.\*\.name, 'idea'\)/);
  });

  it("excludes bot comments, or the sheet it posts would trigger the job that posted it", () => {
    expect(shape).toMatch(/github\.event\.comment\.user\.type != 'Bot'/);
  });

  it("excludes pull requests, which arrive through the same event", () => {
    expect(shape).toMatch(/!github\.event\.issue\.pull_request/);
  });

  // ADR-0073. §00's form carries `labels: ["idea"]`, so on a public repository
  // the trigger fires for a stranger's issue exactly as for the owner's — and
  // this lane spends the owner's personal subscription, uncapped. Both triggers
  // are gated on who caused them, and the two use different fields because the
  // events carry different ones.
  it("fires the label trigger only for the owner, who is the sender of the label", () => {
    expect(shape).toMatch(/github\.event\.sender\.login == github\.repository_owner/);
  });

  it("fires the comment trigger only for someone with standing in the repo", () => {
    expect(shape).toMatch(/github\.event\.comment\.author_association/);
    for (const standing of ["OWNER", "MEMBER", "COLLABORATOR"]) {
      expect(shape).toContain(`"${standing}"`);
    }
  });

  it("keeps the bot exclusion, which refuses a loop rather than a stranger", () => {
    // Distinct conditions doing distinct jobs: were the author gate ever read
    // as subsuming this one, the sheet this job posts would trigger the job
    // that posted it.
    expect(shape).toMatch(/github\.event\.comment\.user\.type != 'Bot'/);
  });
});

describe("the accept's trigger", () => {
  // §01: **all four owner verbs are labels**, never comment prose — a label is
  // something a gate can fire on. Three of them reach `accept.ts`; the fourth
  // (`go-long`/`go-short`) is a modifier read off the issue, not a trigger.
  it.each(["approved", "parked", "killed"])("fires on `%s`", (verb) => {
    expect(acceptWorkflow).toContain(`github.event.label.name == '${verb}'`);
  });

  it("does not fire on the route overrides, which modify an accept rather than being one", () => {
    expect(acceptWorkflow).not.toContain("'go-long'");
    expect(acceptWorkflow).not.toContain("'go-short'");
  });
});

describe("every entrypoint a workflow names exists", () => {
  it.each([
    [SHAPE_WORKFLOW, shape],
    [ACCEPT_WORKFLOW, acceptWorkflow],
  ])("%s", (name, source) => {
    const entrypoints = entrypointsOf(source);

    expect(entrypoints.length, `${name} runs no TypeScript entrypoint`).toBeGreaterThan(0);
    for (const entrypoint of entrypoints) {
      expect(existsSync(entrypoint), `${name} runs ${entrypoint}, which does not exist`).toBe(true);
    }
  });
});

describe("every label the lane applies is one a workflow creates", () => {
  // `gh issue edit --add-label` fails on a label that does not exist, and it
  // fails at the moment the lane is trying to report something — a refusal
  // that dies reporting a refusal. The verb labels are created here too,
  // because a sheet posts before any verb is applied and a verb the owner
  // cannot find on his phone is a verb that does not exist.
  const created = [...shape.matchAll(/gh label create (\S+)/g)].map((match) => match[1]);

  it.each([...LABELS_APPLIED, "approved", "parked", "killed", "go-long", "go-short"])(
    "%s",
    (label) => {
      expect(created).toContain(label);
    },
  );

  it("creates them idempotently, so a rerun and a fresh clone both work", () => {
    const creations = shape.match(/gh label create[\s\S]*?--force/g) ?? [];
    expect(creations).toHaveLength(created.length);
  });
});

describe("the prompts the chain names exist", () => {
  it.each([
    ".Workflow/agent-workflows/shape/sweep/prompt.md",
    ".Workflow/agent-workflows/shape/shaper/prompt.md",
    ".Workflow/agent-workflows/shape/refuter/prompt.md",
  ])("%s", (path) => {
    expect(existsSync(path)).toBe(true);
  });

  it("substitutes every placeholder each prompt declares", () => {
    // `runStage` throws, without spawning, on a template referencing a
    // placeholder no var covers — a wiring bug worth catching here rather
    // than on a runner two minutes into a model call.
    const declared = (path: string): string[] =>
      [...readFileSync(path, "utf8").matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);

    const supplied = [...readFileSync(".Workflow/agent-workflows/shape/shape.ts", "utf8").matchAll(/^\s{6}(\w+):/gm)].map(
      (match) => match[1],
    );

    for (const name of declared(".Workflow/agent-workflows/shape/shaper/prompt.md")) {
      expect(supplied, `the shaper's prompt references {{${name}}}`).toContain(name);
    }
  });
});
