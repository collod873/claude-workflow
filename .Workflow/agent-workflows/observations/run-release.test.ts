import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { execGit } from "../shared/git";
import { observation } from "./observation.fixture";
import { writeObservationNote } from "./notes";
import { ratificationRecord } from "./ratification.fixture";
import { writeRatificationNote } from "./ratification";
import { LAST_RELEASE_REF, parseFindingMarker, runRelease } from "./run-release";

/**
 * A throwaway git repo for one test, with a helper to commit a file and hand
 * back the new commit's SHA — mirrors `release-scope.test.ts` /
 * `ratification.test.ts`'s `makeRepo`. Sites this suite writes into
 * observation notes (`a.ts`, `b.ts`) are committed as real files so
 * `readObservations`'s staleness self-drop never removes them out from under
 * a test that isn't exercising that behaviour.
 */
function makeRepo(): {
  dir: string;
  commit: (path: string, contents: string, message: string) => string;
} {
  const dir = mkdtempSync(join(tmpdir(), "run-release-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });

  function commit(path: string, contents: string, message: string): string {
    writeFileSync(join(dir, path), contents, "utf8");
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  }

  return { dir, commit };
}

/** A minimal recording `GhExec` — mirrors `release.test.ts`'s `fakeGh`. */
function fakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    return "https://github.com/owner/repo/pull/1\n";
  };
  return { gh, calls };
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** Asserts `gh` was called with exactly one `pr create`, and hands back that call's argv. */
function singlePrCreateCall(calls: string[][]): string[] {
  const prCreateCalls = calls.filter((args) => args[0] === "pr" && args[1] === "create");
  expect(prCreateCalls).toHaveLength(1);
  return prCreateCalls[0];
}

/** Reads `refs/release/last`, or `undefined` when it has never been written — mirrors `runRelease`'s own read. */
function readLastReleaseRef(dir: string): string | undefined {
  try {
    const output = execFileSync("git", ["-C", dir, "rev-parse", "--verify", "--quiet", LAST_RELEASE_REF], {
      encoding: "utf8",
    }).trim();
    return output || undefined;
  } catch {
    return undefined;
  }
}

/**
 * `makeRepo`, plus a bare `origin` remote (#219): `runRelease` now pushes its
 * own release head branch there, so a repo with no remote at all would fail
 * a push this suite isn't trying to exercise. `originDir` is exposed so a
 * test can assert the branch actually landed on "the far side," not just
 * that `git push` didn't throw locally. `checkoutBranch` moves the repo's
 * current branch, for the one test that needs to start on a named branch
 * rather than whatever `git init`'s own default is.
 */
function makeReleaseRepo(): ReturnType<typeof makeRepo> & { originDir: string; checkoutBranch: (name: string) => void } {
  const repo = makeRepo();

  const originDir = mkdtempSync(join(tmpdir(), "run-release-origin-"));
  execGit(["init", "-q", "--bare", originDir]);
  execGit(["-C", repo.dir, "remote", "add", "origin", originDir]);

  function checkoutBranch(name: string): void {
    execGit(["-C", repo.dir, "checkout", "-q", "-B", name]);
  }

  return { ...repo, originDir, checkoutBranch };
}

describe("runRelease", () => {
  let dir: string | undefined;
  let originDir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    if (originDir) rmSync(originDir, { recursive: true, force: true });
    dir = undefined;
    originDir = undefined;
  });

  it(
    "includes a declined finding whose sites grew, excludes one that hasn't, opens exactly one " +
      "PR, and stamps a parseable marker on every checklist item",
    () => {
      const repo = makeReleaseRepo();
      dir = repo.dir;
      originDir = repo.originDir;

      repo.commit("a.ts", "export const a = 1;\n", "seed");
      const head = repo.commit("b.ts", "export const b = 1;\n", "the session's own commit");

      writeRatificationNote({
        git: execGit,
        repoDir: repo.dir,
        commit: head,
        records: [
          ratificationRecord({ finding: "grew past the decision", sites: ["a.ts:1"] }),
          ratificationRecord({ finding: "never regrew", sites: ["a.ts:1"] }),
        ],
      });
      writeObservationNote({
        git: execGit,
        repoDir: repo.dir,
        commit: head,
        observations: [
          observation({ finding: "grew past the decision", sites: ["a.ts:1", "b.ts:1"], released: true }),
          observation({ finding: "never regrew", sites: ["a.ts:1"], released: true }),
        ],
      });

      const { gh, calls } = fakeGh();
      const result = runRelease({ git: execGit, gh, repoDir: repo.dir, head, prdClosed: true });

      expect(result.opened).toBe(true);

      const prCreateCall = singlePrCreateCall(calls);

      const body = flagValue(prCreateCall, "--body") ?? "";
      const checklistLines = body.split("\n").filter((line) => line.startsWith("- [ ] "));

      expect(checklistLines).toHaveLength(1);
      expect(checklistLines[0]).toContain("grew past the decision");
      expect(body).not.toContain("never regrew");

      const marker = parseFindingMarker(checklistLines[0]);
      expect(marker).toEqual({ finding: "grew past the decision", sites: ["a.ts:1", "b.ts:1"] });

      expect(readLastReleaseRef(repo.dir)).toBe(head);

      // #219: runRelease creates and pushes the release's own head branch, under a `release/`
      // prefix, and hands it to composeRelease as --head — never leaving head to gh's own
      // current-branch fallback.
      const releaseHead = flagValue(prCreateCall, "--head");
      expect(releaseHead).toMatch(/^release\//);
      expect(
        execFileSync("git", ["-C", repo.originDir, "rev-parse", "--verify", "--quiet", `refs/heads/${releaseHead}`], {
          encoding: "utf8",
        }).trim(),
      ).not.toBe("");
    },
  );

  it("makes no gh call and leaves the ref alone when everything survives declined and unchanged", () => {
    const repo = makeRepo();
    dir = repo.dir;

    repo.commit("a.ts", "export const a = 1;\n", "seed");
    const head = repo.commit("a.ts", "export const a = 2;\n", "the session's own commit");

    writeRatificationNote({
      git: execGit,
      repoDir: repo.dir,
      commit: head,
      records: [ratificationRecord({ finding: "still declined", sites: ["a.ts:1"] })],
    });
    writeObservationNote({
      git: execGit,
      repoDir: repo.dir,
      commit: head,
      observations: [observation({ finding: "still declined", sites: ["a.ts:1"], released: true })],
    });

    const { gh, calls } = fakeGh();
    const result = runRelease({ git: execGit, gh, repoDir: repo.dir, head, prdClosed: true });

    expect(result.opened).toBe(false);
    expect(calls).toHaveLength(0);
    expect(readLastReleaseRef(repo.dir)).toBeUndefined();
  });

  it("makes no gh call and leaves the ref alone when the release trigger itself doesn't fire", () => {
    const repo = makeRepo();
    dir = repo.dir;

    const head = repo.commit("a.ts", "export const a = 1;\n", "seed");

    const { gh, calls } = fakeGh();
    const result = runRelease({ git: execGit, gh, repoDir: repo.dir, head, prdClosed: false });

    expect(result.opened).toBe(false);
    expect(result.releasedCount).toBe(0);
    expect(calls).toHaveLength(0);
    expect(readLastReleaseRef(repo.dir)).toBeUndefined();
  });

  it(
    "opens a PR instead of erroring when the run starts on the branch composeRelease would " +
      "otherwise default its base to (#219 — 'head branch \"main\" is the same as base branch " +
      '"main"\')',
    () => {
      const repo = makeReleaseRepo();
      dir = repo.dir;
      originDir = repo.originDir;

      repo.checkoutBranch("main");
      const head = repo.commit("a.ts", "export const a = 1;\n", "the session's own commit");

      writeObservationNote({
        git: execGit,
        repoDir: repo.dir,
        commit: head,
        observations: [observation({ finding: "a release-eligible finding", sites: ["a.ts:1"], released: true })],
      });

      const { gh, calls } = fakeGh();
      const result = runRelease({ git: execGit, gh, repoDir: repo.dir, head, prdClosed: true, prBase: "main" });

      expect(result.opened).toBe(true);

      const prCreateCall = singlePrCreateCall(calls);
      expect(flagValue(prCreateCall, "--base")).toBe("main");
      expect(flagValue(prCreateCall, "--head")).not.toBe("main");
      expect(flagValue(prCreateCall, "--head")).toMatch(/^release\//);
    },
  );
});
