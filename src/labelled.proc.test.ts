import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { afterLabelled, BIN, copyMark, execute, heldBy, holds, labelledAs, labelledStep, scratch, script, starts, workflowJobs, type IssueEvent } from "./scenarios.ts";
import { MACHINE, OWNER } from "./spelled.ts";

const GITHUB = join(BIN, "..", ".github");
const files = () => [
  ...readdirSync(join(GITHUB, "workflows")).map((file) => join(GITHUB, "workflows", file)),
  ...readdirSync(join(GITHUB, "actions")).map((action) => join(GITHUB, "actions", action, "action.yml")),
];

const BEFORE = {
  build: "${{ (github.event.action == 'opened' || github.event.action == 'reopened' || (github.event.action == 'unlabeled' && (github.event.label.name == 'waiting' || github.event.label.name == 'paused' || github.event.label.name == 'stuck'))) && (github.event.sender.login == github.repository_owner || (github.event.sender.login == 'collod873-machine[bot]' && (github.event.action == 'unlabeled' || github.event.action == 'opened'))) && !contains(github.event.issue.labels.*.name, 'note') && !contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'waiting') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') }}",
  slice: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'spec') }}",
  research: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'research') }}",
  doneCheck: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') }}",
  reslice: "${{ !contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'note') }}",
};

const each = (senders: string[], actions: Omit<IssueEvent, "labels" | "sender">[], labelSets: string[][]): IssueEvent[] =>
  senders.flatMap((sender) => actions.flatMap((action) => labelSets.map((labels) => ({ sender, ...action, labels }))));

const BUILT_ON = each(
  [OWNER, MACHINE, "stranger"],
  [{ action: "opened" }, { action: "reopened" }, { action: "unlabeled", label: "waiting" }, { action: "unlabeled", label: "building" }, { action: "unlabeled", label: "paused" }, { action: "unlabeled", label: "stuck" }, { action: "labeled", label: "paused" }],
  [[], ["ticket"], ["ticket", "note"], ["spec"], ["ticket", "waiting"], ["ticket", "paused"], ["ticket", "stuck"]],
);

const GATED = [
  { file: "tickets.yml", job: "build", before: BEFORE.build, events: BUILT_ON },
  { file: "specs.yml", job: "slice", before: BEFORE.slice, events: each([OWNER, "stranger"], [{ action: "opened" }], [[], ["spec"], ["note"], ["spec", "paused"], ["spec", "stuck"]]) },
  { file: "specs.yml", job: "research", before: BEFORE.research, events: each([OWNER, "stranger"], [{ action: "opened" }], [[], ["note"], ["note", "research"]]) },
  { file: "specs.yml", job: "asked", before: BEFORE.doneCheck, events: each([OWNER, MACHINE], [{ action: "created", event: "issue_comment" }], [[], ["ticket"], ["spec"], ["spec", "paused"], ["spec", "stuck"]]) },
  { file: "specs.yml", job: "ended", before: BEFORE.reslice, events: each([OWNER, MACHINE], [{ action: "closed" }], [[], ["ticket"], ["spec"], ["note"], ["ticket", "waiting"]]) },
];

