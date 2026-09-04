import { describe, expect, it } from "vitest";
import { ENROLMENT_TOPIC } from "../enrol/enrol";
import type { GhExec } from "../shared/gh";
import { repoRunsPathForMatcher } from "../shared/gh-paths";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";
import {
  failingPath,
  machineFilesFrom,
  MAX_FILED,
  MAX_LOG_READS,
  ranMachineLane,
  routeFor,
  walkHome,
} from "./walk-home";

const NOW = new Date("2026-09-02T12:00:00Z");
const MACHINE_REPO = "collod873/claude-workflow";
const MACHINE_SHA = "abc1234";

const MACHINE_FILES: ReadonlySet<string> = new Set([
  ".Workflow/agent-workflows/watchdog/walk-home.ts",
  ".Workflow/agent-workflows/watchdog/walk-home.test.ts",
  "bin/clone-gate",
  "docs/adr/0135-a-red-run.md",
  ".github/actions/node/action.test.ts",
]);

interface FakeRun {
  id: number;
  path: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
}

function estateWith(options: {
  repositories?: string[];
  runs?: Record<string, FakeRun[]>;
  logs?: Record<number, string>;
  hereIssues?: Array<{ body: string }>;
  callerIssues?: Record<string, Array<{ body: string }>>;
}): { gh: GhExec; calls: string[][]; hereIssues: Array<{ body: string }>; callerIssues: Record<string, Array<{ body: string }>> } {
  const repositories = options.repositories ?? [];
  const runs = options.runs ?? {};
  const logs = options.logs ?? {};
  const hereIssues = [...(options.hereIssues ?? [])];
  const callerIssues: Record<string, Array<{ body: string }>> = {};
  for (const [repo, issues] of Object.entries(options.callerIssues ?? {})) callerIssues[repo] = [...issues];

  const calls: string[][] = [];
  let nextIssue = 100;

  const gh: GhExec = (args) => {
    calls.push(args);
    const repoFlag = args.indexOf("-R");
    const repo = repoFlag >= 0 ? args[repoFlag + 1] : undefined;

    if (args[0] === "api" && args.some((arg) => arg.startsWith("search/repositories"))) {
      return repositories.join("\n");
    }

    if (args[0] === "api" && args[1] && repoRunsPathForMatcher.test(args[1])) {
      expect(args).not.toContain("-R");
      const runsRepo = repoRunsPathForMatcher.exec(args[1])![1];
      const list = runs[runsRepo] ?? [];
      return JSON.stringify(
        list.map((run) => ({
          id: run.id,
          path: run.path,
          status: run.status ?? "completed",
          conclusion: run.conclusion === undefined ? "failure" : run.conclusion,
          htmlUrl: `https://github.com/${runsRepo}/actions/runs/${run.id}`,
          createdAt: run.created_at ?? "2026-09-02T11:00:00Z",
        })),
      );
    }

    if (args[0] === "run" && args[1] === "view" && args.includes("--log-failed")) {
      const runId = Number(args[2]);
      return logs[runId] ?? "";
    }

    if (args[0] === "issue" && args[1] === "list") {
      return JSON.stringify(repo ? (callerIssues[repo] ?? []) : hereIssues);
    }

    if (args[0] === "issue" && args[1] === "create") {
      const body = args[args.indexOf("--body") + 1];
      const number = nextIssue++;
      if (repo) callerIssues[repo] = [...(callerIssues[repo] ?? []), { body }];
      else hereIssues.push({ body });
      return `https://github.com/${repo ?? MACHINE_REPO}/issues/${number}\n`;
    }

    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };

  return { gh, calls, hereIssues, callerIssues };
}

function sweep(fake: { gh: GhExec }, overrides: Partial<Parameters<typeof walkHome>[0]> = {}) {
  return walkHome({
    gh: fake.gh,
    eventAction: WATCHDOG_DISPATCH_ACTION,
    machineRepository: MACHINE_REPO,
    machineSha: MACHINE_SHA,
    machineFiles: MACHINE_FILES,
    now: NOW,
    log: () => {},
    ...overrides,
  });
}

