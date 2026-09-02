import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { repoRunsPathMatcher } from "../shared/gh-paths";
import { WATCHDOG_DISPATCH_ACTION } from "./run-watchdog";
import { failingPath, isCallerPath, MAX_FILED, MAX_LOG_READS, walkHome } from "./walk-home";

const NOW = new Date("2026-09-02T12:00:00Z");
const MACHINE_REPO = "collod873/claude-workflow";
const MACHINE_SHA = "abc1234";

interface FakeRun {
  id: number;
  path: string;
  status?: string;
  conclusion?: string | null;
  created_at?: string;
}

/**
 * A `gh` stand-in answering every call this module makes across possibly several repositories: the
 * topic search, one runs page and one failing-step log per repository, an issue listing (here or
 * `-R <repo>`), and `issue create`. Every write is recorded, and every `issue create` is folded back
 * into the relevant repository's own issue list — the same "read back what it wrote" shape
 * `run-watchdog.test.ts`'s fake uses for comments, so calling `sweep` twice on one fake exercises
 * the no-cursor, no-ledger claim for real rather than by constructing the second state by hand.
 */
function fakeGh(options: {
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

    if (args[0] === "api" && repo && repoRunsPathMatcher.test(args[args.indexOf(repo) + 1] ?? "")) {
      // Already in the shape `walk-home.ts`'s own `--jq` projects to — the fake stands in for the
      // whole `gh api --jq` round trip, not just the un-projected REST response.
      const list = runs[repo] ?? [];
      return JSON.stringify(
        list.map((run) => ({
          id: run.id,
          path: run.path,
          status: run.status ?? "completed",
          conclusion: run.conclusion === undefined ? "failure" : run.conclusion,
          htmlUrl: `https://github.com/${repo}/actions/runs/${run.id}`,
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
    now: NOW,
    log: () => {},
    ...overrides,
  });
}

const MACHINE_SIDE_LOG = [
  "Run npx vitest run .Workflow .claude",
  "FAIL .Workflow/agent-workflows/watchdog/walk-home.test.ts > routes a machine-side failure",
  "AssertionError: expected undefined to be 'machine'",
  " ❯ .Workflow/agent-workflows/watchdog/walk-home.test.ts:42:10",
].join("\n");

const CALLER_SIDE_LOG = [
  "Run npx vitest run tests/acceptance",
  "FAIL target/tests/acceptance/999-example.test.ts > example",
  "AssertionError: expected 1 to be 2",
  " ❯ target/tests/acceptance/999-example.test.ts:10:5",
].join("\n");

describe("failingPath", () => {
  it("names the first repo-relative path a failing step's log carries", () => {
    expect(failingPath(MACHINE_SIDE_LOG)).toBe(".Workflow/agent-workflows/watchdog/walk-home.test.ts");
    expect(failingPath(CALLER_SIDE_LOG)).toBe("target/tests/acceptance/999-example.test.ts");
  });

  it("names nothing when the log carries no path this sweep can route on", () => {
    expect(failingPath("exit code 1\nsomething went wrong, no file involved")).toBeUndefined();
  });
});

describe("isCallerPath", () => {
  it("is true only for a path inside target/, where every reusable lane checks the caller out", () => {
    expect(isCallerPath("target/tests/acceptance/999-example.test.ts")).toBe(true);
    expect(isCallerPath(".Workflow/agent-workflows/watchdog/walk-home.ts")).toBe(false);
    expect(isCallerPath("docs/adr/0135-a-red-run.md")).toBe(false);
  });
});

describe("walkHome", () => {
  it("files a ticket-shaped issue here, carrying the machine SHA, the run URL and the log tail, for a failing path inside the machine checkout", () => {
    const fake = fakeGh({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 555, path: ".github/workflows/verify.yml" }] },
      logs: { 555: MACHINE_SIDE_LOG },
    });

    const outcome = sweep(fake);

    expect(outcome.action).toBe("swept");
    expect(outcome.filed).toEqual([{ repository: "owner/caller", runId: 555, routed: "machine", issue: 100 }]);

    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create" && !argv.includes("-R"))!;
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain(MACHINE_SHA);
    expect(body).toContain("owner/caller/actions/runs/555");
    expect(body).toContain(".Workflow/agent-workflows/watchdog/walk-home.test.ts");
    expect(create[create.indexOf("--label") + 1]).toBe("to-build");
    expect(body).toContain("## Acceptance criteria");
    expect(body).toContain("## Files claimed");

    // Never filed at the caller.
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create" && argv.includes("-R"))).toBe(false);
  });

  it("files into the caller's own tracker, and never here, for a failing path inside its own tree", () => {
    const fake = fakeGh({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 556, path: ".github/workflows/acceptance.yml" }] },
      logs: { 556: CALLER_SIDE_LOG },
    });

    const outcome = sweep(fake);

    expect(outcome.filed).toEqual([{ repository: "owner/caller", runId: 556, routed: "caller", issue: 100 }]);

    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create).toContain("-R");
    expect(create[create.indexOf("-R") + 1]).toBe("owner/caller");
    const body = create[create.indexOf("--body") + 1];
    expect(body).toContain("target/tests/acceptance/999-example.test.ts");
    expect(body).toContain("owner/caller/actions/runs/556");
    // Never carries the to-build door's label — that door only opens onto this repository's own lane 06.
    expect(create.includes("--label")).toBe(false);

    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create" && !argv.includes("-R"))).toBe(false);
  });

  it("writes nothing on a second sweep over the same unchanged run — no cursor, no ledger", () => {
    const fake = fakeGh({
      repositories: ["owner/caller"],
      runs: { "owner/caller": [{ id: 557, path: ".github/workflows/verify.yml" }] },
      logs: { 557: MACHINE_SIDE_LOG },
    });

    expect(sweep(fake).filed).toHaveLength(1);
    const secondOutcome = sweep(fake);

    expect(secondOutcome.filed).toEqual([]);
    expect(fake.calls.filter((argv) => argv[0] === "issue" && argv[1] === "create")).toHaveLength(1);
  });

  it("continues the sweep over the rest of the topic when one repository fails, and still exits non-zero", () => {
    const fake = fakeGh({
      repositories: ["owner/broken", "owner/caller"],
      runs: { "owner/caller": [{ id: 558, path: ".github/workflows/verify.yml" }] },
      logs: { 558: MACHINE_SIDE_LOG },
    });
    // `owner/broken` names no `runs` entry, so its run-page read throws inside `fakeGh` rather
    // than being handled — the shape a repository this sweep cannot read at all takes.
    const originalGh = fake.gh;
    const gh: GhExec = (args) => {
      if (args[0] === "api" && args.includes("-R") && args[args.indexOf("-R") + 1] === "owner/broken") {
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

  it("names no repository literal in its own source (the topic is the whole enumeration)", () => {
    const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "walk-home.ts"), "utf8");
    expect(source).not.toMatch(/collod873\/[a-z-]+["'`]/);
  });

  it("spends nothing at all on a dispatch that is not session end", () => {
    const fake = fakeGh({ repositories: ["owner/caller"], runs: { "owner/caller": [{ id: 1, path: "x.yml" }] } });

    const outcome = sweep(fake, { eventAction: "something-else" });

    expect(outcome).toEqual({ action: "skipped", code: "not-a-session-dispatch", repositoriesSwept: 0, filed: [], failures: [] });
    expect(fake.calls).toEqual([]);
  });

  it("never enrols the machine repository into its own sweep", () => {
    const fake = fakeGh({ repositories: [MACHINE_REPO, "owner/caller"], runs: {} });

    const outcome = sweep(fake);

    expect(outcome.repositoriesSwept).toBe(1);
    expect(fake.calls.some((argv) => argv.includes(MACHINE_REPO) && argv[0] === "api" && argv.includes("-R"))).toBe(false);
  });

  it("reports an all-clear sweep when the topic enrols nobody", () => {
    const fake = fakeGh({ repositories: [] });

    const outcome = sweep(fake);

    expect(outcome).toMatchObject({ action: "swept", code: "no-enrolled-repositories", repositoriesSwept: 0, filed: [] });
  });

  it("declares its ceiling on log reads rather than silently dropping the excess", () => {
    // Every log here names no routable path, so filing is never this test's bottleneck — isolating
    // the log-read cap from `MAX_FILED`, which is smaller and would otherwise trip first.
    const repos = Array.from({ length: MAX_LOG_READS + 1 }, (_, index) => `owner/caller-${index}`);
    const runs: Record<string, FakeRun[]> = {};
    const logs: Record<number, string> = {};
    repos.forEach((repo, index) => {
      runs[repo] = [{ id: 700 + index, path: "x.yml" }];
      logs[700 + index] = "exit code 1 — no path named anywhere in this log";
    });
    const fake = fakeGh({ repositories: repos, runs, logs });
    const lines: string[] = [];

    const outcome = sweep(fake, { log: (line) => lines.push(line) });

    expect(outcome.filed).toEqual([]);
    expect(lines.some((line) => line.includes(`already read ${MAX_LOG_READS} log`))).toBe(true);
  });

  it("declares its ceiling on how many issues it files in one sweep", () => {
    const repos = Array.from({ length: MAX_FILED + 1 }, (_, index) => `owner/caller-${index}`);
    const runs: Record<string, FakeRun[]> = {};
    const logs: Record<number, string> = {};
    repos.forEach((repo, index) => {
      runs[repo] = [{ id: 800 + index, path: "x.yml" }];
      logs[800 + index] = MACHINE_SIDE_LOG;
    });
    const fake = fakeGh({ repositories: repos, runs, logs });
    const lines: string[] = [];

    const outcome = sweep(fake, { log: (line) => lines.push(line) });

    expect(outcome.filed).toHaveLength(MAX_FILED);
    expect(lines.some((line) => line.includes(`already filed ${MAX_FILED}`))).toBe(true);
  });
});

describe("walk-home.yml", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const workflow = readFileSync(join(here, "../../../.github/workflows/walk-home.yml"), "utf8");

  it("runs this module", () => {
    expect(workflow).toContain("npx tsx .Workflow/agent-workflows/watchdog/walk-home.ts");
  });

  it("scopes its job on the same dispatch action this module checks for", () => {
    expect(workflow).toContain(`github.event.action == '${WATCHDOG_DISPATCH_ACTION}'`);
  });

  it("declares no schedule: and fires on the session-captured dispatch (ADR-0004)", () => {
    expect(workflow).not.toContain("schedule:");
    expect(workflow).toContain("repository_dispatch:");
    expect(workflow).toMatch(/types:\s*\[session-captured\]/);
  });

  it("spends ENROL_PAT rather than the built-in token (ADR-0136)", () => {
    expect(workflow).toContain("secrets.ENROL_PAT");
  });

  it("sets every non-ambient variable the entrypoint reads", () => {
    // GITHUB_REPOSITORY and GITHUB_SHA are ambient on every runner (enrol.yml's own convention:
    // "read straight from the ambient Actions environment. Not restated here.") — only EVENT_ACTION
    // is this workflow's own to set.
    const source = readFileSync(join(here, "walk-home.ts"), "utf8");
    const read = [...source.matchAll(/process\.env\.([A-Z_]+)/g)].map((match) => match[1]);
    const ambient = new Set(["GITHUB_REPOSITORY", "GITHUB_SHA"]);

    expect(read.length).toBeGreaterThan(0);
    for (const name of new Set(read)) {
      if (ambient.has(name)) continue;
      expect(workflow, `walk-home.yml never sets ${name}`).toMatch(new RegExp(`^ +${name}:`, "m"));
    }
  });
});
