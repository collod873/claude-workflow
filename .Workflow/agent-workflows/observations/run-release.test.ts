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

describe("runRelease", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it(
    "includes a declined finding whose sites grew, excludes one that hasn't, opens exactly one " +
      "PR, and stamps a parseable marker on every checklist item",
    () => {
      const repo = makeRepo();
      dir = repo.dir;

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

      const prCreateCalls = calls.filter((args) => args[0] === "pr" && args[1] === "create");
      expect(prCreateCalls).toHaveLength(1);

      const body = flagValue(prCreateCalls[0], "--body") ?? "";
      const checklistLines = body.split("\n").filter((line) => line.startsWith("- [ ] "));

      expect(checklistLines).toHaveLength(1);
      expect(checklistLines[0]).toContain("grew past the decision");
      expect(body).not.toContain("never regrew");

      const marker = parseFindingMarker(checklistLines[0]);
      expect(marker).toEqual({ finding: "grew past the decision", sites: ["a.ts:1", "b.ts:1"] });

      expect(readLastReleaseRef(repo.dir)).toBe(head);
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
});
