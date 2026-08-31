import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GitExec } from "../shared/git";
import { RATIFIER_PR_TITLE } from "../ratify/land";
import { runRatification } from "./run-ratification";

/**
 * Builds one ratifier-PR body section — the same prose-plus-marker shape
 * `ratify/land.ts`'s `renderRatifierBody` writes, reconstructed here from the
 * exported `parseFindingMarker` grammar since that is the contract this
 * reader is allowed to depend on.
 */
function section(landedAs: string | undefined, finding: string, sites: string[]): string {
  const marker = `<!-- release-finding: ${JSON.stringify({ finding, sites, landedAs })} -->`;
  return [`## ${landedAs ?? "(nothing)"}`, "", finding, "", `Sites: ${sites.join(", ")}`, "", marker].join("\n");
}

/** A recording `GitExec` where every read (`ls-remote`) reports the ref absent remotely, so `syncNotesRef` skips its fetch and every write goes straight through. */
function fakeGit(): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push(args);
    return "";
  };
  return { git, calls };
}

const silent = () => {};

describe("runRatification — scope: merged vs. merely closed", () => {
  it("writes nothing to refs/notes/ratifications when the PR closed without merging", () => {
    const { git, calls } = fakeGit();

    const outcome = runRatification({
      merged: false,
      body: section("Some standard", "some finding", ["a.ts:1"]),
      commit: "abc123",
      repoDir: "/some/repo",
      git,
      log: silent,
    });

    expect(outcome).toEqual({ ran: false });
    expect(calls).toEqual([]);
  });
});

describe("runRatification — a merged ratifier PR's landed standards", () => {
  it("writes one ratified record per section, each carrying the landedAs the revert detector keys on", () => {
    const { git, calls } = fakeGit();
    const body = [
      section("Lane-local imports", "cross-lane reach for a shared helper", ["a.ts:1"]),
      section("lane-boundary/no-cross-lane-import", "another finding", ["b.ts:2", "c.ts:3"]),
    ].join("\n\n");

    const outcome = runRatification({
      merged: true,
      body,
      commit: "abc123",
      repoDir: "/some/repo",
      prNumber: 9,
      git,
      log: silent,
    });

    expect(outcome).toEqual({ ran: true, recordCount: 2 });

    const notesCall = calls.find((argv) => argv[2] === "notes");
    expect(notesCall).toBeDefined();
    expect(notesCall!.slice(0, 6)).toEqual(["-C", "/some/repo", "notes", "--ref=ratifications", "add", "-f"]);
    expect(notesCall![6]).toBe("-m");
    const records = JSON.parse(notesCall![7]);
    expect(notesCall![8]).toBe("abc123");

    expect(records).toEqual([
      {
        finding: "cross-lane reach for a shared helper",
        sites: ["a.ts:1"],
        decision: "ratified",
        reason: expect.any(String),
        landedAs: "Lane-local imports",
      },
      {
        finding: "another finding",
        sites: ["b.ts:2", "c.ts:3"],
        decision: "ratified",
        reason: expect.any(String),
        landedAs: "lane-boundary/no-cross-lane-import",
      },
    ]);

    // The push is the whole point of this connector's write — assert it actually ran.
    const pushCall = calls.find((argv) => argv[2] === "push");
    expect(pushCall).toEqual(["-C", "/some/repo", "push", "origin", "refs/notes/ratifications:refs/notes/ratifications"]);
  });

  it("skips a marker with no landedAs, because a record naming nothing is memory nobody can act on", () => {
    const { git, calls } = fakeGit();
    const body = [
      section(undefined, "a marker from before the ratifier existed", ["a.ts:1"]),
      section("The real one", "the real finding", ["b.ts:2"]),
    ].join("\n\n");

    const outcome = runRatification({
      merged: true,
      body,
      commit: "abc123",
      repoDir: "/some/repo",
      git,
      log: silent,
    });

    expect(outcome).toEqual({ ran: true, recordCount: 1 });
    const notesCall = calls.find((argv) => argv[2] === "notes")!;
    expect(JSON.parse(notesCall[7])).toEqual([
      {
        finding: "the real finding",
        sites: ["b.ts:2"],
        decision: "ratified",
        reason: expect.any(String),
        landedAs: "The real one",
      },
    ]);
  });

  it("writes nothing when the merged PR's body carries no parseable marker", () => {
    const { git, calls } = fakeGit();

    const outcome = runRatification({
      merged: true,
      body: "Nothing to see here.",
      commit: "abc123",
      repoDir: "/some/repo",
      git,
      log: silent,
    });

    expect(outcome).toEqual({ ran: true, recordCount: 0 });
    expect(calls).toEqual([]);
  });
});

describe("runRatification — push retry", () => {
  it("retries the push once against a fake git that first rejects non-fast-forward, then succeeds", () => {
    const calls: string[][] = [];
    let pushAttempts = 0;
    const git: GitExec = (args) => {
      calls.push(args);
      if (args[2] === "ls-remote") return "deadbeef refs/notes/ratifications\n";
      if (args[2] === "push") {
        pushAttempts++;
        if (pushAttempts === 1) {
          throw new Error(
            "! [rejected]        refs/notes/ratifications -> refs/notes/ratifications (non-fast-forward)",
          );
        }
        return "";
      }
      return "";
    };

    const outcome = runRatification({
      merged: true,
      body: section("A standard", "a finding", ["a.ts:1"]),
      commit: "abc123",
      repoDir: "/some/repo",
      git,
      log: silent,
    });

    expect(outcome).toEqual({ ran: true, recordCount: 1 });
    expect(pushAttempts).toBe(2);

    const notesCalls = calls.filter((argv) => argv[2] === "notes");
    // `apply` (the note write) runs again on the retry, against whatever `fetch` just brought in.
    expect(notesCalls).toHaveLength(2);
    const fetchCalls = calls.filter((argv) => argv[2] === "fetch");
    expect(fetchCalls).toHaveLength(2);
  });
});

describe("ratify-release.yml agrees with the ratifier PR title it scopes on", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/ratify-release.yml", import.meta.url)),
    "utf8",
  );

  it("fires on pull_request closed and nothing else", () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*types:\s*\[closed\]/);
  });

  it("gates the job on the same title the ratifier opens with, so an ordinary PR merge never starts this runner", () => {
    expect(workflow).toContain(`github.event.pull_request.title == '${RATIFIER_PR_TITLE}'`);
  });
});
