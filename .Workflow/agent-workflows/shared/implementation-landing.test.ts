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
  landAnswer,
  nothingToBuildNote,
  rebaseConflictNote,
  releaseDeadClaim,
  releaseFailedClaim,
} from "./implementation-landing";
import { NEEDS_HUMAN_LABEL } from "./needs-human";
import { implementationBranch } from "./ready-set";

/**
 * The landing half two lanes share (`implement/implement.ts`, `recover/recover.ts`): how a claim
 * is taken, assessed and released, and what happens between a held answer and a pull request.
 * Tested here, once, against the claim host — each lane's own test is about what it does before
 * and after this, not about this.
 */

const ISSUE = 167;
const BRANCH = implementationBranch(ISSUE);
const silent = () => {};

/** A claim already standing on this slice's branch, with `claim` being what GitHub says about it. */
const standing = (claim: Omit<ExistingClaim, "branch"> = {}): ExistingClaim => ({ branch: BRANCH, ...claim });

/** A GitHub that cannot say whether a pull request names the branch — the one read every inspection starts with. */
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
    // Young, no commits, no pull request — exactly what a healthy run looks like in its first
    // minutes, and the case a naive "delete anything without a PR" release would trample.
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: minutesAgo(5) }) });

    expect(claim(host)).toEqual({ claimed: false, tookOverStaleClaim: false });
    expect(host.refs.has(BRANCH)).toBe(true);
    expect(refDeletesIn(host.calls)).toEqual([]);
  });

  // Every case here is a claim old enough to have expired but not clearly abandoned, and every one
  // answers "still held". Refusing a claim that was in fact debris costs one delayed retry; taking
  // one that was in fact held costs two implementers building the same ticket at once.
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

    // Taken atomically, not assumed: two runs that both find the same debris still race on
    // `POST git/refs`, and still only one wins.
    const creates = host.calls.filter((call) => call[0] === "api" && call[1] === GIT_REFS_PATH);
    expect(creates).toHaveLength(2);
    expect(host.calls.indexOf(refDeletesIn(host.calls)[0])).toBeLessThan(host.calls.indexOf(creates[1]));
  });

  it("does not take over a stale claim it loses the race to re-create", () => {
    const host = githubHoldingClaims({ existingClaim: standing({ createdAt: minutesAgo(600) }) });
    const raced: GhExec = (args) => {
      const out = host.gh(args);
      // A sibling claimed the freed ref between this run's delete and its create.
      if (args[1] === "--method" && args[2] === "DELETE") host.refs.add(BRANCH);
      return out;
    };

    expect(claimImplementationBranch(raced, checkoutReporting().git, BRANCH, silent, NOW).claimed).toBe(false);
  });
});

/**
 * The exception is the whole reason this asks GitHub rather than a local flag: `openPrAndDispatch`
 * opens the PR and *then* dispatches, so a failure in the send is a failure with a live PR behind
 * it, and deleting that branch would take the run's finished work with it.
 */
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

/**
 * Recover's release (#342): the claimant is known dead, so the age term a rival needs is the one
 * piece of evidence this does not — a claim minutes old is let go the same as one hours old.
 */
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

  /** A run that already holds the claim and has its answer in hand — `git` says what the write left in the tree. */
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
    expect(gitCalls.map((call) => call[0])).toEqual(["status", "checkout", "add", "commit", "push"]);
    expect(gitCalls).toContainEqual(["push", "origin", `HEAD:${BRANCH}`]);
    expect(prCreatesIn(host.calls)).toHaveLength(1);
    expect(host.dispatches.map((dispatch) => dispatch.payload.pr)).toEqual([PR_URL]);
  });

  it("rebases onto trunk between the commit and the push only when the caller opts in", async () => {
    const { gitCalls } = await land(checkoutReporting(), { rebaseOntoTrunk: true });

    expect(gitCalls.map((call) => call[0])).toEqual(["status", "checkout", "add", "commit", "fetch", "rebase", "push"]);
  });

  /**
   * A conflict is escalated, never resolved automatically — the same reason `fixer.yml`'s own
   * rebase step stops rather than guessing at a merge. The claim is released, `needs-human` is
   * applied, and the ticket names what did not replay.
   */
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

  /**
   * A run that builds nothing is a legitimate outcome, not a crash (#196): run 33229214201 found
   * #210 already implemented and died on `git commit` with `nothing to commit`, claim left standing.
   */
  it("exits nothing-to-build without a commit, releases its claim, and says so on the ticket when git reports the paths clean", async () => {
    const { result, host, gitCalls } = await land(checkoutReporting(() => ""));

    expect(result).toEqual({ outcome: "nothing-to-build" });
    expect(gitCalls.some((call) => call[0] === "commit" || call[0] === "push")).toBe(false);
    expect(prCreatesIn(host.calls)).toEqual([]);
    expect(host.refs.has(BRANCH), "a no-op keeps the ticket unbuildable if it keeps its claim").toBe(false);
    expect(ticketCommentsIn(host.calls)).toEqual([nothingToBuildNote(ISSUE)]);
  });

  /**
   * The regression ADR-0103 is about, and why this asks git rather than the filesystem: the
   * implementer holds Edit, Write and Bash, so by the time it reports a file that file has been on
   * disk for twenty minutes. Its answer matches disk byte for byte in both the no-op above and the
   * real build here, and only `git status` tells them apart — run 33275876786 built #237, was
   * compared against its own edits, and was discarded as "nothing to build".
   */
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
});
