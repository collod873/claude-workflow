import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BIN, copyMark, execute, gateOf, holds, payloadOf, scratch, starts, wakeStep, workflowJobs, type IssueEvent } from "./scenarios.ts";
import { MACHINE, OWNER, PAUSED, SPEC, STUCK, TICKET, WAITING } from "./spelled.ts";
import { woken } from "./wake.ts";

const GITHUB = join(BIN, "..", ".github");
const files = () => [
  ...readdirSync(join(GITHUB, "workflows")).map((file) => join(GITHUB, "workflows", file)),
  ...readdirSync(join(GITHUB, "actions")).map((action) => join(GITHUB, "actions", action, "action.yml")),
];

const BEFORE = {
  build: "${{ ((github.event.action == 'labeled' && github.event.label.name == 'ticket') || (github.event.action == 'unlabeled' && (github.event.label.name == 'waiting' || (github.event.sender.login == github.repository_owner && (github.event.label.name == 'paused' || github.event.label.name == 'stuck')) || (github.event.sender.login == 'collod873-machine[bot]' && github.event.label.name == 'stuck')))) && github.event.issue.state != 'closed' && (github.event.sender.login == github.repository_owner || (github.event.sender.login == 'collod873-machine[bot]' && (github.event.action == 'unlabeled' || github.event.action == 'labeled'))) && contains(github.event.issue.labels.*.name, 'ticket') && !contains(github.event.issue.labels.*.name, 'note') && !contains(github.event.issue.labels.*.name, 'spec') && !contains(github.event.issue.labels.*.name, 'waiting') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') }}",
  spec: "${{ contains(github.event.issue.labels.*.name, 'spec') && github.event.issue.state != 'closed' && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') && !contains(github.event.issue.labels.*.name, 'waiting') && (((github.event.sender.login == github.repository_owner || github.event.sender.login == 'collod873-machine[bot]') && github.event.action == 'labeled' && github.event.label.name == 'spec') || (github.event.sender.login == github.repository_owner && github.event.action == 'unlabeled' && (github.event.label.name == 'paused' || github.event.label.name == 'stuck' || github.event.label.name == 'waiting')) || (github.event.sender.login == 'collod873-machine[bot]' && github.event.action == 'unlabeled' && (github.event.label.name == 'waiting' || github.event.label.name == 'stuck'))) }}",
  research: "${{ contains(github.event.issue.labels.*.name, 'research') && github.event.issue.state != 'closed' && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck') && (((github.event.sender.login == github.repository_owner || github.event.sender.login == 'collod873-machine[bot]') && github.event.action == 'labeled' && github.event.label.name == 'research') || (github.event.sender.login == github.repository_owner && github.event.action == 'unlabeled' && (github.event.label.name == 'paused' || github.event.label.name == 'stuck') && !contains(github.event.issue.labels.*.name, 'paused') && !contains(github.event.issue.labels.*.name, 'stuck')) || (github.event.sender.login == 'collod873-machine[bot]' && github.event.action == 'unlabeled' && github.event.label.name == 'stuck')) }}",
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
  { file: "specs.yml", job: "spec", before: BEFORE.spec, events: each([OWNER, MACHINE, "stranger"], [{ action: "opened" }, { action: "reopened" }, { action: "labeled", label: "spec" }, { action: "labeled", label: "note" }, { action: "labeled", label: "spec", state: "closed" }, { action: "unlabeled", label: "stuck", state: "closed" }, { action: "unlabeled", label: "stuck" }, { action: "unlabeled", label: "paused" }, { action: "unlabeled", label: "building" }, { action: "unlabeled", label: "waiting" }, { action: "labeled", label: "stuck" }], [[], ["spec"], ["note"], ["spec", "paused"], ["spec", "stuck"], ["spec", "waiting"]]) },
  { file: "specs.yml", job: "research", before: BEFORE.research, events: each([OWNER, MACHINE, "stranger"], [{ action: "opened" }, { action: "reopened" }, { action: "labeled", label: "research" }, { action: "labeled", label: "note" }, { action: "labeled", label: "research", state: "closed" }, { action: "unlabeled", label: "stuck", state: "closed" }, { action: "unlabeled", label: "stuck" }, { action: "unlabeled", label: "paused" }, { action: "unlabeled", label: "researching" }, { action: "labeled", label: "stuck" }], [[], ["note"], ["note", "research"], ["note", "research", "stuck"], ["note", "research", "paused"]]) },
];