const MACHINE_SIDE_LOG = [
  "Run npx vitest --run .Workflow .claude",
  "FAIL .Workflow/agent-workflows/watchdog/walk-home.test.ts > routes a machine-side failure",
  "AssertionError: expected undefined to be 'machine'",
  " ❯ .Workflow/agent-workflows/watchdog/walk-home.test.ts:42:10",
].join("\n");

const CALLER_SIDE_LOG = [
  "Run npx vitest --run tests",
  "FAIL target/tests/999-example.test.ts > example",
  "AssertionError: expected 1 to be 2",
  " ❯ target/tests/999-example.test.ts:10:5",
].join("\n");

const MACHINE_IMMUTABLE_LOG = [
  "Run the gate",
  "FAIL .github/actions/node/action.test.ts > example",
  "AssertionError: expected 1 to be 2",
  " ❯ .github/actions/node/action.test.ts:10:5",
].join("\n");

describe("failingPath", () => {
  it("names the first repo-relative path a failing step's log carries", () => {
    expect(failingPath(MACHINE_SIDE_LOG)).toBe(".Workflow/agent-workflows/watchdog/walk-home.test.ts");
    expect(failingPath(CALLER_SIDE_LOG)).toBe("target/tests/999-example.test.ts");
  });

  it("names nothing when the log carries no path this sweep can route on", () => {
    expect(failingPath("exit code 1\nsomething went wrong, no file involved")).toBeUndefined();
  });
});

describe("routeFor", () => {
  it("routes a path inside target/ to the caller, where every reusable lane checks the caller out", () => {
    expect(routeFor("target/.github/actions/node/action.test.ts", MACHINE_FILES)).toBe("caller");
  });

  it("routes to the machine only for a path the machine checkout actually tracks", () => {
    expect(routeFor(".Workflow/agent-workflows/watchdog/walk-home.ts", MACHINE_FILES)).toBe("machine");
    expect(routeFor("docs/adr/0135-a-red-run.md", MACHINE_FILES)).toBe("machine");
  });

  it("routes an unrecognised bare path to the caller, not the machine (ADR-0141)", () => {
    expect(routeFor("scripts/clone-gate.mjs", MACHINE_FILES)).toBe("caller");
    expect(routeFor("src/features/field-service/server/reactions/appointments.test.ts", MACHINE_FILES)).toBe("caller");
  });

  it("does not mistake a caller file for the machine's on a shared basename", () => {
    expect(routeFor("bin/clone-gate", MACHINE_FILES)).toBe("machine");
    expect(routeFor("scripts/bin/clone-gate", MACHINE_FILES)).toBe("caller");
  });
});

describe("machineFilesFrom", () => {
  it("reads the checkout's tracked set out of git, dropping the blank trailing line", () => {
    const files = machineFilesFrom(() => "bin/gauntlet\n.Workflow/agent-workflows/watchdog/walk-home.ts\n");

    expect(files.has("bin/gauntlet")).toBe(true);
    expect(files.has(".Workflow/agent-workflows/watchdog/walk-home.ts")).toBe(true);
    expect(files.has("")).toBe(false);
  });
});

describe("ranMachineLane", () => {
  it("is true only for a caller stub, the one shape that reaches uses: into the machine", () => {
    expect(ranMachineLane(".github/workflows/verify-caller.yml")).toBe(true);
    expect(ranMachineLane(".github/workflows/ratify-on-prd-close-caller.yml")).toBe(true);
    expect(ranMachineLane(".github/workflows/ci.yml")).toBe(false);
    expect(ranMachineLane(".github/workflows/license-gate.yml")).toBe(false);
  });
});

