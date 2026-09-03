import { describe, expect, it } from "vitest";
import {
  checkoutReporting,
  githubHoldingClaims,
  HEAD_SHA,
  minutesAgo,
  NOW,
  PR_URL,
  prCreatesIn,
  refDeletesIn,
  TICKET,
  ticketCommentsIn,
  type ClaimHost,
  type ExistingClaim,
} from "./claim-host.fixture";
import type { GhExec } from "./gh";
import { GIT_REFS_PATH } from "./gh-paths";
import { createFakeGit, type FakeGit } from "./git.fake";
import {
  claimImplementationBranch,
  CLAIM_TIMEOUT_MINUTES,
  failsRuleNote,
  landAnswer,
  nothingToBuildNote,
  rebaseConflictNote,
  releaseDeadClaim,
  releaseFailedClaim,
} from "./implementation-landing";
import { NEEDS_HUMAN_LABEL } from "./needs-human";
import { implementationBranch } from "./ready-set";

const ISSUE = 167;
const BRANCH = implementationBranch(ISSUE);
const silent = () => {};

const standing = (claim: Omit<ExistingClaim, "branch"> = {}): ExistingClaim => ({ branch: BRANCH, ...claim });

const prListUnreachable = (args: string[]): string | undefined => {
  if (args[0] === "pr" && args[1] === "list") throw new Error("HTTP 502");
  return undefined;
};

function claim(host: ClaimHost, git: FakeGit = checkoutReporting()) {
  return claimImplementationBranch(host.gh, git.git, BRANCH, silent, NOW);
}

describe("claimImplementationBranch", () => {
  it("creates the ref at HEAD, atomically, and reports a fresh claim", () => {
    const host = githubHoldingClaims();

    expect(claim(host)).toEqual({ claimed: true, tookOverStaleClaim: false });
    expect(host.calls).toEqual([["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${HEAD_SHA}`]]);
    expect(host.refs.has(BRANCH)).toBe(true);
  });

  it("refuses a claim held by a run that is still going, so two dispatches cannot both build one ticket", () => {
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: minutesAgo(5) }) });

    expect(claim(host)).toEqual({ claimed: false, tookOverStaleClaim: false });
    expect(host.refs.has(BRANCH)).toBe(true);
    expect(refDeletesIn(host.calls)).toEqual([]);
  });

  const notClearlyDebris: Array<[string, Omit<ExistingClaim, "branch">]> = [
    ["the branch carries commits somebody may still want", { createdAt: minutesAgo(600), commitsAhead: 3 }],
    ["a pull request already stands on the branch", { createdAt: minutesAgo(600), pullRequests: 1 }],
    ["GitHub reports no creation time to age it by", { createdAt: null }],
  ];

  it.each(notClearlyDebris)("refuses a claim it cannot call debris: %s", (_case, existing) => {
    const host = githubHoldingClaims({ existingClaim: standing(existing) });

    expect(claim(host).claimed).toBe(false);
    expect(host.refs.has(BRANCH)).toBe(true);
  });

  it("reads a claim it cannot inspect as held — every uncertainty answers live", () => {
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: minutesAgo(600) }), answer: prListUnreachable });

    expect(claim(host).claimed).toBe(false);
    expect(host.refs.has(BRANCH)).toBe(true);
  });

  it("takes over a claim with no pull request, no commits and no live run, by a delete and the same atomic create", () => {
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: minutesAgo(CLAIM_TIMEOUT_MINUTES + 1) }) });

    expect(claim(host)).toEqual({ claimed: true, tookOverStaleClaim: true });
    expect(host.refs.has(BRANCH), "the claim is this run's now").toBe(true);

    const creates = host.calls.filter((call) => call[0] === "api" && call[1] === GIT_REFS_PATH);
    expect(creates).toHaveLength(2);
    expect(host.calls.indexOf(refDeletesIn(host.calls)[0])).toBeLessThan(host.calls.indexOf(creates[1]));
  });

  it("does not take over a stale claim it loses the race to re-create", () => {
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: minutesAgo(600) }) });
    const raced: GhExec = (args) => {
      const out = host.gh(args);
      if (args[1] === "--method" && args[2] === "DELETE") host.refs.add(BRANCH);
      return out;
    };

    expect(claimImplementationBranch(raced, checkoutReporting().git, BRANCH, silent, NOW).claimed).toBe(false);
  });
});

