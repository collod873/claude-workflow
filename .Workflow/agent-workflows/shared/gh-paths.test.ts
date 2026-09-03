import { describe, expect, it } from "vitest";
import {
  blockedByPath,
  blockedByPathMatcher,
  branchCreationPath,
  commitPullsPath,
  commitPullsPathMatcher,
  comparePath,
  GIT_REFS_PATH,
  issueCommentPath,
  issueCommentPathMatcher,
  issueCommentsPath,
  issueCommentsPathMatcher,
  issuePath,
  issuePathMatcher,
  matchingRefsPath,
  repoRunsPath,
  repoRunsPathFor,
  repoRunsPathForMatcher,
  repoRunsPathMatcher,
  runArtifactsPath,
  runJobsPath,
  runJobsPathMatcher,
  subIssuesPath,
  subIssuesPathMatcher,
  workflowRunsPath,
  workflowRunsPathMatcher,
} from "./gh-paths";

const NUMBERED = [
  { name: "issuePath", build: issuePath, matcher: issuePathMatcher, segment: "issues" },
  { name: "subIssuesPath", build: subIssuesPath, matcher: subIssuesPathMatcher, segment: "sub_issues" },
  { name: "blockedByPath", build: blockedByPath, matcher: blockedByPathMatcher, segment: "blocked_by" },
  { name: "issueCommentsPath", build: issueCommentsPath, matcher: issueCommentsPathMatcher, segment: "comments" },
  { name: "issueCommentPath", build: issueCommentPath, matcher: issueCommentPathMatcher, segment: "comments" },
  { name: "runJobsPath", build: runJobsPath, matcher: runJobsPathMatcher, segment: "jobs" },
  { name: "repoRunsPath", build: repoRunsPath, matcher: repoRunsPathMatcher, segment: "per_page" },
] as const;

describe.each(NUMBERED)("$name", ({ build, matcher, segment }) => {
  it("renders the number as its own segment under repos/{owner}/{repo}", () => {
    const path = build(4242);

    expect(path.startsWith("repos/{owner}/{repo}/")).toBe(true);
    expect(path).toContain("4242");
    expect(path).toContain(segment);
  });

  it("is read back by its matcher, capturing the number the builder rendered", () => {
    expect(build(4242).match(matcher)?.[1]).toBe("4242");
    expect(build(7).match(matcher)?.[1]).toBe("7");
  });

  it("does not match the same path with its distinguishing segment renamed", () => {
    expect(build(4242).replace(segment, "elsewhere")).not.toMatch(matcher);
  });

  it("does not match a path whose id is not a number", () => {
    expect(build(4242).replace("4242", "forty-two")).not.toMatch(matcher);
  });
});

describe("the numbered matchers are disjoint", () => {
  it.each(NUMBERED)("$name's matcher matches no sibling builder's path", ({ name, matcher }) => {
    for (const other of NUMBERED) {
      if (other.name === name) continue;
      expect(other.build(4242), `${name}'s matcher accepted ${other.name}(4242)`).not.toMatch(matcher);
    }
  });
});

describe("workflowRunsPath", () => {
  it("renders the workflow file and carries the page size as its query", () => {
    expect(workflowRunsPath("verify-caller.yml", 50)).toBe(
      "repos/{owner}/{repo}/actions/workflows/verify-caller.yml/runs?per_page=50",
    );
  });

  it("is read back by its matcher once the query is dropped, capturing the file", () => {
    const [path] = workflowRunsPath("run-watchdog.yml", 100).split("?");

    expect(path.match(workflowRunsPathMatcher)?.[1]).toBe("run-watchdog.yml");
  });

  it("does not match with the query still attached, nor with a different trailing segment", () => {
    expect(workflowRunsPath("verify.yml", 50)).not.toMatch(workflowRunsPathMatcher);
    expect(workflowRunsPath("verify.yml", 50).split("?")[0].replace("/runs", "/jobs")).not.toMatch(
      workflowRunsPathMatcher,
    );
  });
});

describe("repoRunsPathFor", () => {
  it("spells the repository into the path and is read back with both the repository and the page size", () => {
    const path = repoRunsPathFor("acme/widgets", 30);

    expect(path.startsWith("repos/acme/widgets/")).toBe(true);
    expect(path.match(repoRunsPathForMatcher)?.slice(1)).toEqual(["acme/widgets", "30"]);
  });

  it("is not read by repoRunsPath's matcher, which only knows the placeholder form", () => {
    expect(repoRunsPathFor("acme/widgets", 30)).not.toMatch(repoRunsPathMatcher);
  });
});

describe("commitPullsPath", () => {
  it("renders the commit and is read back capturing it", () => {
    const path = commitPullsPath("deadbeef");

    expect(path).toContain("/commits/deadbeef/pulls");
    expect(path.match(commitPullsPathMatcher)?.[1]).toBe("deadbeef");
  });

  it("does not match the pulls listing of anything but a commit", () => {
    expect(commitPullsPath("deadbeef").replace("commits", "branches")).not.toMatch(commitPullsPathMatcher);
  });
});

describe("the builders that no fake has to recognise", () => {
  it("matchingRefsPath keeps the ref prefix's slash, which a workflow-file name never carries", () => {
    expect(matchingRefsPath("implement/")).toMatch(/\/git\/matching-refs\/heads\/implement\/$/);
  });

  it("runArtifactsPath names the run", () => {
    expect(runArtifactsPath(555)).toMatch(/\/actions\/runs\/555\/artifacts$/);
    expect(runArtifactsPath(555)).not.toMatch(runJobsPathMatcher);
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

  it("GIT_REFS_PATH has no variable segment — the ref is a field on the POST", () => {
    expect(GIT_REFS_PATH.endsWith("/git/refs")).toBe(true);
    expect(GIT_REFS_PATH).not.toContain("${");
  });
});
