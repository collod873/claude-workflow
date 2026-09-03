import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { repoRunsPathMatcher, runJobsPathMatcher } from "../shared/gh-paths";
import { runWatchdog, WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";
import { MAX_JOB_READS, MAX_SIGNALS, signalMarker } from "./dead-lanes";
import { expectWorkflowSetsEveryVariableRead } from "./env-contract.fixture";
import { answerTracker } from "./signal-tracker.fixture";

const NOW = new Date("2026-08-26T12:00:00Z");

interface FakeRun {
  id: number;
  name: string;
  path: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string | null;
  created_at?: string;
  jobs: number;
}

/**
 * A `gh` stand-in that answers the five calls this module makes — the runs
 * page, one job count per candidate, the issue listing and create
 * (`answerTracker`, shared with `bypass.test.ts`), one comment read per
 * standing signal, and the writes — and records every argv, so a test can
 * assert "wrote nothing" by the recording staying empty rather than by
 * assuming it. Same shape as `shared/git.fake.ts`: a responder, not a model of
 * GitHub.
 *
 * Comments accumulate: a comment this module writes is readable by the next
 * read, because the whole question #288 turns on is whether the module reads
 * back what it already said.
 */
function historyWith(options: {
  runs?: FakeRun[];
  issues?: Array<{ number: number; body: string; state: string; closedAt: string | null }>;
  comments?: Record<number, string[]>;
  jobsRaw?: string;
}): { gh: GhExec; calls: string[][] } {
  const runs = options.runs ?? [];
  const calls: string[][] = [];
  const comments: Record<number, string[]> = { ...(options.comments ?? {}) };

  const gh: GhExec = (args) => {
    calls.push(args);

    if (args[0] === "api" && repoRunsPathMatcher.test(args[1] ?? "")) {
      return JSON.stringify(
        runs.map((run) => ({
          id: run.id,
          name: run.name,
          path: run.path,
          status: run.status ?? "completed",
          conclusion: run.conclusion === undefined ? "failure" : run.conclusion,
          html_url: `https://github.com/owner/repo/actions/runs/${run.id}`,
          head_branch: run.head_branch === undefined ? "main" : run.head_branch,
          created_at: run.created_at ?? "2026-08-26T11:00:00Z",
        })),
      );
    }

    const jobs = (args[1] ?? "").match(runJobsPathMatcher);
    if (args[0] === "api" && jobs) {
      if (options.jobsRaw !== undefined) return options.jobsRaw;
      return `${runs.find((run) => run.id === Number(jobs[1]))?.jobs ?? 1}\n`;
    }

    const answered = answerTracker(args, options.issues ?? []);
    if (answered !== undefined) return answered;
    if (args[0] === "issue" && args[1] === "view") {
      return JSON.stringify({ comments: (comments[Number(args[2])] ?? []).map((body) => ({ body })) });
    }
    if (args[0] === "issue" && args[1] === "comment") {
      const issue = Number(args[2]);
      comments[issue] = [...(comments[issue] ?? []), args[args.indexOf("--body") + 1]];
      return "";
    }
    if (args[0] === "issue" && args[1] === "close") return "";

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls };
}

const DEAD = { id: 32676497304, name: ".github/workflows/to-tickets.yml", path: ".github/workflows/to-tickets.yml", jobs: 0 };

/** A signal standing for `DEAD`'s lane, optionally carrying more than its bare marker. */
function standing(said = ""): Array<{ number: number; body: string; state: string; closedAt: string | null }> {
  return [{ number: 7, body: `${said}\n${signalMarker(DEAD.path)}`, state: "OPEN", closedAt: null }];
}

/** The same signal, closed at `closedAt` — a lane somebody dealt with. */
function settled(closedAt: string): ReturnType<typeof standing> {
  return [{ number: 7, body: signalMarker(DEAD.path), state: "CLOSED", closedAt }];
}

/** How a signal cites a run: the run URL, which is the only shape `citedRuns` reads. */
function citation(id: number): string {
  return `[run ${id}](https://github.com/owner/repo/actions/runs/${id})`;
}

/** Whether the sweep wrote anything at all to the tracker, as opposed to only reading it. */
function wrote(calls: string[][]): string[] {
  return calls.filter((argv) => argv[0] === "issue" && ["create", "comment", "close"].includes(argv[1] ?? "")).map((argv) => argv[1]);
}

function sweep(fake: { gh: GhExec }, overrides: Partial<Parameters<typeof runWatchdog>[0]> = {}) {
  return runWatchdog({
    gh: fake.gh,
    eventAction: WATCHDOG_DISPATCH_ACTION,
    assignee: "collod873",
    now: NOW,
    log: () => {},
    ...overrides,
  });
}

describe("runWatchdog", () => {
  it("opens an assigned issue naming the lane and linking the run", () => {
    const fake = historyWith({ runs: [DEAD] });

    const outcome = sweep(fake);

    expect(outcome.action).toBe("swept");
    expect(outcome.deadCount).toBe(1);
    expect(outcome.signals).toEqual([{ lane: DEAD.path, issue: 42, wrote: "opened" }]);

    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create[create.indexOf("--title") + 1]).toContain(DEAD.path);
    expect(create[create.indexOf("--body") + 1]).toContain(`actions/runs/${DEAD.id}`);
    // Assigned, because an unassigned issue is a row in a list rather than something that arrives.
    expect(create[create.indexOf("--assignee") + 1]).toBe("collod873");
  });

  it("comments on the standing signal rather than opening a second issue for the same lane", () => {
    const fake = historyWith({
      runs: [DEAD],
      issues: standing("earlier"),
    });

    const outcome = sweep(fake);

    expect(outcome.signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "commented" }]);
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    expect(comment[2]).toBe("7");
    expect(comment[comment.indexOf("--body") + 1]).toContain(String(DEAD.id));
  });

  it("says nothing when the standing signal already cites the newest dead run", () => {
    // #288: the standing path used to comment on every sweep whatever the issue already said, so
    // one dead run produced one `Still dead` per session the owner ran. The sweep rides session end
    // (ADR-0049), so that re-post rate *is* his working rate.
    const fake = historyWith({
      runs: [DEAD],
      issues: standing(`Most recent: ${citation(DEAD.id)}`),
    });

    const outcome = sweep(fake);

    expect(outcome.deadCount).toBe(1);
    expect(outcome.signals).toEqual([]);
    expect(wrote(fake.calls)).toEqual([]);
  });

  it("goes quiet on the sweep after the one it commented on", () => {
    const fake = historyWith({
      runs: [DEAD],
      issues: standing(),
    });

    expect(sweep(fake).signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "commented" }]);
    // The second sweep reads back what the first one wrote. No cursor, no ledger — the comment it
    // already made is the record that it made it.
    expect(sweep(fake).signals).toEqual([]);
    expect(fake.calls.filter((argv) => argv[0] === "issue" && argv[1] === "comment")).toHaveLength(1);
  });

  it("names every dead run the standing signal has not already cited", () => {
    const older = { ...DEAD, id: 32676497300, created_at: "2026-08-26T09:00:00Z" };
    const newer = { ...DEAD, id: 32676497399, created_at: "2026-08-26T11:30:00Z" };
    const fake = historyWith({
      runs: [newer, older],
      issues: standing(citation(DEAD.id)),
    });

    expect(sweep(fake).signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "commented" }]);

    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    const body = comment[comment.indexOf("--body") + 1];
    expect(body).toContain(String(newer.id));
    expect(body).toContain(String(older.id));
    // The one it already cited is not re-cited: `also` has to mean something.
    expect(body).not.toContain(String(DEAD.id));
  });

  it("retires a standing signal once its lane runs again", () => {
    // ADR-0099. #252 sat open for two days after its lane had recovered and a human closed it.
    const fake = historyWith({
      runs: [{ ...DEAD, id: 33300000001, conclusion: "success", jobs: 3 }],
      issues: standing(),
    });

    const outcome = sweep(fake);

    expect(outcome).toMatchObject({ code: "all-lanes-live", deadCount: 0 });
    expect(outcome.signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "retired" }]);

    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    // A closing record in `close-gate.py`'s grammar, citing the run that proves the lane starts.
    expect(comment[comment.indexOf("--body") + 1]).toContain("## Closing record");
    expect(comment[comment.indexOf("--body") + 1]).toContain("33300000001");
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(true);
  });

  it("retires a marker spelled as the reusable half (or left from before the split) once its lane's caller stub runs again", () => {
    // Post-split, every live run is attributed to the caller (`dead-lanes.ts`'s header), so a
    // marker spelled `<lane>.yml` — the reusable half's own path, and the same spelling a
    // pre-split signal already used — can never see a live run at that literal path again.
    // `callerHalf` is what lets retirement still find the evidence.
    const preSplitPath = ".github/workflows/implement.yml";
    const fake = historyWith({
      runs: [
        { id: 33300000005, name: "Implement (caller)", path: ".github/workflows/implement-caller.yml", conclusion: "success", jobs: 2 },
      ],
      issues: [{ number: 8, body: `\n${signalMarker(preSplitPath)}`, state: "OPEN", closedAt: null }],
    });

    const outcome = sweep(fake);

    expect(outcome.signals).toEqual([{ lane: preSplitPath, issue: 8, wrote: "retired" }]);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(true);
  });

  it("leaves a standing signal open when its lane has not run inside the window", () => {
    // No dead runs is not recovery. A lane nobody has triggered in a week is just as unable to
    // start as it was, and closing on its silence would be an all-clear nothing checked.
    const fake = historyWith({
      runs: [{ ...DEAD, path: ".github/workflows/other.yml", name: "other", jobs: 2, conclusion: "success" }],
      issues: standing(),
    });

    expect(sweep(fake).signals).toEqual([]);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(false);
  });

  it("does not retire a signal for a lane that is still dead", () => {
    const fake = historyWith({
      runs: [DEAD, { ...DEAD, id: 33300000002, conclusion: "success", jobs: 3 }],
      issues: standing(),
    });

    expect(sweep(fake).signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "commented" }]);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(false);
  });

  it("retires nothing on a sweep that did not read its whole window", () => {
    // A dead run sitting unread behind `MAX_JOB_READS` would otherwise read as recovery — this
    // mechanism's own failure with the sign flipped.
    const noisy = Array.from({ length: MAX_JOB_READS + 1 }, (_, index) => ({
      id: 200 + index,
      name: ".github/workflows/noise.yml",
      path: ".github/workflows/noise.yml",
      jobs: 1,
    }));
    const fake = historyWith({
      runs: noisy,
      issues: standing(),
    });
    const lines: string[] = [];

    expect(sweep(fake, { log: (line) => lines.push(line) }).signals).toEqual([]);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(false);
    expect(lines.some((line) => line.includes("did not see its whole window"))).toBe(true);
  });

  it("stays quiet about runs that predate the close of their own signal", () => {
    // A closed signal is a lane somebody dealt with. Re-reporting the same runs would teach the
    // reader to close this mechanism's issues unread, which is how a signal stops arriving.
    const fake = historyWith({
      runs: [{ ...DEAD, created_at: "2026-08-24T00:00:00Z" }],
      issues: settled("2026-08-25T00:00:00Z"),
    });

    const outcome = sweep(fake);

    expect(outcome.deadCount).toBe(1);
    expect(outcome.signals).toEqual([]);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] !== "list")).toBe(false);
  });

  it("reports a lane that died again after its signal was closed", () => {
    const fake = historyWith({
      runs: [{ ...DEAD, created_at: "2026-08-26T00:00:00Z" }],
      issues: settled("2026-08-25T00:00:00Z"),
    });

    expect(sweep(fake).signals).toEqual([{ lane: DEAD.path, issue: 42, wrote: "opened" }]);
  });

  it("writes nothing when every lane executed something", () => {
    const fake = historyWith({ runs: [{ ...DEAD, jobs: 1 }] });

    const outcome = sweep(fake);

    expect(outcome).toMatchObject({ action: "swept", code: "all-lanes-live", deadCount: 0, signals: [] });
    // It reads the tracker even with nothing to report — ADR-0099: the one state in which a
    // standing signal has nothing left to stand for must not be the one state nobody looks at it in.
    expect(fake.calls.filter((argv) => argv[0] === "issue").map((argv) => argv[1])).toEqual(["list"]);
  });

  it("spends nothing at all on a dispatch that is not session end", () => {
    const fake = historyWith({ runs: [DEAD] });

    const outcome = sweep(fake, { eventAction: "something-else" });

    expect(outcome).toEqual({ action: "skipped", code: "not-a-session-dispatch", deadCount: 0, signals: [] });
    expect(fake.calls).toEqual([]);
  });

  it("caps how many lanes one sweep writes about, and says how many it held back", () => {
    const lanes = Array.from({ length: MAX_SIGNALS + 2 }, (_, index) => ({
      id: 100 + index,
      name: `.github/workflows/dead-${index}.yml`,
      path: `.github/workflows/dead-${index}.yml`,
      jobs: 0,
    }));
    const fake = historyWith({ runs: lanes });
    const lines: string[] = [];

    const outcome = sweep(fake, { log: (line) => lines.push(line) });

    expect(outcome.deadCount).toBe(lanes.length);
    expect(outcome.signals).toHaveLength(MAX_SIGNALS);
    // A cap nobody is told about reads as "there was nothing else" — the exact failure this watches
    // for, rebuilt inside the thing that watches for it.
    expect(lines.some((line) => line.includes("further dead lane"))).toBe(true);
  });

  it("does not spend a job read on a run outside the window", () => {
    const fake = historyWith({ runs: [{ ...DEAD, created_at: "2026-01-01T00:00:00Z" }] });

    const outcome = sweep(fake);

    expect(outcome.deadCount).toBe(0);
    expect(fake.calls.some((argv) => runJobsPathMatcher.test(argv[1] ?? ""))).toBe(false);
  });

  it("refuses a jobs read that returns no count, rather than reading it as zero", () => {
    // A 403 for want of `actions: read` — how the close gate's reconciler spent every dispatch it
    // got (#107) — must not read as "executed nothing" and open an issue about a healthy lane.
    const fake = historyWith({ runs: [DEAD], jobsRaw: "" });

    expect(() => sweep(fake)).toThrow(/returned no count/);
  });
});