describe("releaseFailedClaim", () => {
  it("deletes the ref when no pull request names the branch", () => {
    const host = githubHoldingClaims({ existingClaim: standing() });

    releaseFailedClaim(host.gh, BRANCH, silent);

    expect(host.refs.has(BRANCH)).toBe(false);
  });

  it("leaves the claim when a pull request stands on it, or when that cannot be told", () => {
    const withPr = githubHoldingClaims({ existingClaim: standing({ pullRequests: 1 }) });
    const unknowable = githubHoldingClaims({ existingClaim: standing(), answer: prListUnreachable });

    releaseFailedClaim(withPr.gh, BRANCH, silent);
    releaseFailedClaim(unknowable.gh, BRANCH, silent);

    expect(withPr.refs.has(BRANCH)).toBe(true);
    expect(unknowable.refs.has(BRANCH)).toBe(true);
  });
});

describe("releaseDeadClaim", () => {
  it("lets go of a young claim with no pull request and no commits", () => {
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: NOW.toISOString() }) });

    expect(releaseDeadClaim(host.gh, BRANCH, "main", silent)).toBe(true);
    expect(host.refs.has(BRANCH)).toBe(false);
  });

  const somebodysWork: Array<[string, ClaimHost]> = [
    ["a pull request stands on it", githubHoldingClaims({ existingClaim: standing({ pullRequests: 1 }) })],
    ["it carries commits", githubHoldingClaims({ existingClaim: standing({ commitsAhead: 2 }) })],
    ["it cannot be inspected", githubHoldingClaims({ existingClaim: standing(), answer: prListUnreachable })],
  ];

  it.each(somebodysWork)("leaves a claim alone when %s", (_case, host) => {
    expect(releaseDeadClaim(host.gh, BRANCH, "main", silent)).toBe(false);
    expect(host.refs.has(BRANCH)).toBe(true);
  });
});

