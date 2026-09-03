import { describe, expect, it } from "vitest";
import {
  callerHalf,
  citedRuns,
  deadLanes,
  executedNothing,
  isCandidate,
  LOOKBACK_DAYS,
  markedLane,
  retirementBody,
  reusableHalf,
  signalBody,
  signalMarker,
  signalTitle,
  stillDeadBody,
  unreportedRuns,
  type RunSummary,
} from "./dead-lanes";
import history from "./push-runs.evidence.json";

/**
 * Every `push` run this repo has, captured from the API with the job count
 * the watchdog reads (`push-runs.evidence.json`). #41's last acceptance
 * criterion asks for the mechanism's own logic run over the thirteen
 * historical runs, so it is run over that history here rather than over a
 * fixture written to agree with it — the mistake #107 turned on.
 */
interface PushRun {
  id: number;
  name: string;
  conclusion: string;
  head_branch: string;
  created_at: string;
  html_url: string;
  job_count: number;
}

const HISTORY: PushRun[] = history;

/**
 * The captured runs as the sweep sees them. `path` is derived from `name`
 * for the dead ones because that *is* what GitHub named them — a workflow it
 * could not parse is named after its own file — and from the workflow's
 * known file otherwise, which is all these tests need it for.
 */
function asRunSummary(run: PushRun): RunSummary {
  return {
    id: run.id,
    name: run.name,
    path: run.name.startsWith(".github/workflows/") ? run.name : `.github/workflows/${run.name.toLowerCase()}.yml`,
    status: "completed",
    conclusion: run.conclusion,
    htmlUrl: run.html_url,
    headBranch: run.head_branch,
    createdAt: run.created_at,
    jobCount: run.job_count,
  };
}

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 1,
    name: "Verify",
    path: ".github/workflows/verify.yml",
    status: "completed",
    conclusion: "failure",
    htmlUrl: "https://github.com/owner/repo/actions/runs/1",
    headBranch: "main",
    createdAt: "2026-08-26T12:00:00Z",
    jobCount: 1,
    ...overrides,
  };
}

describe("the rule, run over the history that motivated it", () => {
  it("has history to run over, so a green suite is not an empty sweep", () => {
    expect(HISTORY.length).toBeGreaterThan(50);
  });

  it("flags every run that executed nothing, and only those", () => {
    const flagged = deadLanes(HISTORY.map(asRunSummary)).flatMap((lane) => lane.runs.map((each) => each.id));
    const dead = HISTORY.filter((each) => each.job_count === 0).map((each) => each.id);

    expect(flagged.sort()).toEqual(dead.sort());
    expect(dead.length).toBe(25);
  });

  it("flags the consecutive dead runs of to-tickets.yml against main", () => {
    // The window #41 opens on: 2026-08-22 to 2026-08-24, `to-tickets.yml` unparseable, every push
    // to `main` spawning a run that did nothing. Two PRDs were labelled `prd` in it and neither
    // sliced; #25 closed green anyway.
    const window = HISTORY.filter(
      (each) => each.head_branch === "main" && each.name === ".github/workflows/to-tickets.yml",
    );
    expect(window.length).toBeGreaterThanOrEqual(12);

    const flagged = new Set(
      deadLanes(HISTORY.map(asRunSummary)).flatMap((lane) => lane.runs.map((each) => each.id)),
    );
    for (const each of window) expect(flagged.has(each.id), `run ${each.id} went unflagged`).toBe(true);
  });

  it("does not flag a run that failed with jobs, which is an ordinary red run", () => {
    const failedWithJobs = HISTORY.filter((each) => each.conclusion === "failure" && each.job_count > 0);

    // Without these, "flags every failure" would pass every test above and be the wrong mechanism:
    // a watchdog that fires on ordinary red runs is noise, and noise is how a signal stops arriving.
    expect(failedWithJobs.length).toBeGreaterThan(0);
    const flagged = new Set(
      deadLanes(HISTORY.map(asRunSummary)).flatMap((lane) => lane.runs.map((each) => each.id)),
    );
    for (const each of failedWithJobs) expect(flagged.has(each.id), `run ${each.id} was flagged`).toBe(false);
  });

  it("collapses the whole window into two lanes, not twenty-five signals", () => {
    // `to-tickets.yml` and the `parse-probe.yml` used to diagnose it. Twenty-five issues would be
    // this ticket's own failure with the sign flipped.
    const lanes = deadLanes(HISTORY.map(asRunSummary));

    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.path).sort()).toEqual([
      ".github/workflows/parse-probe.yml",
      ".github/workflows/to-tickets.yml",
    ]);
  });
});

