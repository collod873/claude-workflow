import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterLabelled, BIN, copyMark, execute, gateOf, holds, labelledAs, labelledOutputs, labelledStep, scratch, script, starts, workflowJobs, type IssueEvent } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";

const GITHUB = join(BIN, "..", ".github");
const files = () => [
  ...readdirSync(join(GITHUB, "workflows")).map((file) => join(GITHUB, "workflows", file)),
  ...readdirSync(join(GITHUB, "actions")).map((action) => join(GITHUB, "actions", action, "action.yml")),
];

const BEFORE = {
  build: "${{ ((github.event.action == 'labeled' && github.event.label.name == 'ticket') || (github.event.action == 'unlabeled' && (github.event.label.name == 'waiting' || github.event.label.name == 'paused' || github.event.label.name == 'stuck'))) && github.event.issue.state != 'closed' && (github.event.sender.login == github.repository_owner || (github.event.sender.login == 'collod873-machine[bot]' && (github.event.action == 'unlabeled' || github.event.action == 'labeled'))) && contains(github.event.issue.labels.*.name, 'ticket') && !contains(github.event.issue.labels.*.name, 'note') && !contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'waiting') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') }}",
  spec: "${{ contains(github.event.issue.labels.*.name, 'spec') && github.event.issue.state != 'closed' && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') && (((github.event.sender.login == github.repository_owner || github.event.sender.login == 'collod873-machine[bot]') && github.event.action == 'labeled' && github.event.label.name == 'spec') || (github.event.sender.login == github.repository_owner && github.event.action == 'unlabeled' && (github.event.label.name == 'paused' || github.event.label.name == 'stuck'))) }}",
  research: "${{ contains(github.event.issue.labels.*.name, 'research') && github.event.issue.state != 'closed' && (((github.event.sender.login == github.repository_owner || github.event.sender.login == 'collod873-machine[bot]') && github.event.action == 'labeled' && github.event.label.name == 'research') || (github.event.sender.login == github.repository_owner && github.event.action == 'unlabeled' && (github.event.label.name == 'paused' || github.event.label.name == 'stuck') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck'))) }}",
  doneCheck: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') }}",
};

const each = (senders: string[], actions: Omit<IssueEvent, "labels" | "sender">[], labelSets: string[][]): IssueEvent[] =>
  senders.flatMap((sender) => actions.flatMap((action) => labelSets.map((labels) => ({ sender, ...action, labels }))));

const BUILT_ON = each(
  [OWNER, MACHINE, "stranger"],
  [{ action: "opened" }, { action: "reopened" }, { action: "labeled", label: "ticket" }, { action: "labeled", label: "bug" }, { action: "labeled", label: "ticket", state: "closed" }, { action: "unlabeled", label: "paused", state: "closed" }, { action: "unlabeled", label: "waiting" }, { action: "unlabeled", label: "building" }, { action: "unlabeled", label: "paused" }, { action: "unlabeled", label: "stuck" }, { action: "labeled", label: "paused" }],
  [[], ["ticket"], ["ticket", "bug"], ["ticket", "note"], ["spec"], ["ticket", "waiting"], ["ticket", "paused"], ["ticket", "stuck"]],
);

const GATED = [
  { file: "tickets.yml", job: "build", before: BEFORE.build, events: BUILT_ON },
  { file: "specs.yml", job: "spec", before: BEFORE.spec, events: each([OWNER, MACHINE, "stranger"], [{ action: "opened" }, { action: "reopened" }, { action: "labeled", label: "spec" }, { action: "labeled", label: "note" }, { action: "labeled", label: "spec", state: "closed" }, { action: "unlabeled", label: "stuck", state: "closed" }, { action: "unlabeled", label: "stuck" }, { action: "unlabeled", label: "paused" }, { action: "unlabeled", label: "building" }, { action: "labeled", label: "stuck" }], [[], ["spec"], ["note"], ["spec", "paused"], ["spec", "stuck"]]) },
  { file: "specs.yml", job: "research", before: BEFORE.research, events: each([OWNER, MACHINE, "stranger"], [{ action: "opened" }, { action: "reopened" }, { action: "labeled", label: "research" }, { action: "labeled", label: "note" }, { action: "labeled", label: "research", state: "closed" }, { action: "unlabeled", label: "stuck", state: "closed" }, { action: "unlabeled", label: "stuck" }, { action: "unlabeled", label: "paused" }, { action: "unlabeled", label: "researching" }, { action: "labeled", label: "stuck" }], [[], ["note"], ["note", "research"], ["note", "research", "stuck"], ["note", "research", "paused"]]) },
  { file: "specs.yml", job: "asked", before: BEFORE.doneCheck, events: each([OWNER, MACHINE], [{ action: "created", event: "issue_comment" }], [[], ["ticket"], ["spec"], ["spec", "paused"], ["spec", "stuck"]]) },
];

