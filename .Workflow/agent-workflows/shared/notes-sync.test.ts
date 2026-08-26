import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execGit } from "./git";
import { syncNotesRef } from "./notes-sync";

/**
 * A bare remote plus two independent clones sharing one commit — the
 * minimum shape a real non-fast-forward rejection needs: two working
 * copies that can each write a note for the same commit and race to push
 * it. Mirrors `observations/notes.test.ts`'s `makeRepo`, extended to a
 * three-repo cluster since this module's whole reason to exist is what
 * happens *between* two pushers, not what one of them does alone.
 */
function makeRemoteAndClones(): { repoA: string; repoB: string; sha: string } {
  const bareDir = mkdtempSync(join(tmpdir(), "notes-sync-bare-"));
  execFileSync("git", ["init", "-q", "--bare", bareDir]);

  const seedDir = mkdtempSync(join(tmpdir(), "notes-sync-seed-"));
  execFileSync("git", ["init", "-q", seedDir]);
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: seedDir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: seedDir });
  writeFileSync(join(seedDir, "a.txt"), "seed\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: seedDir });
  execFileSync("git", ["commit", "-q", "-m", "seed"], { cwd: seedDir });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: seedDir, encoding: "utf8" }).trim();
  execFileSync("git", ["remote", "add", "origin", bareDir], { cwd: seedDir });
  execFileSync("git", ["push", "-q", "origin", "HEAD:refs/heads/main"], { cwd: seedDir });

  const repoA = cloneFrom(bareDir, "notes-sync-a-");
  const repoB = cloneFrom(bareDir, "notes-sync-b-");
  allDirs.push(bareDir, seedDir);

  return { repoA, repoB, sha };
}

function cloneFrom(bareDir: string, prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  execFileSync("git", ["clone", "-q", bareDir, "."], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

/** Reads back the note a fresh clone of `bareDir` sees for `sha` on `ref`. */
function verifyNote(repoA: string, ref: string, sha: string): string {
  const verifyDir = mkdtempSync(join(tmpdir(), "notes-sync-verify-"));
  const origin = execFileSync("git", ["-C", repoA, "remote", "get-url", "origin"], { encoding: "utf8" }).trim();
  execFileSync("git", ["clone", "-q", origin, "."], { cwd: verifyDir });
  execFileSync("git", ["-C", verifyDir, "fetch", "-q", "origin", `+refs/notes/${ref}:refs/notes/${ref}`]);
  allDirs.push(verifyDir);
  return execFileSync("git", ["-C", verifyDir, "notes", `--ref=${ref}`, "show", sha], { encoding: "utf8" }).trim();
}

let allDirs: string[] = [];

afterEach(() => {
  for (const dir of allDirs) rmSync(dir, { recursive: true, force: true });
  allDirs = [];
});

describe("syncNotesRef", () => {
  it("pushes an ordinary write straight through, with no retry", () => {
    const { repoA, sha } = makeRemoteAndClones();
    allDirs.push(repoA);

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
    expect(verifyNote(repoA, "sessions", sha)).toBe("from A");
  });

  it("retries once after a non-fast-forward rejection and succeeds", () => {
    const { repoA, repoB, sha } = makeRemoteAndClones();
    allDirs.push(repoA, repoB);

    let calls = 0;
    syncNotesRef({
      git: execGit,
      repoDir: repoA,
      ref: "sessions",
      apply: () => {
        calls++;
        if (calls === 1) {
          // Another session's push lands between our fetch and our own —
          // the ordinary race this whole helper exists to smooth over.
          execGit(["-C", repoB, "notes", "--ref=sessions", "add", "-f", "-m", "from B", sha]);
          execGit(["-C", repoB, "push", "origin", "refs/notes/sessions:refs/notes/sessions"]);
        }
        execGit(["-C", repoA, "notes", "--ref=sessions", "add", "-f", "-m", `from A (attempt ${calls})`, sha]);
      },
    });

    expect(calls).toBe(2);
    expect(verifyNote(repoA, "sessions", sha)).toBe("from A (attempt 2)");
  });

  it("throws after a second consecutive rejection instead of retrying indefinitely", () => {
    const { repoA, repoB, sha } = makeRemoteAndClones();
    allDirs.push(repoA, repoB);

    let calls = 0;
    const run = () =>
      syncNotesRef({
        git: execGit,
        repoDir: repoA,
        ref: "sessions",
        apply: () => {
          calls++;
          // B wins the race on every single attempt — an unwinnable one,
          // which is exactly the case that must stop retrying and surface.
          execGit(["-C", repoB, "notes", "--ref=sessions", "add", "-f", "-m", `from B (attempt ${calls})`, sha]);
          execGit(["-C", repoB, "push", "origin", "refs/notes/sessions:refs/notes/sessions"]);
          execGit(["-C", repoA, "notes", "--ref=sessions", "add", "-f", "-m", `from A (attempt ${calls})`, sha]);
        },
      });

    expect(run).toThrow(/rejected twice/);
    expect(calls).toBe(2);
  });
});