describe("the workflows ask spelled for each label they test, so a renamed label cannot pass unseen (#1108)", () => {
  for (const { file, job, before, events } of GATED) {
    it(`${file} starts or skips ${job} on the same labels as before`, async () => {
      const said = (event: IssueEvent) => `${event.sender ?? ""} ${event.action ?? ""}${event.label === undefined ? "" : ` -${event.label}`} [${(event.labels ?? []).join(",")}]`;
      const now = await Promise.all(events.map(async (event) => `${said(event)} ${String(await starts(file, job, event))}`));

      expect(now).toEqual(events.map((event) => `${said(event)} ${String(holds(before, event))}`));
    });
  }

  it("ends the labelled step red, holding nothing, when spelled cannot answer", async () => {
    for (const { file, job } of GATED) {
      const root = scratch("unspelled-");
      script(join(root, "bin", "spelled"), "printf 'node: not found\\n' >&2\nexit 127\n");

      expect(await heldBy(labelledStep(file, job), root, { labels: ["spec"] }), file).toEqual({ failed: true, held: undefined });
    }
  });

  it("asks spelled only for keys it holds", () => {
    const root = scratch("keys-");
    copyMark(root);
    const keys = new Set(files().flatMap((file) => [...readFileSync(file, "utf8").matchAll(/(?:bin|\$machine)\/spelled"? ([A-Z_]+)/g)].map(([, key]) => key ?? "")));

    expect([...keys].sort()).toEqual(["ASKED", "BUILDING", "CHECKING", "MACHINE", "NOTE", "OWNER_CALL", "PAUSED", "RESEARCH", "SPEC", "STUCK", "TICKET_PREFIX", "WAITING"]);
    for (const key of keys) expect(execute(join(root, "bin", "spelled"), root, {}, [key]).status, key).toBe(0);
  });

  it("tests only sender and event in a job's if, never a label", () => {
    for (const file of readdirSync(join(GITHUB, "workflows"))) {
      for (const [name, job] of Object.entries(workflowJobs(file))) expect(job.if ?? "", `${file} ${name}`).not.toMatch(/labels|label\.name|labelled/);
    }
    for (const { file, job } of GATED) {
      const tested = (workflowJobs(file)[job]?.if ?? "").replace(/github\.event\.(sender\.login|action)|github\.event_name|github\.repository_owner|'[^']*'|[\s()&|=!${}"]/g, "");
      expect(tested, `${file} ${job}`).toBe("");
    }
  });

  it("asks spelled in each gated job's first step past checkout and Node, and runs nothing after it on a label it does not start on, green or red", () => {
    for (const { file, job } of GATED) {
      const { steps } = workflowJobs(file)[job] ?? { steps: [] };
      const at = steps.findIndex(({ id }) => id === "labelled");
      const before = steps.slice(0, at);

      expect(before.every((step) => step.uses?.startsWith("actions/") === true), `${file} ${job}`).toBe(true);
      expect(before.some((step) => step.uses?.startsWith("actions/setup-node@") === true), `${file} ${job}`).toBe(true);
      expect(afterLabelled(steps).length, `${file} ${job}`).toBeGreaterThan(0);
      for (const step of afterLabelled(steps)) {
        for (const failed of [false, true]) expect(holds(step.if ?? "success()", { steps: labelledAs(steps, "false"), failed }), `${file} ${job} ${step.id ?? step.uses ?? ""}`).toBe(false);
      }
    }
  });

  it("lets a refused mark end its job red, following no mark with || true", () => {
    for (const file of files()) expect(readFileSync(file, "utf8"), file).not.toMatch(/bin\/mark\b[^\n]*\|\|\s*true/);
  });
});

describe("check.yml asks spelled which branches it reviews and meters, so a renamed prefix cannot pass unseen (#1121)", () => {
  const BEFORE_CHECK = "${{ startsWith(github.head_ref, 'ticket/') && github.event.pull_request.head.repo.full_name == github.repository }}";
  const heads = ["ticket/811", "ticket/", "land/4b58f3372b91", "main", "tickets/811", "fix/ticket/811"];

  for (const job of ["review", "meters"]) {
    it(`starts or skips ${job} on the same branches and forks as before`, async () => {
      const events = heads.flatMap((head) => [false, true].map((fork) => ({ head, fork })));
      const now = await Promise.all(events.map(async (event) => `${event.head} ${String(event.fork)} ${String(await starts("check.yml", job, event))}`));

      expect(now).toEqual(events.map((event) => `${event.head} ${String(event.fork)} ${String(holds(BEFORE_CHECK, event))}`));
    });

    it(`tests only the fork in the ${job} job's if, and runs nothing past its labelled step on a branch it does not review, green or red`, () => {
      const { if: gated = "", steps } = workflowJobs("check.yml")[job] ?? { steps: [] };

      expect(gated).not.toMatch(/head_ref|ticket/);
      expect(afterLabelled(steps).length).toBeGreaterThan(0);
      for (const step of afterLabelled(steps)) {
        for (const failed of [false, true]) expect(holds(step.if ?? "success()", { steps: labelledAs(steps, "false"), failed }), `${job} ${step.id ?? step.uses ?? ""}`).toBe(false);
      }
    });

    it(`ends the ${job} job's labelled step red, holding nothing, when spelled cannot answer`, async () => {
      const root = scratch("unspelled-");
      script(join(root, "bin", "spelled"), "printf 'node: not found\\n' >&2\nexit 127\n");

      expect(await heldBy(labelledStep("check.yml", job), root, { head: "ticket/811" })).toEqual({ failed: true, held: undefined });
    });
  }
});