describe("both workflows wake through bin/wake, so a ticket, a spec and a research note start on one rule (#1108, #1730)", () => {
  for (const { file, job, before, events } of GATED) {
    it(`${file} starts or skips ${job} on the same labels as before, and also once the repair agent takes stuck off (#1761)`, () => {
      const said = (event: IssueEvent) => `${event.sender ?? ""} ${event.action ?? ""}${event.label === undefined ? "" : ` -${event.label}`} [${(event.labels ?? []).join(",")}]${event.state === undefined ? "" : ` ${event.state}`}`;
      const now = events.map((event) => `${said(event)} ${String(starts(file, job, event))}`);

      expect(now).toEqual(events.map((event) => `${said(event)} ${String(holds(before, event))}`));
    });
  }

  it("writes each stage's answer to the step's outputs, and ends red writing nothing on an event it cannot read", () => {
    const root = scratch("wake-");
    const [event, output, broken] = ["event.json", "output", "broken.json"].map((name) => join(root, name)) as [string, string, string];
    writeFileSync(event, JSON.stringify(payloadOf({ action: "labeled", label: "spec", labels: ["spec"] })));
    writeFileSync(broken, "{");
    const woke = execute(join(BIN, "wake"), root, { GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output });

    expect({ status: woke.status, written: readFileSync(output, "utf8") }).toEqual({ status: 0, written: "build=false\nspec=true\nresearch=false\n" });
    expect(execute(join(BIN, "wake"), root, { GITHUB_EVENT_PATH: broken, GITHUB_OUTPUT: join(root, "unwritten") }).status).toBe(1);
    expect(readdirSync(root)).not.toContain("unwritten");
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

  it("wakes each gated job in a job it needs, whose wake step runs bin/wake past only checkout and Node, and starts no job on a false answer, green or red", () => {
    for (const { file, job } of GATED) {
      const gate = gateOf(file, job);
      const { steps } = workflowJobs(file)[gate] ?? { steps: [] };
      const before = steps.slice(0, steps.findIndex(({ id }) => id === "wake"));
      const answered = { [gate]: { result: "success", outputs: Object.fromEntries(Object.keys(workflowJobs(file)[gate]?.outputs ?? {}).map((output) => [output, "false"])) } };

      expect(gate, `${file} ${job}`).not.toBe(job);
      expect(wakeStep(file, job).run, `${file} ${job}`).toBe("bin/wake");
      expect(before.every((step) => step.uses?.startsWith("actions/") === true), `${file} ${job}`).toBe(true);
      expect(before.some((step) => step.uses?.startsWith("actions/setup-node@") === true), `${file} ${job}`).toBe(true);
      for (const failed of [false, true]) expect(holds(workflowJobs(file)[job]?.if ?? "success()", { needs: answered, failed }), `${file} ${job}`).toBe(false);
    }
  });

  it("lets a refused mark end its job red, following no mark with || true", () => {
    for (const file of files()) expect(readFileSync(file, "utf8"), file).not.toMatch(/bin\/mark\b[^\n]*\|\|\s*true/);
  });
});

describe("tickets.yml builds only an issue labelled ticket, so one opened by hand without it is kept and never built (collod873/agent-hooks#38)", () => {
  it("builds what file-issue files as build or bug, and nothing the owner opens bare or another tool files under its own labels", () => {
    const opened = (labels: string[]) => starts("tickets.yml", "build", { sender: OWNER, action: "opened", labels });

    expect(opened(["bug", "from-app"])).toBe(false);
  });
});

describe("bin/wake starts no ticket or spec that carries waiting, paused or stuck, whichever label comes off (#1713)", () => {
  const PARKED_OR_HELD = [WAITING, PAUSED, STUCK];
  for (const [kind, stage] of [[TICKET, "build"], [SPEC, "spec"]] as const) {
    it(`starts no ${stage} on a ${kind} still carrying one`, () => {
      for (const sender of [OWNER, MACHINE]) {
        for (const carried of PARKED_OR_HELD) {
          for (const event of [{ action: "labeled", label: kind }, ...PARKED_OR_HELD.map((label) => ({ action: "unlabeled", label }))]) {
            expect(woken(payloadOf({ ...event, sender, labels: [kind, carried] }))[stage], `${sender} ${event.action} ${event.label} on [${kind},${carried}]`).toBe(false);
          }
        }
      }
    });
  }
});
