import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeTempRepo } from "../shared/temp-repo.fixture.ts";
import { emptyBaseline, serializeBaseline, type TimingBaseline } from "../shared/timing-baseline.ts";
import { GENERATED_ARTIFACTS, regenerateArtifacts, type GeneratorExec } from "./regenerate-artifacts";

const TIMING_BASELINE_PATH = ".Workflow/agent-workflows/shared/timing-baseline.json";
const CONTRACT_PATH = ".claude/contract.json";

/**
 * `regenerateArtifacts` against a real directory rather than a fake path list, so what is under
 * test is the seam ADR-0139 actually turns on: `existsSync`. A fake root like `"/repo"` reads every
 * artifact as absent regardless of intent, which is exactly the gap that let #335's Class 2 finding
 * stand unverified — `implement.ts:702`, `recover.ts:329` all thread through this one function, and
 * a target that never seeded `.Workflow/` (Lumaria: two of three artifacts absent) has to complete
 * its implement run rather than dying on the `git add` pathspec.
 */
const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

/** A temp repo carrying exactly the artifact paths in `present`, none of the others. */
function rootWith(present: readonly string[]): string {
  const repo = makeTempRepo("regenerate-artifacts");
  for (const path of present) repo.write(path, "");
  roots.push(repo.dir);
  return repo.dir;
}

/** A `GeneratorExec` that records every `(generator, root)` it is asked to run and always succeeds. */
function recordingExec(): { exec: GeneratorExec; calls: Array<{ generator: string; root: string }> } {
  const calls: Array<{ generator: string; root: string }> = [];
  const exec: GeneratorExec = (generator, root) => {
    calls.push({ generator, root });
    return { exitCode: 0, output: "" };
  };
  return { exec, calls };
}

describe("regenerateArtifacts", () => {
  it("regenerates every artifact already present at the root, in GENERATED_ARTIFACTS' own order", () => {
    const root = rootWith(GENERATED_ARTIFACTS.map((artifact) => artifact.path));
    const { exec, calls } = recordingExec();

    const result = regenerateArtifacts(exec, root, () => {});

    expect(calls).toEqual(GENERATED_ARTIFACTS.map((artifact) => ({ generator: artifact.generator, root })));
    expect(result).toEqual(GENERATED_ARTIFACTS.map((artifact) => artifact.path));
  });

  /**
   * The ADR-0139 case itself: an enrolled repository that never seeded most of `.Workflow/` — only
   * `.claude/contract.json` is guaranteed there — owes only what it carries. A generator run against
   * a path that was never present would leave `git add` naming a pathspec nothing on disk answers
   * to, which is the failure that used to take an implement run down with it. The corpus fixture is
   * used as the lone present artifact here (rather than the contract) so this test stays about the
   * present-only gate alone — the contract's own effect on the timing baseline is a separate test.
   */
  it("regenerates and returns only the artifacts already present, never the ones an enrolled repository never seeded", () => {
    const corpusFixture = GENERATED_ARTIFACTS[1]!;
    const absent = GENERATED_ARTIFACTS.filter((artifact) => artifact.path !== corpusFixture.path);
    const root = rootWith([corpusFixture.path]);
    const { exec, calls } = recordingExec();

    const result = regenerateArtifacts(exec, root, () => {});

    expect(calls).toEqual([{ generator: corpusFixture.generator, root }]);
    expect(result).toEqual([corpusFixture.path]);
    for (const artifact of absent) {
      expect(result).not.toContain(artifact.path);
    }
  });

  it("runs no generator and returns nothing at all when the root carries none of the artifacts", () => {
    const root = rootWith([]);
    const { exec, calls } = recordingExec();

    const result = regenerateArtifacts(exec, root, () => {});

    expect(calls).toEqual([]);
    expect(result).toEqual([]);
  });

  /**
   * ADR-0107's own account: a stale generated artifact is the push gate's to name, so a generator
   * failing here must not take the implementer's own work down with it — only log, and still report
   * the path present so the caller still `git add`s whatever the generator left behind. The corpus
   * fixture stands in for "some present artifact" here, same reason as above.
   */
  it("logs a failing generator rather than throwing, and still reports the artifact present", () => {
    const corpusFixture = GENERATED_ARTIFACTS[1]!;
    const root = rootWith([corpusFixture.path]);
    const logged: string[] = [];
    const exec: GeneratorExec = () => ({ exitCode: 1, output: "generator exploded" });

    const result = regenerateArtifacts(exec, root, (line) => logged.push(line));

    expect(result).toEqual([corpusFixture.path]);
    expect(logged.join("\n")).toContain("generator exploded");
  });

  /**
   * The ticket this file was split for: `regenerateArtifacts.ts:113`'s present-only gate leaves
   * `timing-baseline.json` forever absent at a target like Lumaria that carries `.claude/contract.json`
   * but never happened to seed a timing baseline of its own — which makes ADR-0140's ratchet
   * unreachable there by construction, not by choice. Seeding fixes that without touching the corpus
   * fixture or clone baseline, which stay exactly as present-only as the test above shows.
   */
  it("seeds an absent timing baseline when the target carries the contract, leaving the corpus fixture and clone baseline present-only", () => {
    const corpusFixture = GENERATED_ARTIFACTS[1]!;
    const cloneBaseline = GENERATED_ARTIFACTS[2]!;
    const root = rootWith([CONTRACT_PATH]);
    const { exec, calls } = recordingExec();

    const result = regenerateArtifacts(exec, root, () => {});

    expect(result).toContain(TIMING_BASELINE_PATH);
    expect(result).not.toContain(corpusFixture.path);
    expect(result).not.toContain(cloneBaseline.path);
    // Seeding writes the file directly rather than running its generator — the whole point being
    // that no measurement happens here.
    expect(calls.map((call) => call.generator)).not.toContain(
      GENERATED_ARTIFACTS.find((artifact) => artifact.path === TIMING_BASELINE_PATH)!.generator,
    );
  });

  /**
   * The seed has to be the ratchet's own "no entry yet" shape — `venues: {}`, no `suite`, no
   * `measuredOn` — because ADR-0142 already settled that only an actual venue run may write a
   * `venues` figure, and a `suite` written here would be this step's own solo measurement standing
   * in for the target's first real one.
   */
  it("seeds the timing baseline in the recorded-rather-than-judged state, not a measured figure", () => {
    const root = rootWith([CONTRACT_PATH]);
    const { exec } = recordingExec();

    regenerateArtifacts(exec, root, () => {});

    const written = JSON.parse(readFileSync(join(root, TIMING_BASELINE_PATH), "utf8")) as TimingBaseline;
    const expected = emptyBaseline();
    expect(written).toEqual(expected);
    expect(readFileSync(join(root, TIMING_BASELINE_PATH), "utf8")).toBe(serializeBaseline(expected));
  });

  it("does not seed a timing baseline for a root with no contract, even though nothing else is present either", () => {
    const root = rootWith([]);
    const { exec } = recordingExec();

    const result = regenerateArtifacts(exec, root, () => {});

    expect(result).not.toContain(TIMING_BASELINE_PATH);
  });
});