describe("isCandidate", () => {
  const now = new Date("2026-08-26T12:00:00Z");

  it("takes a completed failure inside the window", () => {
    expect(isCandidate(run({ createdAt: "2026-08-25T12:00:00Z" }), now)).toBe(true);
  });

  it("leaves a run older than the lookback to history", () => {
    const old = new Date(now.getTime() - (LOOKBACK_DAYS + 1) * 24 * 60 * 60 * 1000).toISOString();
    expect(isCandidate(run({ createdAt: old }), now)).toBe(false);
  });

  it("leaves a run that has not finished, which may still execute a job", () => {
    expect(isCandidate(run({ status: "in_progress", conclusion: "" }), now)).toBe(false);
  });

  it("leaves a run that did not fail, since a run with no jobs cannot report success", () => {
    expect(isCandidate(run({ conclusion: "success" }), now)).toBe(false);
  });
});

describe("executedNothing", () => {
  it("is the whole rule: zero jobs, whatever the lane", () => {
    expect(executedNothing(run({ jobCount: 0 }))).toBe(true);
    expect(executedNothing(run({ jobCount: 1 }))).toBe(false);
  });

  it("does not flag a lane that declined the event, which GitHub lists as one skipped job", () => {
    // The distinction the whole ticket is about. A lane whose job-level `if` was false is listed
    // with a job, so the count is one; zero means the run could not start at all.
    expect(executedNothing(run({ conclusion: "skipped", jobCount: 1 }))).toBe(false);
  });

  it("covers a workflow nobody has written yet, since it keys on nothing but the count", () => {
    expect(executedNothing(run({ path: ".github/workflows/not-yet.yml", jobCount: 0 }))).toBe(true);
  });
});

describe("deadLanes", () => {
  it("groups on the file, not the name, so a break and its fix land on one lane", () => {
    // A workflow GitHub could not parse is named after its file; once fixed, it is named by its
    // `name:`. Grouping on the name would file those as two different problems.
    const lanes = deadLanes([
      run({ id: 1, name: ".github/workflows/a.yml", path: ".github/workflows/a.yml", jobCount: 0 }),
      run({ id: 2, name: "Alpha", path: ".github/workflows/a.yml", jobCount: 0 }),
    ]);

    expect(lanes).toHaveLength(1);
    expect(lanes[0].path).toBe(".github/workflows/a.yml");
    expect(lanes[0].runs).toHaveLength(2);
  });

  it("orders a lane's runs newest first, and names the lane after the newest", () => {
    const lanes = deadLanes([
      run({ id: 1, name: "old name", createdAt: "2026-08-20T00:00:00Z", jobCount: 0 }),
      run({ id: 2, name: "new name", createdAt: "2026-08-26T00:00:00Z", jobCount: 0 }),
    ]);

    expect(lanes[0].runs.map((each) => each.id)).toEqual([2, 1]);
    expect(lanes[0].name).toBe("new name");
  });

  it("is empty when every run executed something", () => {
    expect(deadLanes([run({ jobCount: 1 }), run({ id: 2, jobCount: 3 })])).toEqual([]);
  });
});

describe("reusableHalf", () => {
  it("strips the caller suffix, per enrol/stub-set.ts's STUB_SUFFIX convention", () => {
    expect(reusableHalf(".github/workflows/verify-caller.yml")).toBe(".github/workflows/verify.yml");
  });

  it("returns an un-split lane's path unchanged, since it has no second file to name", () => {
    expect(reusableHalf(".github/workflows/enrol.yml")).toBe(".github/workflows/enrol.yml");
  });
});

describe("callerHalf", () => {
  it("adds the caller suffix to a bare lane path", () => {
    expect(callerHalf(".github/workflows/verify.yml")).toBe(".github/workflows/verify-caller.yml");
  });

  it("returns a caller stub unchanged", () => {
    expect(callerHalf(".github/workflows/verify-caller.yml")).toBe(".github/workflows/verify-caller.yml");
  });

  it("is reusableHalf's inverse for a caller stub", () => {
    const stub = ".github/workflows/verify-caller.yml";
    expect(callerHalf(reusableHalf(stub))).toBe(stub);
  });
});

describe("the signal, for a lane that predates the split (or never split)", () => {
  const lane = deadLanes([
    run({
      id: 32676497304,
      name: ".github/workflows/to-tickets.yml",
      path: ".github/workflows/to-tickets.yml",
      htmlUrl: "https://github.com/collod873/claude-workflow/actions/runs/32676497304",
      jobCount: 0,
    }),
  ])[0];

  it("names the workflow and links the run, which is what the reader needs", () => {
    expect(signalTitle(lane)).toContain(".github/workflows/to-tickets.yml");
    expect(signalBody(lane)).toContain("https://github.com/collod873/claude-workflow/actions/runs/32676497304");
    expect(signalBody(lane)).toContain(".github/workflows/to-tickets.yml");
  });

  it("says why a run named after its own file is the tell", () => {
    // The lane's own path has no `-caller.yml` suffix, so it is the file GitHub could not parse a
    // `name:` out of — the branch this pins still fires for exactly this shape of lane.
    expect(signalBody(lane)).toContain("could not parse");
  });

  it("names no second file, since a lane keyed on its own path is not a caller stub", () => {
    expect(signalBody(lane).match(/actionlint /g)).toHaveLength(1);
  });

  it("carries a marker keyed on the lane, so a second dead run finds this issue", () => {
    expect(signalBody(lane)).toContain(signalMarker(lane.path));
    expect(signalMarker("a.yml")).not.toBe(signalMarker("b.yml"));
    expect(signalMarker("a.yml")).toMatch(/^<!--.*-->$/);
  });

  it("reads its own marker back, which is how retirement finds a lane this sweep said nothing about", () => {
    expect(markedLane(signalBody(lane))).toBe(lane.path);
    expect(markedLane("no marker here")).toBeUndefined();
  });
});

