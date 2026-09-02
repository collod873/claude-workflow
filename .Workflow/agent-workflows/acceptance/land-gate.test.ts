import { describe, expect, it, vi } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { runLandGate, type LandGateDeps } from "./land-gate";

const execGitCalls: string[][] = [];
vi.mock("../shared/git", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../shared/git")>()),
  execGit: (args: string[]) => {
    execGitCalls.push(args);
    return "";
  },
}));

// Import after the mock so `bindGitToRoot` closes over the mocked `execGit`.
const { bindGitToRoot } = await import("./land-gate");

function deps(overrides: Partial<LandGateDeps> = {}): {
  fake: ReturnType<typeof createFakeGit>;
  refusals: string[];
  repairs: string[];
  deps: LandGateDeps;
} {
  const fake = createFakeGit(() => "");
  const refusals: string[] = [];
  const repairs: string[] = [];
  return {
    fake,
    refusals,
    repairs,
    deps: {
      runGauntletPush: () => ({ ok: true }),
      repairAcceptanceBaseline: () => ({ verdict: "clean" }),
      git: fake.git,
      reportRefusal: (message) => refusals.push(message),
      reportRepair: (message) => repairs.push(message),
      ...overrides,
    },
  };
}

describe("runLandGate", () => {
  it("is clear when the gauntlet and the clone gate are both already green — nothing changes", () => {
    const { fake, refusals, deps: d } = deps();

    const outcome = runLandGate(d);

    expect(outcome).toEqual({ verdict: "clear" });
    expect(fake.calls).toEqual([]);
    expect(refusals).toEqual([]);
  });

  it("refuses before ever calling the clone gate when bin/gauntlet push is already red", () => {
    let repairCalled = false;
    const { fake, refusals, deps: d } = deps({
      runGauntletPush: () => ({ ok: false, report: "--- typecheck ---\nsomething is wrong" }),
      repairAcceptanceBaseline: () => {
        repairCalled = true;
        return { verdict: "clean" };
      },
    });

    const outcome = runLandGate(d);

    expect(outcome.verdict).toBe("refused");
    expect(outcome.verdict === "refused" && outcome.reason).toContain("something is wrong");
    expect(repairCalled).toBe(false);
    expect(refusals).toHaveLength(1);
    expect(fake.calls).toEqual([]); // no baseline commit, and no push happens from here either way
  });

  it("commits the repaired baseline when the only clones are the acceptance lane's own overlap", () => {
    const { fake, refusals, deps: d } = deps({
      repairAcceptanceBaseline: () => ({
        verdict: "repaired",
        added: 1,
        carried: 0,
        report: "  typescript, 9 lines / 61 tokens [abc123]\n    tests/acceptance/a.ts:3",
      }),
    });

    const outcome = runLandGate(d);

    expect(outcome).toMatchObject({ verdict: "repaired", added: 1, carried: 0 });
    expect(fake.calls[0]?.[0]).toBe("add");
    expect(fake.calls[1]?.[0]).toBe("commit");
    expect(refusals).toEqual([]);
  });

  it("tells the ticket what it absorbed, so the one ratchet a machine may widen has a reader", () => {
    // The repair is right — nobody outside lane 04 may edit tests/acceptance/, so nobody else could
    // have deduped it — and it is also unattended, unreviewed, and behind the one push in this
    // pipeline that fires no Verify run. Its only trace was a JSON file with a few more entries.
    const { repairs, deps: d } = deps({
      repairAcceptanceBaseline: () => ({
        verdict: "repaired",
        added: 2,
        carried: 0,
        report: "  typescript, 9 lines / 61 tokens [abc123]\n    tests/acceptance/a.ts:3",
      }),
    });

    runLandGate(d);

    expect(repairs).toHaveLength(1);
    expect(repairs[0], "says how much was absorbed").toContain("2 clone(s)");
    expect(repairs[0], "names where, not just how many").toContain("tests/acceptance/a.ts:3");
    expect(repairs[0], "says the duplication is still there").toMatch(/still there/i);
  });

  it("commits the baseline when nothing was added and a re-cut entry was only carried across", () => {
    // #282's trap reaches this lane too: a clone it already carries can change fingerprint without
    // the duplication changing, and the repair writes a file with the same number of entries in it.
    // "Nothing added" is not "nothing to commit" — leaving it uncommitted pushes a tree the gate
    // refuses, which is the silent-red-main hole this whole gate exists to close.
    const { fake, refusals, deps: d } = deps({
      repairAcceptanceBaseline: () => ({ verdict: "repaired", added: 0, carried: 1, report: "" }),
    });

    const outcome = runLandGate(d);

    expect(outcome).toMatchObject({ verdict: "repaired", added: 0, carried: 1 });
    expect(fake.calls[0]?.[0]).toBe("add");
    expect(fake.calls[1]?.[0]).toBe("commit");
    expect(fake.calls[1]?.[2]).toContain("#282");
    expect(refusals).toEqual([]);
  });

  it("refuses, and commits nothing, when a clone the baseline does not carry touches a file outside tests/acceptance/", () => {
    const { fake, refusals, deps: d } = deps({
      repairAcceptanceBaseline: () => ({
        verdict: "refused",
        reason: "clone gate: 1 clone(s) not in the baseline touch a file outside tests/acceptance/",
      }),
    });

    const outcome = runLandGate(d);

    expect(outcome.verdict).toBe("refused");
    expect(outcome.verdict === "refused" && outcome.reason).toContain("outside tests/acceptance/");
    expect(fake.calls).toEqual([]);
    expect(refusals).toEqual(["clone gate: 1 clone(s) not in the baseline touch a file outside tests/acceptance/"]);
  });
});

/**
 * `main`'s baseline commit has to land in the target the push already targeted, not wherever this
 * process happens to run from — `execGit` carries no working directory of its own (`shared/git.ts`'s
 * docstring), so a raw `execGit` handed to `runLandGate` would commit against `process.cwd()`, the
 * machine checkout, instead.
 */
describe("bindGitToRoot", () => {
  it("binds every call to the given root, ahead of whatever argv the caller passes", () => {
    execGitCalls.length = 0;
    const git = bindGitToRoot("/some/target/checkout");

    git(["add", "clone-gate.baseline.json"]);
    git(["commit", "-m", "x"]);

    expect(execGitCalls).toEqual([
      ["-C", "/some/target/checkout", "add", "clone-gate.baseline.json"],
      ["-C", "/some/target/checkout", "commit", "-m", "x"],
    ]);
  });
});