describe("landAnswer", () => {
  const ANSWER = { files: [{ path: "a/b.ts", content: "export const x = 1;\n" }], summary: "Built it.", outOfBriefReads: [] };

  async function land(git: FakeGit = checkoutReporting(), options: { rebaseOntoTrunk?: boolean } = {}) {
    const host = githubHoldingClaims({ existingClaim: standing() });
    const written: string[] = [];
    const deps = { gh: host.gh, git: git.git, writeFile: (path: string) => { written.push(path); } };

    const result = await landAnswer(deps, BRANCH, ISSUE, TICKET, ANSWER, "Implement #167", silent, options);
    return { result, host, written, gitCalls: git.calls };
  }

  it("writes the files, commits and pushes the claimed branch, then opens the PR and dispatches Verify", async () => {
    const { result, host, written, gitCalls } = await land();

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(written).toEqual(["a/b.ts"]);
    expect(gitCalls.map((call) => call[0])).toEqual(["status", "diff", "checkout", "add", "commit", "push"]);
    expect(gitCalls).toContainEqual(["push", "origin", `HEAD:${BRANCH}`]);
    expect(prCreatesIn(host.calls)).toHaveLength(1);
    expect(host.dispatches.map((dispatch) => dispatch.payload.pr)).toEqual([PR_URL]);
  });

  it("rebases onto trunk between the commit and the push only when the caller opts in", async () => {
    const { gitCalls } = await land(checkoutReporting(), { rebaseOntoTrunk: true });

    expect(gitCalls.map((call) => call[0])).toEqual(["status", "diff", "checkout", "add", "commit", "fetch", "rebase", "push"]);
  });

  it("escalates a rebase conflict instead of pushing, releasing the claim and naming the paths", async () => {
    const git = createFakeGit((args) => {
      if (args[0] === "rev-parse") return `${HEAD_SHA}\n`;
      if (args[0] === "status") return " M a/b.ts";
      if (args[0] === "rebase" && args[1] !== "--abort") throw new Error("CONFLICT (content): Merge conflict in a/b.ts");
      if (args[0] === "diff") return "a/b.ts\n";
      return "";
    });

    const { result, host, gitCalls } = await land(git, { rebaseOntoTrunk: true });

    expect(result).toEqual({ outcome: "rebase-conflict", paths: ["a/b.ts"] });
    expect(host.refs.has(BRANCH)).toBe(false);
    expect(host.calls).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", NEEDS_HUMAN_LABEL]);
    expect(ticketCommentsIn(host.calls)).toEqual([rebaseConflictNote(["a/b.ts"])]);
    expect(gitCalls).toContainEqual(["rebase", "--abort"]);
    expect(gitCalls.some((call) => call[0] === "push"), "pushed a conflicted branch").toBe(false);
  });

  it("exits nothing-to-build without a commit, releases its claim, and says so on the ticket when git reports the paths clean", async () => {
    const { result, host, gitCalls } = await land(checkoutReporting(() => ""));

    expect(result).toEqual({ outcome: "nothing-to-build" });
    expect(gitCalls.some((call) => call[0] === "commit" || call[0] === "push")).toBe(false);
    expect(prCreatesIn(host.calls)).toEqual([]);
    expect(host.refs.has(BRANCH), "a no-op keeps the ticket unbuildable if it keeps its claim").toBe(false);
    expect(ticketCommentsIn(host.calls)).toEqual([nothingToBuildNote(ISSUE)]);
  });

  it.each([
    ["a tracked file the implementer edited in place", " M a/b.ts"],
    ["a file the implementer created, which a diff against HEAD alone would not show", "?? a/b.ts"],
  ])("commits %s, whatever the filesystem says", async (_case, porcelain) => {
    const { result, gitCalls } = await land(checkoutReporting(() => porcelain));

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(gitCalls.some((call) => call[0] === "commit")).toBe(true);
  });

  it("asks git only about the paths the implementer reported, so a stray edit cannot ride along", async () => {
    const { gitCalls } = await land();

    expect(gitCalls[0]).toEqual(["status", "--porcelain", "--", "a/b.ts"]);
  });

  describe("the test.fails( rule, judged on the answer's diff before the commit", () => {
    const checkoutDiffing = (diff: string): FakeGit =>
      createFakeGit((args) => {
        if (args[0] === "rev-parse") return `${HEAD_SHA}\n`;
        if (args[0] === "status") return " M a/b.ts";
        if (args[0] === "diff") return diff;
        return "";
      });

    const hunk = (lines: string[]) => ["--- a/a/b.ts", "+++ b/a/b.ts", "@@ -1,2 +1,2 @@", ...lines].join("\n");

    it("refuses a rewritten test.fails( line: claim released, needs-human, the ticket says why, nothing committed or pushed", async () => {
      const rewritten = hunk(['-test.fails("#167: the gate is a constant", () => {', '+test("#167: the gate is roughly a constant", () => {']);

      const { result, host, gitCalls } = await land(checkoutDiffing(rewritten));

      expect(result).toMatchObject({ outcome: "fails-rule-refused" });
      if (result.outcome !== "fails-rule-refused") throw new Error("unreachable");
      expect(result.reason).toContain("a/b.ts");
      expect(host.refs.has(BRANCH), "a refusal must not keep the ticket claimed").toBe(false);
      expect(host.calls).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", NEEDS_HUMAN_LABEL]);
      expect(ticketCommentsIn(host.calls)).toEqual([failsRuleNote(result.reason)]);
      expect(gitCalls.some((call) => call[0] === "commit" || call[0] === "push"), "committed a refused answer").toBe(false);
      expect(prCreatesIn(host.calls)).toEqual([]);
    });

    it("proceeds to the commit when the diff only drops .fails — the one edit an implementer may make", async () => {
      const turnedOn = hunk(['-test.fails("#167: the gate is a constant", () => {', '+test("#167: the gate is a constant", () => {']);

      const { result, gitCalls } = await land(checkoutDiffing(turnedOn));

      expect(result).toEqual({ outcome: "opened", pr: PR_URL });
      expect(gitCalls).toContainEqual(["diff", "--", "a/b.ts"]);
      expect(gitCalls.map((call) => call[0])).toEqual(["status", "diff", "checkout", "add", "commit", "push"]);
    });
  });
});
