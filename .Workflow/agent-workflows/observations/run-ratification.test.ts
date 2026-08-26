import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GitExec } from "../shared/git";
import { runRatification } from "./run-ratification";

/** Builds one release-PR checklist line — the same prose-plus-marker shape `run-release.ts`'s (private) `renderChecklistItem` writes, reconstructed here from the exported `parseFindingMarker` grammar since that's the contract this reader is allowed to depend on. */
function checklistLine(checked: boolean, finding: string, sites: string[]): string {
  const marker = `<!-- release-finding: ${JSON.stringify({ finding, sites })} -->`;
  return `- [${checked ? "x" : " "}] ${finding} (\`${sites.join(", ")}\`) ${marker}`;
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
    const body = checklistLine(true, "some finding", ["a.ts:1"]);

    const outcome = runRatification({
      merged: false,
      body,
      commit: "abc123",
      repoDir: "/some/repo",
      git,
      log: silent,
    });

    expect(outcome).toEqual({ ran: false });
    expect(calls).toEqual([]);
  });
});

describe("runRatification — a merged release PR's checklist", () => {
  it("writes a ratified record for a checked item and a declined record carrying its site list for an unchecked one", () => {
    const { git, calls } = fakeGit();
    const body = [
      "## Needs a decision",
      "",
      checklistLine(true, "checked finding", ["a.ts:1"]),
      checklistLine(false, "unchecked finding", ["b.ts:2", "c.ts:3"]),
    ].join("\n");

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
        finding: "checked finding",
        sites: ["a.ts:1"],
        decision: "ratified",
        reason: expect.any(String),
      },
      {
        finding: "unchecked finding",
        sites: ["b.ts:2", "c.ts:3"],
        decision: "declined",
        reason: expect.any(String),
      },
    ]);

    // The push is the whole point of this connector's write — assert it actually ran.
    const pushCall = calls.find((argv) => argv[2] === "push");
    expect(pushCall).toEqual(["-C", "/some/repo", "push", "origin", "refs/notes/ratifications:refs/notes/ratifications"]);
  });

  it("skips checklist lines whose marker doesn't parse, without dropping the ones that do", () => {
    const { git, calls } = fakeGit();
    const body = [
      "- [ ] a hand-edited line with no marker at all",
      checklistLine(true, "the real one", ["a.ts:1"]),
    ].join("\n");

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
      { finding: "the real one", sites: ["a.ts:1"], decision: "ratified", reason: expect.any(String) },
    ]);
  });

  it("writes nothing when the merged PR's body carries no parseable checklist item", () => {
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

    const body = checklistLine(true, "a finding", ["a.ts:1"]);

    const outcome = runRatification({
      merged: true,
      body,
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

describe("ratify-release.yml agrees with the release PR title it scopes on", () => {
  const workflow = readFileSync(
    fileURLToPath(new URL("../../../.github/workflows/ratify-release.yml", import.meta.url)),
    "utf8",
  );
  const releaseSource = readFileSync(fileURLToPath(new URL("./release.ts", import.meta.url)), "utf8");

  it("fires on pull_request closed and nothing else", () => {
    expect(workflow).toMatch(/pull_request:\s*\n\s*types:\s*\[closed\]/);
  });

  it("gates the job on the same release PR title release.ts opens, so an ordinary PR merge never starts this runner", () => {
    const match = /RELEASE_PR_TITLE = "([^"]+)"/.exec(releaseSource);
    expect(match).not.toBeNull();
    const title = match![1];
    expect(workflow).toContain(title);
  });
});