describe("the signal, for a post-split caller stub", () => {
  const lane = deadLanes([
    run({
      id: 32676497400,
      name: "To tickets (caller)",
      path: ".github/workflows/to-tickets-caller.yml",
      htmlUrl: "https://github.com/collod873/claude-workflow/actions/runs/32676497400",
      jobCount: 0,
    }),
  ])[0];

  it("names both the stub and the reusable machinery it delegates to", () => {
    expect(signalTitle(lane)).toContain(".github/workflows/to-tickets-caller.yml");
    expect(signalTitle(lane)).toContain(".github/workflows/to-tickets.yml");
    expect(signalBody(lane)).toContain(".github/workflows/to-tickets-caller.yml");
    expect(signalBody(lane)).toContain(".github/workflows/to-tickets.yml");
  });

  it("actionlints the reusable file alongside the stub, since that is almost always where the break is", () => {
    const body = signalBody(lane);
    expect(body).toContain("actionlint .github/workflows/to-tickets-caller.yml");
    expect(body).toContain("actionlint .github/workflows/to-tickets.yml");
  });

  it("is silent about an unparseable name, since a six-line stub almost always parses", () => {
    // The caller carries its own declared name here, not `lane.path` — the post-split norm. The
    // branch that explains an unparseable name has nothing to say about a stub that parsed fine,
    // and the actual break is in the machinery named above instead (#331 instance 4).
    expect(signalBody(lane)).not.toContain("could not parse");
  });

  it("still keys its marker on the stub, so the lane's identity does not move", () => {
    expect(signalMarker(lane.path)).toBe(signalMarker(".github/workflows/to-tickets-caller.yml"));
    expect(markedLane(signalBody(lane))).toBe(".github/workflows/to-tickets-caller.yml");
  });
});

describe("what a signal already said", () => {
  const url = (id: number) => `https://github.com/collod873/claude-workflow/actions/runs/${id}`;
  const dead = (id: number, createdAt: string): RunSummary =>
    run({ id, htmlUrl: url(id), createdAt, jobCount: 0 });

  it("reads cited runs off their URLs, not off numbers in the prose", () => {
    // A human writing "this has failed 33278011242 times" is not a citation, and a date in a
    // comment is not one either: a loose match would silence the next genuine report.
    const text = `Most recent: [run 11](${url(11)})\nSee also 12, filed 2026-08-30T01:34:24Z.`;

    expect(citedRuns(text)).toEqual(new Set([11]));
  });

  it("holds back a lane whose every dead run is already cited", () => {
    const lane = deadLanes([dead(11, "2026-08-26T00:00:00Z")])[0];

    expect(unreportedRuns(lane, citedRuns(`[run 11](${url(11)})`))).toEqual([]);
  });

  it("keeps the runs a standing signal has never named, newest first", () => {
    const lane = deadLanes([dead(11, "2026-08-26T00:00:00Z"), dead(12, "2026-08-27T00:00:00Z")])[0];

    expect(unreportedRuns(lane, citedRuns(`[run 11](${url(11)})`)).map((each) => each.id)).toEqual([12]);
  });

  it("lists the further dead runs when more than one arrived since it last spoke", () => {
    const lane = deadLanes([dead(11, "2026-08-26T00:00:00Z"), dead(12, "2026-08-27T00:00:00Z")])[0];
    const body = stillDeadBody(unreportedRuns(lane, new Set()));

    expect(body).toContain("Still dead: [run 12]");
    expect(body).toContain("1 further dead run since");
    expect(body).toContain("[11]");
  });
});

describe("retirement", () => {
  it("declares `No diff.` under a closing record, which is the grammar the close gate reads", () => {
    // `signalBody` writes no `## Acceptance criteria`, so `No diff.` is the form `close-gate.py`
    // accepts for every issue this mechanism opens — the two agree by construction (ADR-0099).
    const body = retirementBody(".github/workflows/to-tickets.yml", run({ id: 99, jobCount: 4 }));

    expect(body.split("\n")[0]).toBe("## Closing record");
    expect(body).toContain("No diff.");
  });

  it("cites the run that proves the lane starts, and says it closes the signal and not the mechanism", () => {
    const body = retirementBody(".github/workflows/to-tickets.yml", run({ id: 99, jobCount: 4 }));

    expect(body).toContain("run 99");
    expect(body).toContain("never the mechanism");
  });
});
