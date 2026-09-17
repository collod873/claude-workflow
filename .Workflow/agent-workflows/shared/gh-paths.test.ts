import { describe, expect, it } from "vitest";
import { test } from "vitest";
import * as ghPaths from "./gh-paths";
import { laneSources } from "./repo-sources";
import {
  blockedByPath,
  branchCreationPath,
  commitPullsPath,
  comparePath,
  GIT_REFS_PATH,
  isRepoRunsPath,
  isWorkflowRunsPath,
  issueCommentPath,
  issueCommentsPath,
  issuePath,
  jobLogsPath,
  matchingRefsPath,
  parseBlockedByPath,
  parseIssuePath,
  parseJobLogsPath,
  parseRepoRunsPathFor,
  parseRunJobsPath,
  parseSubIssuesPath,
  repoRunsPath,
  repoRunsPathFor,
  runJobsPath,
  subIssuesPath,
  workflowRunsPath,
} from "./gh-paths";

const NUMBERED = [
  { name: "issuePath", build: issuePath, segment: "issues" },
  { name: "subIssuesPath", build: subIssuesPath, segment: "sub_issues" },
  { name: "blockedByPath", build: blockedByPath, segment: "blocked_by" },
  { name: "issueCommentsPath", build: issueCommentsPath, segment: "comments" },
  { name: "issueCommentPath", build: issueCommentPath, segment: "comments" },
  { name: "runJobsPath", build: runJobsPath, segment: "jobs" },
  { name: "repoRunsPath", build: repoRunsPath, segment: "per_page" },
] as const;

describe.each(NUMBERED)("$name", ({ build, segment }) => {
  it("renders the number as its own segment under repos/{owner}/{repo}", () => {
    const path = build(4242);

    expect(path.startsWith("repos/{owner}/{repo}/")).toBe(true);
    expect(path).toContain("4242");
    expect(path).toContain(segment);
  });
});

const PARSED = [
  { name: "issuePath", build: issuePath, parse: parseIssuePath },
  { name: "subIssuesPath", build: subIssuesPath, parse: parseSubIssuesPath },
  { name: "blockedByPath", build: blockedByPath, parse: parseBlockedByPath },
  { name: "runJobsPath", build: runJobsPath, parse: parseRunJobsPath },
  { name: "jobLogsPath", build: jobLogsPath, parse: parseJobLogsPath },
] as const;

describe.each(PARSED)("$name's parser", ({ build, parse }) => {
  it("is read back by its parser, capturing the number the builder rendered", () => {
    expect(parse(build(4242))).toBe(4242);
    expect(parse(build(7))).toBe(7);
  });

  it("is undefined for a path a sibling builder rendered", () => {
    for (const other of PARSED) {
      if (other.build === build) continue;
      expect(parse(other.build(4242)), `parsed ${other.name}(4242)`).toBeUndefined();
    }
  });
});

describe("workflowRunsPath", () => {
  it("renders the workflow file and carries the page size as its query", () => {
    expect(workflowRunsPath("verify-caller.yml", 50)).toBe(
      "repos/{owner}/{repo}/actions/workflows/verify-caller.yml/runs?per_page=50",
    );
  });

  it("is recognised by isWorkflowRunsPath once the query is dropped", () => {
    const [path] = workflowRunsPath("run-watchdog.yml", 100).split("?");

    expect(isWorkflowRunsPath(path)).toBe(true);
  });

  it("is not recognised with the query still attached, nor with a different trailing segment", () => {
    expect(isWorkflowRunsPath(workflowRunsPath("verify.yml", 50))).toBe(false);
    expect(isWorkflowRunsPath(workflowRunsPath("verify.yml", 50).split("?")[0].replace("/runs", "/jobs"))).toBe(
      false,
    );
  });
});

describe("repoRunsPath", () => {
  it("is recognised by isRepoRunsPath", () => {
    expect(isRepoRunsPath(repoRunsPath(50))).toBe(true);
  });
});

describe("repoRunsPathFor", () => {
  it("spells the repository and the page size into the path", () => {
    const path = repoRunsPathFor("acme/widgets", 30);

    expect(path.startsWith("repos/acme/widgets/")).toBe(true);
    expect(path).toContain("per_page=30");
  });

  it("is read back by parseRepoRunsPathFor, capturing the repository", () => {
    expect(parseRepoRunsPathFor(repoRunsPathFor("acme/widgets", 30))).toBe("acme/widgets");
  });
});

describe("commitPullsPath", () => {
  it("renders the commit", () => {
    expect(commitPullsPath("deadbeef")).toContain("/commits/deadbeef/pulls");
  });
});

describe("the builders that no fake has to recognise", () => {
  it("matchingRefsPath keeps the ref prefix's slash, which a workflow-file name never carries", () => {
    expect(matchingRefsPath("implement/")).toMatch(/\/git\/matching-refs\/heads\/implement\/$/);
  });

  it("comparePath puts base before head, three dots between", () => {
    expect(comparePath("main", "implement/issue-9")).toMatch(/\/compare\/main\.\.\.implement\/issue-9$/);
  });

  it("branchCreationPath asks the activity feed for one branch_creation entry, ref URL-encoded", () => {
    const path = branchCreationPath("implement/issue-9");

    expect(path).toContain("activity_type=branch_creation");
    expect(path).toContain("per_page=1");
    expect(path.endsWith(`ref=${encodeURIComponent("refs/heads/implement/issue-9")}`)).toBe(true);
    expect(path).not.toContain("refs/heads");
  });

  it("GIT_REFS_PATH has no variable segment, since the ref is a field on the POST", () => {
    expect(GIT_REFS_PATH.endsWith("/git/refs")).toBe(true);
    expect(GIT_REFS_PATH).not.toContain("${");
  });
});

test("#629.1: no *PathMatcher export remains on gh-paths.ts", () => {
  const matcherNames = Object.keys(ghPaths).filter((name) => /^[a-zA-Z]+PathMatcher$/.test(name));

  expect(matcherNames).toEqual([]);
});

test("#629.2: repoRunsPathForMatcher is no longer exported", () => {
  expect("repoRunsPathForMatcher" in ghPaths).toBe(false);
});

test.fails("#629.6: no module outside the tracker-gh adapter and gh-paths itself passes an api argv", () => {
  const offenders = laneSources()
    .filter((file) => file.relative.endsWith(".ts"))
    .filter((file) => !/fixture|fake|gh-paths|tracker-gh\.ts/.test(file.relative))
    .filter((file) => file.source.includes('"api"'))
    .map((file) => file.relative);

  expect(offenders).toEqual([]);
});
