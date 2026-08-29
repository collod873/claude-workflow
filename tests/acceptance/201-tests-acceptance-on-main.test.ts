import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  } catch {
    return "";
  }
}

function mainRef(): string | null {
  for (const ref of ["origin/main", "refs/heads/main", "main"]) {
    if (git(["rev-parse", "--verify", "--quiet", ref]).trim() !== "") return ref;
  }
  return null;
}

describe("#201 lane 04 first authoring — it has actually run", () => {
  // - [ ] Lane 04 has authored once: `tests/acceptance/` exists on `main` with at least one file, pushed by the Actions bot — check: `gh api repos/collod873/claude-workflow/contents/tests/acceptance >/dev/null 2>&1`
  it("Lane 04 has authored once: `tests/acceptance/` exists on `main` with at least one file, pushed by the Actions bot", () => {
    const ref = mainRef();
    expect(ref, "main is resolvable in this checkout").not.toBeNull();

    const tracked = git(["ls-tree", "-r", "--name-only", ref as string, "--", "tests/acceptance"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(tracked.length, "tests/acceptance/ exists on main with at least one file").toBeGreaterThan(0);

    const authors = git(["log", "--format=%an <%ae>", ref as string, "--", "tests/acceptance"])
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(
      authors.some((a) => /github-actions/i.test(a)),
      "a commit under tests/acceptance/ on main was pushed by the Actions bot",
    ).toBe(true);
  });
});
