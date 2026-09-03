import { describe, expect, it } from "vitest";
import { execGit } from "./git";
import { syncNotesRef } from "./notes-sync";
import { cloneRepo, makeBareRepo, makeTempRepo, noteOnRemote } from "./temp-repo.fixture";

function makeRemoteAndClones(): { bareDir: string; repoA: string; repoB: string; sha: string } {
  const bareDir = makeBareRepo("notes-sync-bare");

  const seed = makeTempRepo("notes-sync-seed", { origin: bareDir });
  seed.write("a.txt", "seed\n");
  const sha = seed.commit("seed");
  seed.git("push", "-q", "origin", "HEAD:refs/heads/main");

  const repoA = cloneRepo(bareDir, "notes-sync-a").dir;
  const repoB = cloneRepo(bareDir, "notes-sync-b").dir;

  return { bareDir, repoA, repoB, sha };
}

describe("syncNotesRef", () => {
  it("pushes an ordinary write straight through, with no retry", () => {
    const { bareDir, repoA, sha } = makeRemoteAndClones();

    let calls = 0;
    syncNotesRef({
      git: execGit,
      repoDir: repoA,
      ref: "sessions",
      apply: () => {
        calls++;
        execGit(["-C", repoA, "notes", "--ref=sessions", "add", "-f", "-m", "from A", sha]);
      },
    });

    expect(calls).toBe(1);
    expect(noteOnRemote(bareDir, "sessions", sha)).toBe("from A");
  });

  it("retries once after a non-fast-forward rejection and succeeds", () => {
    const { bareDir, repoA, repoB, sha } = makeRemoteAndClones();

    let calls = 0;
    syncNotesRef({
      git: execGit,
      repoDir: repoA,
      ref: "sessions",
      apply: () => {
        calls++;
        if (calls === 1) {
          execGit(["-C", repoB, "notes", "--ref=sessions", "add", "-f", "-m", "from B", sha]);
          execGit(["-C", repoB, "push", "origin", "refs/notes/sessions:refs/notes/sessions"]);
        }
        execGit(["-C", repoA, "notes", "--ref=sessions", "add", "-f", "-m", `from A (attempt ${calls})`, sha]);
      },
    });

    expect(calls).toBe(2);
    expect(noteOnRemote(bareDir, "sessions", sha)).toBe("from A (attempt 2)");
  });

  it("throws after a second consecutive rejection instead of retrying indefinitely", () => {
    const { repoA, repoB, sha } = makeRemoteAndClones();

    let calls = 0;
    const run = () =>
      syncNotesRef({
        git: execGit,
        repoDir: repoA,
        ref: "sessions",
        apply: () => {
          calls++;
          execGit(["-C", repoB, "notes", "--ref=sessions", "add", "-f", "-m", `from B (attempt ${calls})`, sha]);
          execGit(["-C", repoB, "push", "origin", "refs/notes/sessions:refs/notes/sessions"]);
          execGit(["-C", repoA, "notes", "--ref=sessions", "add", "-f", "-m", `from A (attempt ${calls})`, sha]);
        },
      });

    expect(run).toThrow(/rejected twice/);
    expect(calls).toBe(2);
  });
});
