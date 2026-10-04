import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BIN, copyMark, execute, heldBy, holds, labelledStep, MACHINE, OWNER, scratch, script, starts, workflowJobs, type IssueEvent } from "./scenarios.ts";

const GITHUB = join(BIN, "..", ".github");
const files = () => [
  ...readdirSync(join(GITHUB, "workflows")).map((file) => join(GITHUB, "workflows", file)),
  ...readdirSync(join(GITHUB, "actions")).map((action) => join(GITHUB, "actions", action, "action.yml")),
];

const BEFORE = {
  build: "${{ (github.event.action != 'unlabeled' || github.event.label.name == 'waiting') && (github.event.sender.login == github.repository_owner || (github.event.sender.login == 'collod873-machine[bot]' && (github.event.action == 'unlabeled' || github.event.action == 'opened'))) && !contains(github.event.issue.labels.*.name, 'note') && !contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'waiting') }}",
  slice: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'spec') }}",
  research: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'research') }}",
  doneCheck: "${{ github.event.sender.login == github.repository_owner && contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'needs-human') }}",
  reslice: "${{ !contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'note') }}",
};

const each = (senders: string[], actions: Omit<IssueEvent, "labels" | "sender">[], labelSets: string[][]): IssueEvent[] =>
  senders.flatMap((sender) => actions.flatMap((action) => labelSets.map((labels) => ({ sender, ...action, labels }))));

const GATED = [
  {
    file: "build.yml",
    job: "build",
    before: BEFORE.build,
    events: each(
      [OWNER, MACHINE, "stranger"],
      [{ action: "opened" }, { action: "reopened" }, { action: "unlabeled", label: "waiting" }, { action: "unlabeled", label: "building" }],
      [[], ["ticket"], ["ticket", "note"], ["spec"], ["ticket", "waiting"], ["ticket", "needs-human"]],
    ),
  },
  { file: "slice.yml", job: "slice", before: BEFORE.slice, events: each([OWNER, "stranger"], [{ action: "opened" }], [[], ["spec"], ["note"], ["spec", "needs-human"]]) },
  { file: "research.yml", job: "research", before: BEFORE.research, events: each([OWNER, "stranger"], [{ action: "opened" }], [[], ["note"], ["note", "research"]]) },
  { file: "done-check.yml", job: "asked", before: BEFORE.doneCheck, events: each([OWNER, MACHINE], [{ action: "created" }], [[], ["ticket"], ["spec"], ["spec", "needs-human"]]) },
  { file: "reslice.yml", job: "ended", before: BEFORE.reslice, events: each([OWNER, MACHINE], [{ action: "closed" }], [[], ["ticket"], ["spec"], ["note"], ["ticket", "waiting"]]) },
];

describe("the workflows ask spelled for each label they test, so a renamed label cannot pass unseen (#1108)", () => {
  for (const { file, job, before, events } of GATED) {
    it(`${file} starts or skips ${job} on the same labels as before`, async () => {
      const said = (event: IssueEvent) => `${event.sender ?? ""} ${event.action ?? ""}${event.label === undefined ? "" : ` -${event.label}`} [${(event.labels ?? []).join(",")}]`;
      const now = await Promise.all(events.map(async (event) => `${said(event)} ${String(await starts(file, job, event))}`));

      expect(now).toEqual(events.map((event) => `${said(event)} ${String(holds(before, event))}`));
    });
  }

  it("reslice.yml still reslices on the closer's dispatch, which names no issue", async () => {
    expect(await starts("reslice.yml", "ended", { action: "" })).toBe(true);
  });

  it("ends the labelled step red, holding nothing, when spelled cannot answer", async () => {
    for (const { file } of GATED) {
      const root = scratch("unspelled-");
      script(join(root, "bin", "spelled"), "printf 'node: not found\\n' >&2\nexit 127\n");

      expect(await heldBy(labelledStep(file), root, { labels: ["spec"] }), file).toEqual({ failed: true, held: undefined });
    }
  });

  it("asks spelled only for keys it holds", () => {
    const root = scratch("keys-");
    copyMark(root);
    const keys = new Set(files().flatMap((file) => [...readFileSync(file, "utf8").matchAll(/bin\/spelled ([A-Z_]+)/g)].map(([, key]) => key ?? "")));

    expect([...keys].sort()).toEqual(["BUILDING", "CHECKING", "NEEDS_HUMAN", "NOTE", "RESEARCH", "SPEC", "WAITING"]);
    for (const key of keys) expect(execute(join(root, "bin", "spelled"), root, {}, [key]).status, key).toBe(0);
  });

  it("tests only sender and event in a job's if, never a label", () => {
    for (const file of readdirSync(join(GITHUB, "workflows"))) {
      for (const [name, job] of Object.entries(workflowJobs(file))) expect(job.if ?? "", `${file} ${name}`).not.toMatch(/labels|label\.name/);
    }
  });

  it("lets a refused mark end its job red, following no mark with || true", () => {
    for (const file of files()) expect(readFileSync(file, "utf8"), file).not.toMatch(/bin\/mark\b[^\n]*\|\|\s*true/);
  });
});
