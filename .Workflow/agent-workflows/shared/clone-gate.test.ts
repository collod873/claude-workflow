import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASELINE_RELATIVE_PATH, repairAcceptanceBaseline, runCloneGate } from "./clone-gate.ts";

/**
 * The gate is a thing whose contract is its exit code and its printed banner, and the defect this
 * file was written for (#218) does not exist in this repo's own tree: `knowledge-base/` is checked
 * out by `audit.yml` on the runner and nowhere else. So every test here builds a scratch repository
 * with the shape in question and runs the real gate against it — the only venue where a nested
 * checkout is present to be mishandled.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

let scratchDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
  scratchDirs = [];
});

/**
 * A repository the gate can actually scan: one TypeScript file long enough to be worth reading, and
 * this repo's own `node_modules` linked in, because `scan()` runs `<root>/node_modules/.bin/jscpd`
 * and a scratch tree has no dependency tree of its own. `node_modules` is gitignored so the link
 * never enters the file set, and `.gitignore` buckets as an already-declared extension.
 */
function makeScratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "clone-gate-"));
  scratchDirs.push(dir);
  execFileSync("git", ["init", "-q", dir]);
  writeFileSync(join(dir, ".gitignore"), "node_modules\n", "utf8");
  writeFileSync(
    join(dir, "source.ts"),
    ["export function add(a: number, b: number): number {", "  return a + b;", "}", "", "export const ONE = 1;", ""].join("\n"),
    "utf8",
  );
  symlinkSync(join(REPO_ROOT, "node_modules"), join(dir, "node_modules"));
  return dir;
}

/** Checks out a second, independent repository inside `dir` — the `knowledge-base/` shape. */
function nestRepository(dir: string, name: string): void {
  const nested = join(dir, name);
  mkdirSync(nested, { recursive: true });
  execFileSync("git", ["init", "-q", nested]);
  writeFileSync(join(nested, "corpus.md"), "# corpus\n", "utf8");
}

/** Runs the gate with the venue guard neutralised, and returns its code plus everything it printed. */
function runGate(root: string): { code: number; out: string } {
  // `bin/gauntlet` exports GAUNTLET_VENUE, and the gate declines to run when it sees one (rule 6).
  // A suite invoked from `npm run check` inside the gauntlet would otherwise no-op and pass.
  vi.stubEnv("GAUNTLET_VENUE", "");
  const lines: string[] = [];
  const collect = (...args: unknown[]): void => void lines.push(args.join(" "));
  vi.spyOn(console, "log").mockImplementation(collect);
  vi.spyOn(console, "error").mockImplementation(collect);
  const code = runCloneGate(root, []);
  return { code, out: lines.join("\n") };
}

describe("runCloneGate", () => {
  it("scans a tree containing a nested git repository instead of refusing it", () => {
    const dir = makeScratchRepo();
    nestRepository(dir, "knowledge-base");

    const { code, out } = runGate(dir);

    // `git ls-files` reports the nested checkout as `knowledge-base/`, whose extension is `""` —
    // which used to land in `undeclared` and take the whole Audit lane's `pre-push` down with it.
    expect(out).not.toContain("refusing to scan");
    expect(code).toBe(0);
    expect(out).toContain("scanned 1 files");
  });

  it("names the nested repository it skipped, so the skip is not the silent one rule 3 forbids", () => {
    const dir = makeScratchRepo();
    nestRepository(dir, "knowledge-base");

    const { out } = runGate(dir);

    expect(out).toContain("knowledge-base/");
    expect(out).toMatch(/skipped 1 nested git repository/);
  });

  it("scans a tree where a tracked file has been deleted, and names the path it skipped", () => {
    // `git ls-files --cached` still reports a path deleted in the worktree, and handing one to
    // jscpd killed the run with an empty exit 1 — no message, no report, indistinguishable from a
    // real refusal. A ticket whose whole job is deleting a module met this on its own pre-push.
    const dir = makeScratchRepo();
    // A second file, so the deletion leaves a non-empty scan set and this test stays about the
    // absent path rather than about an empty one.
    writeFileSync(join(dir, "doomed.ts"), ["export const TWO = 2;", "", "export const THREE = 3;", ""].join("\n"), "utf8");
    execFileSync("git", ["add", "-A"], { cwd: dir });
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "in"], {
      cwd: dir,
    });
    rmSync(join(dir, "doomed.ts"));

    const { code, out } = runGate(dir);

    expect(code, out).toBe(0);
    expect(out).toContain("doomed.ts");
    expect(out).toMatch(/skipped 1 path in the index with no file on disk/);
  });

  it("still refuses a genuinely undeclared extension bucket", () => {
    const dir = makeScratchRepo();
    nestRepository(dir, "knowledge-base");
    // A language the gate has neither a jscpd format nor an IGNORED_EXTENSIONS entry for. The
    // nested-repo skip must not have widened into "anything unaccounted for is fine" — that is the
    // vacuous pass the gate exists to make impossible.
    writeFileSync(join(dir, "program.cobol"), "IDENTIFICATION DIVISION.\n", "utf8");

    const { code, out } = runGate(dir);

    expect(code).toBe(2);
    expect(out).toContain("refusing to scan");
    expect(out).toContain(".cobol");
  });

  it("still refuses an extensionless file whose language nothing states", () => {
    const dir = makeScratchRepo();
    nestRepository(dir, "knowledge-base");
    // The nested-repo entry and this one bucket identically on extension — both `""`. If the skip
    // had been keyed on the empty bucket rather than on an actual `.git`, it would have taken
    // `bin/gauntlet`, `bin/clone-gate` and `.husky/pre-push` out of scope with it, which is the
    // founding mistake `docs/agents/clone-gate.md` records.
    writeFileSync(join(dir, "runner"), "no shebang here\n", "utf8");

    const { code, out } = runGate(dir);

    expect(code).toBe(2);
    expect(out).toContain("refusing to scan");
    // One file in the bucket, and it is this one — the nested checkout is not in there with it.
    expect(out).toContain(".(no extension) — 1 file(s), e.g. runner");
  });
});

