import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { repoRunsPathMatcher, runJobsPathMatcher } from "../shared/gh-paths";
import { runWatchdog, WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";
import { MAX_SIGNALS, signalMarker } from "./dead-lanes";

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
 * A `gh` stand-in that answers the four calls this module makes — the runs
 * page, one job count per candidate, the issue listing, and the write — and
 * records every argv, so a test can assert "wrote nothing" by the recording
 * staying empty rather than by assuming it. Same shape as
 * `shared/git.fake.ts`: a responder, not a model of GitHub.
 */
function fakeGh(options: {
  runs?: FakeRun[];
  issues?: Array<{ number: number; body: string; state: string; closedAt: string | null }>;
  jobsRaw?: string;
}): { gh: GhExec; calls: string[][] } {
  const runs = options.runs ?? [];
  const calls: string[][] = [];

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

    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(options.issues ?? []);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
    if (args[0] === "issue" && args[1] === "comment") return "";

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls };
}

const DEAD = { id: 32676497304, name: ".github/workflows/to-tickets.yml", path: ".github/workflows/to-tickets.yml", jobs: 0 };

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
    const fake = fakeGh({ runs: [DEAD] });

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
    const fake = fakeGh({
      runs: [DEAD],
      issues: [{ number: 7, body: `earlier\n${signalMarker(DEAD.path)}`, state: "OPEN", closedAt: null }],
    });

    const outcome = sweep(fake);

    expect(outcome.signals).toEqual([{ lane: DEAD.path, issue: 7, wrote: "commented" }]);
    expect(fake.calls.some((argv) => argv[1] === "create")).toBe(false);
    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    expect(comment[2]).toBe("7");
    expect(comment[comment.indexOf("--body") + 1]).toContain(String(DEAD.id));
  });

  it("stays quiet about runs that predate the close of their own signal", () => {
    // A closed signal is a lane somebody dealt with. Re-reporting the same runs would teach the
    // reader to close this mechanism's issues unread, which is how a signal stops arriving.
    const fake = fakeGh({
      runs: [{ ...DEAD, created_at: "2026-08-24T00:00:00Z" }],
      issues: [
        { number: 7, body: signalMarker(DEAD.path), state: "CLOSED", closedAt: "2026-08-25T00:00:00Z" },
      ],
    });

    const outcome = sweep(fake);

    expect(outcome.deadCount).toBe(1);
    expect(outcome.signals).toEqual([]);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] !== "list")).toBe(false);
  });

  it("reports a lane that died again after its signal was closed", () => {
    const fake = fakeGh({
      runs: [{ ...DEAD, created_at: "2026-08-26T00:00:00Z" }],
      issues: [
        { number: 7, body: signalMarker(DEAD.path), state: "CLOSED", closedAt: "2026-08-25T00:00:00Z" },
      ],
    });

    expect(sweep(fake).signals).toEqual([{ lane: DEAD.path, issue: 42, wrote: "opened" }]);
  });

  it("writes nothing when every lane executed something", () => {
    const fake = fakeGh({ runs: [{ ...DEAD, jobs: 1 }] });

    const outcome = sweep(fake);

    expect(outcome).toMatchObject({ action: "swept", code: "all-lanes-live", deadCount: 0 });
    expect(fake.calls.some((argv) => argv[0] === "issue")).toBe(false);
  });

  it("spends nothing at all on a dispatch that is not session end", () => {
    const fake = fakeGh({ runs: [DEAD] });

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
    const fake = fakeGh({ runs: lanes });
    const lines: string[] = [];

    const outcome = sweep(fake, { log: (line) => lines.push(line) });

    expect(outcome.deadCount).toBe(lanes.length);
    expect(outcome.signals).toHaveLength(MAX_SIGNALS);
    // A cap nobody is told about reads as "there was nothing else" — the exact failure this watches
    // for, rebuilt inside the thing that watches for it.
    expect(lines.some((line) => line.includes("further dead lane"))).toBe(true);
  });

  it("does not spend a job read on a run outside the window", () => {
    const fake = fakeGh({ runs: [{ ...DEAD, created_at: "2026-01-01T00:00:00Z" }] });

    const outcome = sweep(fake);

    expect(outcome.deadCount).toBe(0);
    expect(fake.calls.some((argv) => runJobsPathMatcher.test(argv[1] ?? ""))).toBe(false);
  });

  it("refuses a jobs read that returns no count, rather than reading it as zero", () => {
    // A 403 for want of `actions: read` — how the close gate's reconciler spent every dispatch it
    // got (#107) — must not read as "executed nothing" and open an issue about a healthy lane.
    const fake = fakeGh({ runs: [DEAD], jobsRaw: "" });

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

  it("rides an event rather than a clock, per ADR-0004", () => {
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).not.toContain("schedule:");
  });

  it("sets every variable the entrypoint reads", () => {
    const source = readFileSync(join(here, "run-watchdog.ts"), "utf8");
    const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]);

    expect(read.length).toBeGreaterThan(0);
    for (const name of new Set(read)) {
      expect(workflow, `run-watchdog.yml never sets ${name}`).toMatch(new RegExp(`^ +${name}:`, "m"));
    }
  });
});
