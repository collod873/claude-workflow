import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
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
import type { GitExec } from "./git";
import { createFakeGit, type FakeGit } from "./git.fake";
import {
  claimImplementationBranch,
  CLAIM_TIMEOUT_MINUTES,
  declaredEditsNote,
  deriveAnswer,
  failsRuleNote,
  immutableSetNote,
  landAnswer,
  nothingToBuildNote,
  rebaseConflictNote,
  releaseDeadClaim,
  releaseFailedClaim,
  type ImplementerAnswer,
} from "./implementation-landing";
import { implementerAnswer } from "./implementation-landing.fixture";
import { NEEDS_HUMAN_LABEL } from "./needs-human";
import { implementationBranch } from "./ready-set";
import { makeTempRepo, type TempRepo } from "./temp-repo.fixture";

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

  it("reads a claim it cannot inspect as held, since every uncertainty answers live", () => {
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
  const ANSWER = implementerAnswer({ files: [{ path: "a/b.ts", content: "export const x = 1;\n" }], summary: "Built it." });

  async function land(
    git: FakeGit = checkoutReporting(),
    options: { rebaseOntoTrunk?: boolean; skipPushHook?: boolean } = {},
    answer: ImplementerAnswer = ANSWER,
    hasIndex = false,
  ) {
    const host = githubHoldingClaims({ existingClaim: standing() });
    const written: string[] = [];
    const removed: string[] = [];
    let regenerated = 0;
    const deps = {
      gh: host.gh,
      git: git.git,
      writeFile: (path: string) => { written.push(path); },
      removeFile: (path: string) => { removed.push(path); },
      regenerateIndex: () => { regenerated += 1; return hasIndex; },
    };

    const result = await landAnswer(deps, BRANCH, ISSUE, TICKET, answer, "Implement #167", silent, options);
    return { result, host, written, removed, gitCalls: git.calls, regenerated: () => regenerated };
  }

  const ADR_ANSWER = implementerAnswer({
    files: [{ path: "docs/adr/0042-a-ruling.md", content: "---\nstatus: constraint\n---\n\n# A ruling\n" }],
    summary: "Ruled it.",
  });

  it("writes the files, commits and pushes the claimed branch, then opens the PR and dispatches Verify", async () => {
    const { result, host, written, gitCalls } = await land();

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(written).toEqual(["a/b.ts"]);
    expect(gitCalls.map((call) => call[0])).toEqual(["status", "diff", "checkout", "add", "commit", "push"]);
    expect(gitCalls).toContainEqual(["push", "origin", `HEAD:${BRANCH}`]);
    expect(prCreatesIn(host.calls)).toHaveLength(1);
    expect(host.dispatches.map((dispatch) => dispatch.payload.pr)).toEqual([PR_URL]);
  });

  it("regenerates docs/adr/INDEX.md and stages it when the answer writes an ADR, so a recovered answer is not pushed with the index stale", async () => {
    const git = checkoutReporting();
    const { gitCalls, regenerated } = await land(git, {}, ADR_ANSWER, true);

    expect(regenerated()).toBe(1);
    const add = gitCalls.find((call) => call[0] === "add")!;
    expect(add).toContain("docs/adr/INDEX.md");
    expect(add).toContain("docs/adr/0042-a-ruling.md");
  });

  it("stages no index on a target that carries none, so an enrolled repository is never given one", async () => {
    const { gitCalls, regenerated } = await land(checkoutReporting(), {}, ADR_ANSWER, false);

    expect(regenerated()).toBe(1);
    expect(gitCalls.find((call) => call[0] === "add")).not.toContain("docs/adr/INDEX.md");
  });

  it("does not reach for the index at all when the answer touches no ADR", async () => {
    const { regenerated } = await land();

    expect(regenerated()).toBe(0);
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

  describe("deletions", () => {
    const DELETE_ANSWER = implementerAnswer({ deleted: ["a/gone.ts"], summary: "Removed it." });

    it("removes a deleted path from disk, stages it, and carries it into the changed-files dispatch", async () => {
      const { result, removed, gitCalls, host } = await land(checkoutReporting(), {}, DELETE_ANSWER);

      expect(result).toEqual({ outcome: "opened", pr: PR_URL });
      expect(removed).toEqual(["a/gone.ts"]);
      expect(gitCalls.find((call) => call[0] === "add")).toContain("a/gone.ts");
      expect(host.dispatches[0].payload.changed_files).toContain("a/gone.ts");
    });

    it("commits an answer that only deletes, with nothing in files", async () => {
      const { result, gitCalls } = await land(checkoutReporting(), {}, DELETE_ANSWER);

      expect(result).toEqual({ outcome: "opened", pr: PR_URL });
      expect(gitCalls.some((call) => call[0] === "commit")).toBe(true);
    });
  });

  describe("the immutable set", () => {
    const IMMUTABLE_ANSWER = implementerAnswer({ files: [{ path: "vitest.config.ts", content: "export default {};\n" }], summary: "Touched it." });

    it("refuses before any commit, releasing the claim and posting the note", async () => {
      const { result, host, gitCalls } = await land(checkoutReporting(), {}, IMMUTABLE_ANSWER);

      expect(result).toEqual({ outcome: "immutable-refused", paths: ["vitest.config.ts"] });
      expect(host.refs.has(BRANCH)).toBe(false);
      expect(host.calls).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", NEEDS_HUMAN_LABEL]);
      expect(ticketCommentsIn(host.calls)).toEqual([immutableSetNote(["vitest.config.ts"])]);
      expect(gitCalls.some((call) => call[0] === "commit" || call[0] === "push")).toBe(false);
      expect(prCreatesIn(host.calls)).toEqual([]);
    });
  });

  describe("skipPushHook", () => {
    it("passes --no-verify to the push exactly when the caller opts in", async () => {
      const { gitCalls: normal } = await land();
      const { gitCalls: skipped } = await land(checkoutReporting(), { skipPushHook: true });

      expect(normal).toContainEqual(["push", "origin", `HEAD:${BRANCH}`]);
      expect(skipped).toContainEqual(["push", "--no-verify", "origin", `HEAD:${BRANCH}`]);
    });
  });

  const checkoutDiffing = (diff: string): FakeGit =>
    createFakeGit((args) => {
      if (args[0] === "rev-parse") return `${HEAD_SHA}\n`;
      if (args[0] === "status") return " M a/b.ts";
      if (args[0] === "diff") return diff;
      return "";
    });

  const hunk = (lines: string[]) => ["--- a/a/b.ts", "+++ b/a/b.ts", "@@ -1,2 +1,2 @@", ...lines].join("\n");

  describe("the test.fails( rule, judged on the answer's diff before the commit", () => {
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

    it("proceeds to the commit when the diff only drops .fails, the one edit an implementer may make", async () => {
      const turnedOn = hunk(['-test.fails("#167: the gate is a constant", () => {', '+test("#167: the gate is a constant", () => {']);

      const { result, gitCalls } = await land(checkoutDiffing(turnedOn));

      expect(result).toEqual({ outcome: "opened", pr: PR_URL });
      expect(gitCalls).toContainEqual(["diff", "--", "a/b.ts"]);
      expect(gitCalls.map((call) => call[0])).toEqual(["status", "diff", "checkout", "add", "commit", "push"]);
    });
  });

  describe("declared edits widen the fails rule and are announced", () => {
    const DECLARED_ANSWER = implementerAnswer({
      files: [{ path: "a/b.ts", content: "export const x = 2;\n" }],
      summary: "Rewrote the test; it was asserting the wrong shape.",
      declaredEdits: [{ path: "a/b.ts", reason: "The acceptance test asserted the old return shape." }],
    });

    it("does not refuse a declared file's test.fails( rewrite, and posts the same note in the PR body and on the ticket", async () => {
      const rewritten = hunk(['-test.fails("#167: the gate is a constant", () => {', '+test("#167: the gate is roughly a constant", () => {']);

      const { result, host } = await land(checkoutDiffing(rewritten), {}, DECLARED_ANSWER);

      expect(result).toEqual({ outcome: "opened", pr: PR_URL });
      const note = declaredEditsNote(DECLARED_ANSWER.declaredEdits);
      const prCall = prCreatesIn(host.calls)[0];
      expect(prCall[prCall.indexOf("--body") + 1]).toContain(note);
      expect(ticketCommentsIn(host.calls)).toContain(note);
    });

    it("still refuses an undeclared file's rewrite", async () => {
      const rewritten = hunk(['-test.fails("#167: the gate is a constant", () => {', '+test("#167: the gate is roughly a constant", () => {']);

      const { result } = await land(checkoutDiffing(rewritten), {}, { ...DECLARED_ANSWER, declaredEdits: [] });

      expect(result).toMatchObject({ outcome: "fails-rule-refused" });
    });
  });
});

describe("deriveAnswer", () => {
  it("sorts a modified and an added path into files with their content, and a missing path into deleted", () => {
    const git: GitExec = (args) => (args[0] === "status" ? " M b.ts\n D a.ts\n?? c.ts" : "");
    const disk = new Map([
      ["b.ts", "content b"],
      ["c.ts", "content c"],
    ]);
    const readFile = (path: string) => disk.get(path)!;
    const fileExists = (path: string) => disk.has(path);

    const declaredEdits = [{ path: "b.ts", reason: "It was outside the claim but needed the fix." }];
    expect(
      deriveAnswer(git, readFile, fileExists, { summary: "did it", outOfBriefReads: ["a/CONTEXT.md"], declaredEdits }),
    ).toEqual({
      files: [
        { path: "b.ts", content: "content b" },
        { path: "c.ts", content: "content c" },
      ],
      deleted: ["a.ts"],
      summary: "did it",
      outOfBriefReads: ["a/CONTEXT.md"],
      declaredEdits,
    });
  });

  it("reads a git rm'd file and an untracked file correctly against a real repository", () => {
    const repo: TempRepo = makeTempRepo("derive-answer");
    repo.write("kept.ts", "export const x = 1;\n");
    repo.write("gone.ts", "export const y = 1;\n");
    repo.commit("first");
    repo.git("rm", "-q", "gone.ts");
    repo.write("new.ts", "export const z = 1;\n");

    const git: GitExec = (args) => repo.git(...args);
    const readFile = (path: string) => readFileSync(join(repo.dir, path), "utf8");
    const fileExists = (path: string) => existsSync(join(repo.dir, path));

    const answer = deriveAnswer(git, readFile, fileExists, { summary: "s", outOfBriefReads: [], declaredEdits: [] });

    expect(answer.deleted).toEqual(["gone.ts"]);
    expect(answer.files).toEqual([{ path: "new.ts", content: "export const z = 1;\n" }]);
  });
});
