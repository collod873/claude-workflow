import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const HOOK = join(import.meta.dirname, "..", ".husky", "pre-push");
const ZERO = "0000000000000000000000000000000000000000";
const SHA = "1111111111111111111111111111111111111111";
const LOCAL = ["GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE", "GIT_PREFIX"];
const pushing = (...remoteRefs: string[]) => remoteRefs.map((ref) => `${ref} ${SHA} ${ref} ${ZERO}\n`).join("");

function prePush(stdin: string, { check }: { check?: number } = {}) {
  const bin = mkdtempSync(join(tmpdir(), "pre-push-"));
  const git = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  symlinkSync(git, join(bin, "git"));
  const seen = join(bin, "seen");
  if (check !== undefined) {
    writeFileSync(join(bin, "check"), `#!/bin/sh\n{ echo "$*"; for v in ${LOCAL.join(" ")}; do eval "[ -z \\"\\\${$v+set}\\" ] || echo $v"; done; } > "${seen}"\nexit ${check}\n`);
    chmodSync(join(bin, "check"), 0o755);
  }
  const env = { PATH: bin, GIT_DIR: "/nowhere/.git", GIT_INDEX_FILE: "/nowhere/index", GIT_WORK_TREE: "/nowhere", GIT_PREFIX: "sub/" };
  const result = spawnSync("/bin/sh", ["-e", HOOK, "origin", "git@github.com:o/r.git"], { input: stdin, encoding: "utf8", env });
  const ran = (): string[] => {
    try {
      return readFileSync(seen, "utf8").trim().split("\n");
    } catch {
      return [];
    }
  };
  return { status: result.status, stderr: result.stderr, ran };
}

describe(".husky/pre-push, the one hook text every repo carries, judges a push it should and refuses one it cannot judge (#1369)", () => {
  it("exits 0 without calling check for a push of only notes and check-receipt refs", () => {
    const { status, ran } = prePush(pushing("refs/notes/commits", "refs/check/abc"), { check: 1 });

    expect(status).toBe(0);
    expect(ran()).toEqual([]);
  });

  it("refuses a branch push and names check on stderr when check is not on PATH, so a missing tool never passes an unchecked push", () => {
    const { status, stderr } = prePush(pushing("refs/notes/commits", "refs/heads/feature"));

    expect(status).not.toBe(0);
    expect(stderr).toContain("check");
    expect(stderr).toContain("PATH");
  });

  it("runs check --full --publish with git's local environment cleared and exits with its status", () => {
    for (const code of [0, 3]) {
      const { status, ran } = prePush(pushing("refs/heads/feature"), { check: code });

      expect(status).toBe(code);
      expect(ran()).toEqual(["--full --publish"]);
    }
  });
});
