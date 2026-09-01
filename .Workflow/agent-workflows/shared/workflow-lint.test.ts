import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow";
import { lintChangedWorkflows, PIN_SOURCE, pinnedActionlintImage, type Ran, type Run } from "./workflow-lint";

/**
 * Derived from `WORKFLOWS_DIR` rather than resolved again here — `read-workflow.ts` owns where this
 * repo's files sit, and a second copy of that resolution is a second thing to fix when it moves.
 */
const REPO_ROOT = resolve(WORKFLOWS_DIR, "../..");

/**
 * A scripted `Run`. Every case below drives the real decision function and only fakes the two
 * subprocesses, so the branch that matters most — a stopped Docker daemon exiting 1 exactly like a
 * linter finding — is reachable without a Docker daemon to stop.
 */
function scripted(script: Partial<Record<string, Ran>>): { run: Run; calls: string[][] } {
  const calls: string[][] = [];
  const run: Run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === "git") return script.git ?? { status: 0, output: "" };
    if (args[0] === "version") return script.daemon ?? { status: 0, output: "29.6.2\n" };
    return script.lint ?? { status: 0, output: "" };
  };
  return { run, calls };
}

const CHANGED: Ran = { status: 0, output: ".github/workflows/implement.yml\n" };
const pin = () => readWorkflow(PIN_SOURCE.replace(".github/workflows/", "")).source;

describe("the pin, read rather than retyped", () => {
  it("is the same image verify.yml's own step runs", () => {
    expect(pinnedActionlintImage(pin())).toMatch(/^rhysd\/actionlint:\d+\.\d+\.\d+$/);
  });

  it("refuses a source naming no linter at all, rather than guessing one", () => {
    expect(() => pinnedActionlintImage("steps:\n  - run: echo hi\n")).toThrow(/names no docker/);
  });

  it("refuses two different pins, because picking either one is a coin flip", () => {
    const twoPins = "uses: docker://rhysd/actionlint:1.7.7\nuses: docker://rhysd/actionlint:1.6.0\n";
    expect(() => pinnedActionlintImage(twoPins)).toThrow(/2 different actionlint pins/);
  });

  it("accepts the same pin named twice, which is one pin", () => {
    const same = "uses: docker://rhysd/actionlint:1.7.7\nuses: docker://rhysd/actionlint:1.7.7\n";
    expect(pinnedActionlintImage(same)).toBe("rhysd/actionlint:1.7.7");
  });
});

describe("what the push venue actually checks", () => {
  it("says nothing and starts no container when the workflows match trunk", () => {
    const { run, calls } = scripted({ git: { status: 0, output: "\n" } });
    expect(lintChangedWorkflows(REPO_ROOT, run, pin)).toEqual({ verdict: "nothing-to-lint" });
    expect(calls.map((call) => call[0])).toEqual(["git"]);
  });

  it("asks nothing at all of a root with no workflow directory to be wrong about", () => {
    const bare = mkdtempSync(join(tmpdir(), "workflow-lint-bare "));
    const { run, calls } = scripted({ git: CHANGED });
    expect(lintChangedWorkflows(bare, run, pin)).toEqual({ verdict: "nothing-to-lint" });
    expect(calls).toEqual([]);
  });

  it("lints anyway when git could not answer, rather than reading an unknown as a pass", () => {
    const { run } = scripted({ git: { status: 128, output: "fatal: bad revision 'origin/main'" } });
    expect(lintChangedWorkflows(REPO_ROOT, run, pin)).toEqual({ verdict: "clean" });
  });

  it("reports a stopped daemon as unchecked, never as a finding in the YAML", () => {
    const { run, calls } = scripted({
      git: CHANGED,
      daemon: { status: 1, output: "Cannot connect to the Docker daemon" },
    });
    const result = lintChangedWorkflows(REPO_ROOT, run, pin);
    expect(result.verdict).toBe("unchecked");
    expect(calls).toHaveLength(2);
  });

  it("reports actionlint's own exit 1 as findings, with what it said", () => {
    const { run } = scripted({ git: CHANGED, lint: { status: 1, output: "implement.yml:48:5: context" } });
    expect(lintChangedWorkflows(REPO_ROOT, run, pin)).toEqual({
      verdict: "findings",
      report: "implement.yml:48:5: context",
    });
  });

  it("reports a container that failed to start as unchecked rather than clean", () => {
    const { run } = scripted({ git: CHANGED, lint: { status: 125, output: "no such image" } });
    expect(lintChangedWorkflows(REPO_ROOT, run, pin)).toMatchObject({ verdict: "unchecked" });
  });

  it("mounts the root as one argument, so a checkout path with a space in it still lints", () => {
    const spaced = mkdtempSync(join(tmpdir(), "workflow lint "));
    mkdirSync(join(spaced, ".github/workflows"), { recursive: true });
    const { run, calls } = scripted({ git: CHANGED });
    lintChangedWorkflows(spaced, run, pin);
    expect(calls[2]).toContain(`${spaced}:/repo`);
  });
});

describe("the check is wired to the venue that runs it", () => {
  const gauntlet = readFileSync(join(REPO_ROOT, "bin/gauntlet"), "utf8");

  it("is named in the push venue's check list, so a failure is reported under a name", () => {
    expect(gauntlet).toMatch(/checks="\$checks contract corpus clones wiring workflows trailers"/);
  });

  it("is spawned by bin/gauntlet, not merely importable from a test", () => {
    expect(gauntlet).toContain("shared/workflow-lint.ts");
  });

  it("has its exit 2 read as a gauntlet that could not run, not as a finding", () => {
    expect(gauntlet).toMatch(/own_protocol=" contract corpus clones wiring workflows trailers "/);
  });
});