/**
 * `repairAcceptanceBaseline` — the mechanical fix `land-gate.ts` runs before the acceptance lane
 * pushes to `main` (see that file, and its own doc comment above the function it calls). A block of
 * duplicated content, long enough to clear jscpd's 50-token/5-line minimum twice over so the tests
 * are not sitting on the threshold.
 */
const DUP_BLOCK = [
  "export function summariseRun(samples: number[]): { total: number; peak: number; mean: number } {",
  "  let total = 0;",
  "  let peak = Number.NEGATIVE_INFINITY;",
  "  for (const sample of samples) {",
  "    total += sample;",
  "    if (sample > peak) {",
  "      peak = sample;",
  "    }",
  "  }",
  "  return { total, peak, mean: samples.length === 0 ? 0 : total / samples.length };",
  "}",
  "",
].join("\n");

describe("repairAcceptanceBaseline", () => {
  it("baselines a clone the scan finds entirely between files under testDir", () => {
    const dir = makeScratchRepo();
    mkdirSync(join(dir, "tests/acceptance"), { recursive: true });
    writeFileSync(join(dir, "tests/acceptance/261-spec-sweep.fixture.ts"), DUP_BLOCK, "utf8");
    writeFileSync(join(dir, "tests/acceptance/274-stage-names.fixture.ts"), DUP_BLOCK, "utf8");

    const outcome = repairAcceptanceBaseline(dir, "tests/acceptance/");

    expect(outcome.verdict).toBe("repaired");
    expect(outcome.verdict === "repaired" && outcome.added).toBe(1);
    const baseline = JSON.parse(readFileSync(join(dir, BASELINE_RELATIVE_PATH), "utf8")) as Array<{
      where: string[];
    }>;
    expect(baseline).toHaveLength(1);
    expect(baseline[0].where).toEqual([
      "tests/acceptance/261-spec-sweep.fixture.ts:1",
      "tests/acceptance/274-stage-names.fixture.ts:1",
    ]);

    // The repair actually clears the gate it just fed — the point of running this before the push.
    vi.stubEnv("GAUNTLET_VENUE", "");
    expect(runCloneGate(dir, [])).toBe(0);
  });

  it("refuses, and writes nothing, when a clone not in the baseline touches a file outside testDir", () => {
    const dir = makeScratchRepo();
    mkdirSync(join(dir, "tests/acceptance"), { recursive: true });
    writeFileSync(join(dir, "tests/acceptance/261-spec-sweep.fixture.ts"), DUP_BLOCK, "utf8");
    // Same fragment, but the second copy lives outside tests/acceptance/ — nobody but lane 04 may
    // touch the acceptance side, but a pull request could touch this one, so it is a real clone.
    writeFileSync(join(dir, "src-other.ts"), DUP_BLOCK, "utf8");

    const outcome = repairAcceptanceBaseline(dir, "tests/acceptance/");

    expect(outcome.verdict).toBe("refused");
    expect(outcome.verdict === "refused" && outcome.reason).toContain("outside tests/acceptance/");
    expect(existsSync(join(dir, BASELINE_RELATIVE_PATH))).toBe(false);
  });

  it("changes nothing when the scan finds no clone the baseline does not already carry", () => {
    const dir = makeScratchRepo();
    mkdirSync(join(dir, "tests/acceptance"), { recursive: true });
    writeFileSync(join(dir, "tests/acceptance/one.fixture.ts"), "export const ONE = 1;\n", "utf8");

    const before = repairAcceptanceBaseline(dir, "tests/acceptance/");
    expect(before.verdict).toBe("clean");
    expect(existsSync(join(dir, BASELINE_RELATIVE_PATH))).toBe(false);

    // Seed a clone, baseline it once, then confirm a second call over the same tree is a no-op —
    // "nothing changes" holds for an already-baselined clone, not only for a tree with none at all.
    writeFileSync(join(dir, "tests/acceptance/261-spec-sweep.fixture.ts"), DUP_BLOCK, "utf8");
    writeFileSync(join(dir, "tests/acceptance/274-stage-names.fixture.ts"), DUP_BLOCK, "utf8");
    const seeded = repairAcceptanceBaseline(dir, "tests/acceptance/");
    expect(seeded.verdict).toBe("repaired");
    const written = readFileSync(join(dir, BASELINE_RELATIVE_PATH), "utf8");

    const again = repairAcceptanceBaseline(dir, "tests/acceptance/");

    expect(again.verdict).toBe("clean");
    expect(readFileSync(join(dir, BASELINE_RELATIVE_PATH), "utf8")).toBe(written);
  });
});