describe("walkHome", () => {
  it("files a ticket-shaped issue here, carrying the machine SHA, the run URL and the log tail, for a failing path inside the machine checkout", () => {
    const fake = estateWith({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 555, path: ".github/workflows/verify-caller.yml" }] },
      logs: { 555: MACHINE_SIDE_LOG },
    });

    const outcome = sweep(fake);

    expect(outcome.action).toBe("swept");
    expect(outcome.filed).toEqual([{ repository: "owner/caller", runId: 555, routed: "machine", issue: 100 }]);

    expect(fake.calls).toContainEqual([
      "api",
      "repos/owner/caller/actions/runs?per_page=100",
      "--jq",
      "[.workflow_runs[] | {id, path, status, conclusion, htmlUrl: .html_url, createdAt: .created_at}]",
    ]);

    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create" && !argv.includes("-R"))!;
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain(MACHINE_SHA);
    expect(body).toContain("owner/caller/actions/runs/555");
    expect(body).toContain(".Workflow/agent-workflows/watchdog/walk-home.test.ts");
    expect(create[create.indexOf("--label") + 1]).toBe("to-build");
    expect(body).toContain("## Acceptance criteria");
    expect(body).toContain("## Files claimed");

    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create" && argv.includes("-R"))).toBe(false);
  });

  it("files needs-human, not to-build, for a failing path inside the machine's own immutable set", () => {
    const fake = estateWith({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 560, path: ".github/workflows/verify-caller.yml" }] },
      logs: { 560: MACHINE_IMMUTABLE_LOG },
    });

    const outcome = sweep(fake);

    expect(outcome.filed).toEqual([{ repository: "owner/caller", runId: 560, routed: "needs-human", issue: 100 }]);

    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create" && !argv.includes("-R"))!;
    expect(create[create.indexOf("--label") + 1]).toBe(NEEDS_HUMAN_LABEL);
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain(".github/actions/node/action.test.ts");
    expect(body).not.toContain("## Acceptance criteria");
    expect(body).not.toContain("## Files claimed");
  });

  it("files into the caller's own tracker, and never here, for a failing path inside its own tree", () => {
    const fake = estateWith({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 556, path: ".github/workflows/acceptance-caller.yml" }] },
      logs: { 556: CALLER_SIDE_LOG },
    });

    const outcome = sweep(fake);

    expect(outcome.filed).toEqual([{ repository: "owner/caller", runId: 556, routed: "caller", issue: 100 }]);

    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create).toContain("-R");
    expect(create[create.indexOf("-R") + 1]).toBe("owner/caller");
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain("target/tests/999-example.test.ts");
    expect(body).toContain("owner/caller/actions/runs/556");
    expect(create.includes("--label")).toBe(false);

    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create" && !argv.includes("-R"))).toBe(false);
  });

  it("writes nothing on a second sweep over the same unchanged run: no cursor, no ledger", () => {
    const fake = estateWith({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 557, path: ".github/workflows/verify-caller.yml" }] },
      logs: { 557: MACHINE_SIDE_LOG },
    });

    expect(sweep(fake).filed).toHaveLength(1);
    const secondOutcome = sweep(fake);

    expect(secondOutcome.filed).toEqual([]);
    expect(fake.calls.filter((argv) => argv[0] === "issue" && argv[1] === "create")).toHaveLength(1);
  });

  it("continues the sweep over the rest of the topic when one repository fails, and still exits non-zero", () => {
    const fake = estateWith({
      repositories: ["owner/broken", "owner/caller"],
      runs: { "owner/caller": [{ id: 558, path: ".github/workflows/verify-caller.yml" }] },
      logs: { 558: MACHINE_SIDE_LOG },
    });
    const originalGh = fake.gh;
    const gh: GhExec = (args) => {
      if (args[0] === "api" && args[1]?.startsWith("repos/owner/broken/")) {
        throw new Error("HTTP 404: Not Found");
      }
      return originalGh(args);
    };

    const outcome = sweep({ gh });

    expect(outcome.repositoriesSwept).toBe(2);
    expect(outcome.failures).toEqual(["owner/broken: HTTP 404: Not Found"]);
    expect(outcome.filed).toEqual([{ repository: "owner/caller", runId: 558, routed: "machine", issue: 100 }]);
    expect(outcome.code).toBe("repository-failed");
  });

  it("reads no log at all for a red run of a workflow the caller owns (ADR-0141)", () => {
    const fake = estateWith({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 559, path: ".github/workflows/ci.yml" }] },
      logs: { 559: MACHINE_SIDE_LOG },
    });

    const outcome = sweep(fake);

    expect(outcome.filed).toEqual([]);
    expect(fake.calls.some((argv) => argv[0] === "run" && argv[1] === "view")).toBe(false);
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create")).toBe(false);
  });

  it("spends nothing at all on a dispatch that is not session end", () => {
    const fake = estateWith({ repositories: ["owner/caller"], runs: { "owner/caller": [{ id: 1, path: ".github/workflows/verify-caller.yml" }] } });

    const outcome = sweep(fake, { eventAction: "something-else" });

    expect(outcome).toEqual({ action: "skipped", code: "not-a-session-dispatch", repositoriesSwept: 0, filed: [], failures: [] });
    expect(fake.calls).toEqual([]);
  });

  it("never enrols the machine repository into its own sweep", () => {
    const fake = estateWith({ repositories: [MACHINE_REPO, "owner/caller"], runs: {} });

    const outcome = sweep(fake);

    expect(outcome.repositoriesSwept).toBe(1);
    expect(fake.calls.some((argv) => argv[0] === "api" && argv[1]?.startsWith(`repos/${MACHINE_REPO}/`))).toBe(false);
  });

  it("reports an all-clear sweep when the topic enrols nobody", () => {
    const fake = estateWith({ repositories: [] });

    const outcome = sweep(fake);

    expect(outcome).toMatchObject({ action: "swept", code: "no-enrolled-repositories", repositoriesSwept: 0, filed: [] });
  });

  function redEstate(count: number, log: string): ReturnType<typeof estateWith> {
    const repos = Array.from({ length: count }, (_, index) => `owner/caller-${index}`);
    const runs: Record<string, FakeRun[]> = {};
    const logs: Record<number, string> = {};
    repos.forEach((repo, index) => {
      runs[repo] = [{ id: 700 + index, path: ".github/workflows/verify-caller.yml" }];
      logs[700 + index] = log;
    });
    return estateWith({ repositories: repos, runs, logs });
  }

  it("declares its ceiling on log reads rather than silently dropping the excess", () => {
    const fake = redEstate(MAX_LOG_READS + 1, "exit code 1, no path named anywhere in this log");
    const lines: string[] = [];

    const outcome = sweep(fake, { log: (line) => lines.push(line) });

    expect(outcome.filed).toEqual([]);
    expect(lines.some((line) => line.includes(`already read ${MAX_LOG_READS} log`))).toBe(true);
  });

  it("declares its ceiling on how many issues it files in one sweep", () => {
    const fake = redEstate(MAX_FILED + 1, MACHINE_SIDE_LOG);
    const lines: string[] = [];

    const outcome = sweep(fake, { log: (line) => lines.push(line) });

    expect(outcome.filed).toHaveLength(MAX_FILED);
    expect(lines.some((line) => line.includes(`already filed ${MAX_FILED}`))).toBe(true);
  });
});

describe("the enrolment topic agrees with the enrol/enrol.ts constant it is a copy of", () => {
  it("spends enrol/enrol.ts's own topic on the search this sweep actually makes", () => {
    const fake = estateWith({ repositories: [] });

    sweep(fake);

    expect(fake.calls.some((argv) => argv.some((word) => word.includes(`topic:${ENROLMENT_TOPIC}&`)))).toBe(true);
  });
});
