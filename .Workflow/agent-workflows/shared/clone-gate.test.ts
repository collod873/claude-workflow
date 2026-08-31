import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
 * The re-cut door (#282). Every test here is the same shape: seed a clone, baseline it, change
 * something that is *not* the duplication, and check what the ratchet does with a fingerprint that
 * moved on its own.
 */
describe("a baselined clone whose fingerprint moves", () => {
  /** A clone worth reporting, with a comment inside the span jscpd will report as the fragment. */
  const cloned = (comment: string): string =>
    [
      "export const SENTINEL = 1;",
      "",
      `/** ${comment} */`,
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

  /** A scratch repo holding the clone twice, with its baseline already seeded over it. */
  function baselinedClone(comment = "what this measures"): string {
    const dir = makeScratchRepo();
    writeFileSync(join(dir, "left.ts"), cloned(comment), "utf8");
    writeFileSync(join(dir, "right.ts"), cloned(comment), "utf8");
    vi.stubEnv("GAUNTLET_VENUE", "");
    expect(runCloneGate(dir, ["--seed-baseline"])).toBe(0);
    return dir;
  }

  /** The baseline as written, for the assertions that are about the file rather than the exit code. */
  function baselineOf(dir: string): Array<{ hash: string; where: string[]; fragment?: string }> {
    return JSON.parse(readFileSync(join(dir, BASELINE_RELATIVE_PATH), "utf8")) as Array<{
      hash: string;
      where: string[];
      fragment?: string;
    }>;
  }

  it("is carried across a reworded comment instead of being both paid off and newly introduced", () => {
    // The live failure: `fakeGh` in fixer.test.ts and open-questions.test.ts, 13 lines and 107
    // tokens before and after, in the same two files — under a new hash, because jscpd's fragment
    // is a slice of source and carries comments its default mode never required to match. The old
    // entry read as paid off, the new one as introduced, and `--prune-baseline` only deleted.
    const dir = baselinedClone();
    const before = baselineOf(dir);
    writeFileSync(join(dir, "left.ts"), cloned("what this actually measures, at some length"), "utf8");

    const { code, out } = runGate(dir);

    expect(code, out).toBe(1);
    expect(out).toContain("were re-cut");
    // Not the two messages that used to fire, which pointed at deleting the entry and at refactoring.
    expect(out).not.toContain("no longer reproduce");
    expect(out).not.toContain("not in the baseline");

    expect(runCloneGate(dir, ["--prune-baseline"])).toBe(0);
    const after = baselineOf(dir);
    expect(after).toHaveLength(before.length);
    expect(after[0].hash).not.toBe(before[0].hash);
    expect(runGate(dir).code).toBe(0);
  });

  it("is carried when the match grows through content beside it that became shared", () => {
    // The other way a fingerprint moves with nobody touching the duplication: land the same line
    // in both files next to the clone and jscpd extends the matched run through it.
    const dir = baselinedClone();
    const before = baselineOf(dir);
    for (const file of ["left.ts", "right.ts"]) {
      writeFileSync(join(dir, file), `export const SHARED_LIMIT = 32;\n${cloned("what this measures")}`, "utf8");
    }

    const { code, out } = runGate(dir);
    expect(code, out).toBe(1);
    expect(out).toContain("were re-cut");

    expect(runCloneGate(dir, ["--prune-baseline"])).toBe(0);
    expect(baselineOf(dir)).toHaveLength(before.length);
    expect(runGate(dir).code).toBe(0);
  });

  it("still refuses a second, genuinely new clone between the very same two files", () => {
    // The carry is fenced by the file pair, so this is the case that says the fence is not a hole:
    // duplication nobody baselined, in the pair a baselined entry already names, is still a finding.
    const dir = baselinedClone();
    const second = [
      "",
      "export function widen(range: [number, number], by: number): [number, number] {",
      "  const [low, high] = range;",
      "  const nextLow = low - by;",
      "  const nextHigh = high + by;",
      "  if (nextLow > nextHigh) {",
      "    return [nextHigh, nextLow];",
      "  }",
      "  return [nextLow, nextHigh];",
      "}",
      "",
    ].join("\n");
    for (const file of ["left.ts", "right.ts"]) {
      writeFileSync(join(dir, file), cloned("what this measures") + second, "utf8");
    }

    const { code, out } = runGate(dir);

    expect(code, out).toBe(1);
    expect(out).toContain("not in the baseline");
  });

  it("still reports a clone that was actually deduplicated as paid-off debt to delete", () => {
    // The ratchet's own half. A carry must not have turned every stale entry into a shrug.
    const dir = baselinedClone();
    writeFileSync(join(dir, "right.ts"), "export const OTHER = 2;\n", "utf8");

    const { code, out } = runGate(dir);

    expect(code, out).toBe(1);
    expect(out).toContain("no longer reproduce");
    expect(out).not.toContain("were re-cut");

    expect(runCloneGate(dir, ["--prune-baseline"])).toBe(0);
    expect(baselineOf(dir)).toHaveLength(0);
  });

  it("refuses a baseline whose fragment was edited to something its own hash does not cover", () => {
    // `fragment` is what a re-cut is recognised by, so it is the one new thing a hand-edited
    // baseline could lie with. It cannot: the hash is over it, and the gate re-derives that.
    const dir = baselinedClone();
    const baseline = baselineOf(dir);
    baseline[0].fragment = "return 1;";
    writeFileSync(join(dir, BASELINE_RELATIVE_PATH), `${JSON.stringify(baseline, null, 2)}\n`, "utf8");

    const { code, out } = runGate(dir);

    expect(code).toBe(2);
    expect(out).toContain("does not hash to their own hash");
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

describe("the scan's staging tree", () => {
  /**
   * The gate stages inside the repo (jscpd drops paths outside its cwd) while a push's other
   * checks are walking that same tree. eslint's walker reads a directory the moment it sees it,
   * and a staging child deleted between the listing and the read is `ENOENT: scandir` — Integrate
   * run 33325994300 refused PR #281 on exactly that. The ignore is what keeps the two apart.
   */
  it("is ignored by eslint, so a push's concurrent lint never descends into a tree mid-deletion", () => {
    const config = readFileSync(fileURLToPath(new URL("../../../eslint.config.js", import.meta.url)), "utf8");
    expect(config).toContain('".clone-gate-scan/**"');
  });
});
