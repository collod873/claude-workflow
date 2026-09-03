import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { repoRunsPathMatcher, runJobsPathMatcher } from "../shared/gh-paths";
import { runWatchdog, WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";
import { MAX_JOB_READS, MAX_SIGNALS, signalMarker } from "./dead-lanes";
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

function standing(said = ""): Array<{ number: number; body: string; state: string; closedAt: string | null }> {
  return [{ number: 7, body: `${said}\n${signalMarker(DEAD.path)}`, state: "OPEN", closedAt: null }];
}

function settled(closedAt: string): ReturnType<typeof standing> {
  return [{ number: 7, body: signalMarker(DEAD.path), state: "CLOSED", closedAt }];
}

function citation(id: number): string {
  return `[run ${id}](https://github.com/owner/repo/actions/runs/${id})`;
}

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
    expect(body).not.toContain(String(DEAD.id));
  });

  it("retires a standing signal once its lane runs again", () => {
    const fake = historyWith({
      runs: [{ ...DEAD, id: 33300000001, conclusion: "success", jobs: 3 }],
      issues: standing(),
    });

    const outcome = sweep(fake);

    expect(outcome).toMatchObject({ code: "all-lanes-live", deadCount: 0 });
    expect(outcome.signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "retired" }]);

    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    expect(comment[comment.indexOf("--body") + 1]).toContain("## Closing record");
    expect(comment[comment.indexOf("--body") + 1]).toContain("33300000001");
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(true);
  });

  it("retires a marker spelled as the reusable half (or left from before the split) once its lane's caller stub runs again", () => {
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
    expect(lines.some((line) => line.includes("further dead lane"))).toBe(true);
  });

  it("does not spend a job read on a run outside the window", () => {
    const fake = historyWith({ runs: [{ ...DEAD, created_at: "2026-01-01T00:00:00Z" }] });

    const outcome = sweep(fake);

    expect(outcome.deadCount).toBe(0);
    expect(fake.calls.some((argv) => runJobsPathMatcher.test(argv[1] ?? ""))).toBe(false);
  });

  it("refuses a jobs read that returns no count, rather than reading it as zero", () => {
    const fake = historyWith({ runs: [DEAD], jobsRaw: "" });

    expect(() => sweep(fake)).toThrow(/returned no count/);
  });
});