describe("run-watchdog.yml agrees with the module it runs", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const workflow = readFileSync(join(here, "../../../.github/workflows/run-watchdog.yml"), "utf8");

  it("runs this module", () => {
    expect(workflow).toContain("npx tsx .Workflow/agent-workflows/watchdog/run-watchdog.ts");
  });

  it("scopes its job on the same dispatch action this module checks for", () => {
    expect(workflow).toContain(`github.event.action == '${WATCHDOG_DISPATCH_ACTION}'`);
  });

  it("grants the reads it needs, and the write the signal is", () => {
    // The #107 lesson as a test rather than a comment: the reconciler received every dispatch and
    // exited 403 because nobody granted it `actions: read`, and a workflow that cannot read jobs is
    // a watchdog that reports nothing while looking perfectly healthy.
    expect(workflow).toMatch(/^ {2}actions: read$/m);
    expect(workflow).toMatch(/^ {2}issues: write$/m);
  });

  // #314, ADR-0055 (amended by ADR-0132): the trigger moved to the caller stub, since a reusable
  // workflow's own `on:` is `workflow_call` — see the block below.
  it("is reusable — a caller supplies the trigger", () => {
    expect(workflow).toMatch(/^"on":\s*\n\s*workflow_call:/m);
  });

  it("sets every variable the entrypoint reads", () => {
    expectWorkflowSetsEveryVariableRead({
      workflow,
      workflowFile: "run-watchdog.yml",
      entrypoint: join(here, "run-watchdog.ts"),
    });
  });
});

describe("run-watchdog-caller.yml gates the reusable workflow", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, "../../../.github/workflows/run-watchdog-caller.yml"), "utf8");

  it("rides an event rather than a clock, per ADR-0004", () => {
    expect(source).toContain("repository_dispatch:");
    expect(source).not.toContain("schedule:");
  });

  it("calls the reusable workflow at @main, never a pinned SHA or tag", () => {
    expect(source).toContain("collod873/claude-workflow/.github/workflows/run-watchdog.yml@main");
  });
});