describe("the workflows ask spelled for each label they test, so a renamed label cannot pass unseen (#1108)", () => {
  for (const { file, job, before, events } of GATED) {
    it(`${file} starts or skips ${job} on the same labels as before`, async () => {
      const said = (event: IssueEvent) => `${event.sender ?? ""} ${event.action ?? ""}${event.label === undefined ? "" : ` -${event.label}`} [${(event.labels ?? []).join(",")}]${event.state === undefined ? "" : ` ${event.state}`}`;
      const now = await Promise.all(events.map(async (event) => `${said(event)} ${String(await starts(file, job, event))}`));

      expect(now).toEqual(events.map((event) => `${said(event)} ${String(holds(before, event))}`));
    });
  }

  it("ends the labelled step red, holding nothing, when spelled cannot answer", async () => {
    for (const { file, job } of GATED) {
      const root = scratch("unspelled-");
      script(join(root, "bin", "spelled"), "printf 'node: not found\\n' >&2\nexit 127\n");

      expect(await labelledOutputs(labelledStep(file, job), root, { labels: ["spec"] }), file).toEqual({ failed: true, outputs: {} });
    }
  });

  it("asks spelled only for keys it holds", () => {
    const root = scratch("keys-");
    copyMark(root);
    const keys = new Set(files().flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:bin|\$machine)\/spelled"? ([A-Z_]+)/g)].map(([, key]) => key ?? "")));

    expect(keys).toContain("STUCK");
    for (const key of keys) expect(execute(join(root, "bin", "spelled"), root, {}, [key]).status, key).toBe(0);
  });

  it("tests only sender and event in a job's if, never a label", () => {
    for (const file of readdirSync(join(GITHUB, "workflows"))) {
      for (const [name, job] of Object.entries(workflowJobs(file))) expect(job.if ?? "", `${file} ${name}`).not.toMatch(/labels|label\.name|labelled/);
    }
  });

  it("asks spelled in each gated job's first step past checkout and Node, or in a job it needs, and runs nothing after it on a label it does not start on, green or red", () => {
    for (const { file, job } of GATED) {
      const gate = gateOf(file, job);
      const { steps } = workflowJobs(file)[gate] ?? { steps: [] };
      const at = steps.findIndex(({ id }) => id === "labelled");
      const before = steps.slice(0, at);
      const gated = gate === job ? afterLabelled(steps).map((step) => ({ name: step.id ?? step.uses ?? "", if: step.if, context: { steps: labelledAs(steps, "false") } })) : [{ name: job, if: workflowJobs(file)[job]?.if, context: { needs: { [gate]: { result: "success", outputs: Object.fromEntries(Object.keys(workflowJobs(file)[gate]?.outputs ?? {}).map((output) => [output, "false"])) } } } }];

      expect(before.every((step) => step.uses?.startsWith("actions/") === true), `${file} ${job}`).toBe(true);
      expect(before.some((step) => step.uses?.startsWith("actions/setup-node@") === true), `${file} ${job}`).toBe(true);
      expect(gated.length, `${file} ${job}`).toBeGreaterThan(0);
      for (const { name, if: condition, context } of gated) {
        for (const failed of [false, true]) expect(holds(condition ?? "success()", { ...context, failed }), `${file} ${job} ${name}`).toBe(false);
      }
    }
  });

  it("lets a refused mark end its job red, following no mark with || true", () => {
    for (const file of files()) expect(readFileSync(file, "utf8"), file).not.toMatch(/bin\/mark\b[^\n]*\|\|\s*true/);
  });
});

describe("tickets.yml builds only an issue labelled ticket, so one opened by hand without it is kept and never built (collod873/agent-hooks#38)", () => {
  it("builds what file-issue files as build or bug, and nothing the owner opens bare or another tool files under its own labels", async () => {
    const opened = (labels: string[]) => starts("tickets.yml", "build", { sender: OWNER, action: "opened", labels });

    expect(await opened(["bug", "from-app"])).toBe(false);
  });
});
