import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutChanged,
  githubHoldingClaims,
  HEAD_SHA,
  minutesAgo,
  NOW,
  PR_URL,
  prCreatesIn,
  refDeletesIn,
  ticketCommentsIn,
  type ClaimHostOptions,
} from "../shared/claim-host.fixture";
import { describeAttempt } from "../shared/changed-paths";
import { GIT_REFS_PATH } from "../shared/gh-paths";
import { declaredEditsNote, gateRedNote } from "../shared/implementation-landing";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { implementationBranch } from "../shared/ready-set";
import type { GateVerdict } from "../shared/run-gauntlet";
import { scratchDir } from "../shared/scratch.fixture";
import { createFakeStage, createFakeStages } from "../shared/stage.fake";
import { extractFilesClaimed, parentPrdNumber } from "../shared/ticket-shape";
import {
  ANSWER_PATH_ENV,
  CLAIM_TIMEOUT_MINUTES,
  extractSeamsConsumed,
  findFailingTestFiles,
  FRESH_EYES_MODEL,
  IMPLEMENTER_DENIED_TOOLS,
  moduleContextPath,
  runImplement,
  sessionsNote,
  staleClaimTakeoverNote,
  VERIFY_DISPATCH_EVENT_TYPE,
  type ImplementDeps,
} from "./implement";

const ISSUE = 167;
const BRANCH = implementationBranch(ISSUE);
const BUILDS = { summary: "Built the thing.", outOfBriefReads: [] as string[], declaredEdits: [] as { path: string; reason: string }[] };
const BUILT: Record<string, string> = { "a/b.ts": "export const x = 1;" };

function gateSaying(...verdicts: GateVerdict[]): { runs: GateVerdict[]; runGate: () => GateVerdict } {
  const runs: GateVerdict[] = [];
  return {
    runs,
    runGate: () => {
      const verdict = verdicts[runs.length] ?? verdicts[verdicts.length - 1] ?? { ok: true };
      runs.push(verdict);
      return verdict;
    },
  };
}

interface Arrangement {
  github?: ClaimHostOptions;
  deps?: Partial<ImplementDeps>;
  built?: Record<string, string>;
  deleted?: string[];
}

function arrange({ github = {}, deps: extra = {}, built = BUILT, deleted = [] }: Arrangement = {}) {
  const host = githubHoldingClaims(github);
  const checkout = checkoutChanged(Object.keys(built), deleted);
  const stage = createFakeStage(JSON.stringify(BUILDS));
  const gate = gateSaying({ ok: true });
  const log: string[] = [];
  const deps: ImplementDeps = {
    gh: host.gh,
    exec: stage.exec,
    git: checkout.git,
    attempt: () => describeAttempt(checkout.git),
    readFile: (path) => built[path] ?? "# CONTEXT\n",
    fileExists: (path) => path in built,
    writeFile: () => {},
    removeFile: () => {},
    regenerateIndex: () => false,
    runGate: gate.runGate,
    sourceFiles: () => [],
    adrFiles: () => [],
    issueNumber: ISSUE,
    failingTests: () => [],
    standards: () => "",
    comments: () => [],
    log: (line) => log.push(line),
    now: NOW,
    ...extra,
  };
  return { deps, host, stage, log, gitCalls: checkout.calls, gateRuns: gate.runs };
}

describe("what the brief is read from", () => {
  it("extractSeamsConsumed reads the lines render-body.ts writes under '## Seams consumed'", () => {
    const body = ["## Files claimed", "- foo.ts", "", "## Seams consumed", "", "First seam line.", "Second seam line.", ""].join("\n");

    expect(extractSeamsConsumed(body)).toEqual(["First seam line.", "Second seam line."]);
  });

  it("extractSeamsConsumed is empty when the ticket consumed no seam (the heading is absent)", () => {
    expect(extractSeamsConsumed("## Files claimed\n- foo.ts\n")).toEqual([]);
  });

  it("extractFilesClaimed reads the paths render-body.ts writes under '## Files claimed'", () => {
    const body = ["## Files claimed", "- a/b.ts", "- a/b.test.ts", "", "## Seams consumed", "", "a seam"].join("\n");

    expect(extractFilesClaimed(body)).toEqual(["a/b.ts", "a/b.test.ts"]);
  });

  it("extractFilesClaimed treats render-body.ts's 'None — no files.' sentinel as no files, never as a path", () => {
    expect(extractFilesClaimed("## Files claimed\n- None — no files.\n")).toEqual([]);
  });

  it("moduleContextPath walks up from the first claimed file to the nearest CONTEXT.md", () => {
    const existing = new Set(["a/b/CONTEXT.md"]);

    expect(moduleContextPath(["a/b/c.ts", "a/b/c.test.ts"], (path) => existing.has(path))).toBe("a/b/CONTEXT.md");
  });

  it("moduleContextPath falls back to the repo root's CONTEXT.md when no closer one exists, or no file is claimed", () => {
    expect(moduleContextPath(["a/b/c.ts"], () => false)).toBe("CONTEXT.md");
    expect(moduleContextPath([], () => false)).toBe("CONTEXT.md");
  });

  it("parentPrdNumber reads the number render-body.ts writes under '## Parent PRD', undefined without the heading", () => {
    expect(parentPrdNumber("## Parent PRD\n#145\n\n## What to build\n…")).toBe(145);
    expect(parentPrdNumber("## What to build\n…")).toBeUndefined();
  });
});

describe("runImplement builds the ticket and hands the pull request to Verify", () => {
  it("reads the checkout as the answer, opens exactly one PR, then sends exactly one dispatch naming it, the files and the criteria", async () => {
    const ticket = {
      title: "Do the thing",
      body: ["## Acceptance criteria", "- [ ] The thing is done", "", "## Files claimed", "- a/b.ts", "", "## Seams consumed", "", "a seam"].join("\n"),
    };
    const written = new Map<string, string>();
    const { deps, host } = arrange({ github: { ticket }, deps: { writeFile: (path, content) => written.set(path, content) } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(written.get("a/b.ts")).toBe("export const x = 1;");
    expect(prCreatesIn(host.calls)).toHaveLength(1);

    expect(host.dispatches).toEqual([
      { eventType: VERIFY_DISPATCH_EVENT_TYPE, payload: { pr: PR_URL, changed_files: "a/b.ts", criteria: "The thing is done" } },
    ]);
    const dispatch = host.calls.find((call) => call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatch).toContain("client_payload[criteria][]=The thing is done");

    expect(host.calls.indexOf(prCreatesIn(host.calls)[0])).toBeLessThan(host.calls.indexOf(dispatch!));
  });

  it("hands the implementer stage a brief carrying the ticket body, the acceptance test content and the claimed file as it stands", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const { deps, stage } = arrange({
      github: { ticket },
      deps: { failingTests: () => [{ path: "foo.test.ts", content: "the test.fails( assertion" }] },
    });

    await runImplement(deps);

    expect(stage.stdins[0]).toContain(ticket.body);
    expect(stage.stdins[0]).toContain("the test.fails( assertion");
    expect(stage.stdins[0]).toContain("### a/b.ts\n\nexport const x = 1;");
  });

  it("hands the implementer stage a brief carrying a ticket comment's body and a coding standard's name", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const standards = [
      "## Standards",
      "",
      "- **Refuse rather than guess**: stop rather than take a guessed default.",
      "  Why: a guessed answer is indistinguishable from a real one downstream.",
      "  Red flag: a first-of-list pick where the list could hold more than one.",
    ].join("\n");
    const { deps, stage } = arrange({
      github: { ticket },
      deps: {
        standards: () => standards,
        comments: () => [
          { author: "collod873", createdAt: "2026-08-01T00:00:00Z", body: "Use the retry helper instead." },
        ],
      },
    });

    await runImplement(deps);

    expect(stage.stdins[0]).toContain("Use the retry helper instead.");
    expect(stage.stdins[0]).toContain("Refuse rather than guess");
  });

  it("a file the implementer removed from the checkout lands as a deletion in the same commit", async () => {
    const removed: string[] = [];
    const { deps, gitCalls, host } = arrange({ deleted: ["a/old.ts"], deps: { removeFile: (path) => removed.push(path) } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(removed).toEqual(["a/old.ts"]);
    expect(gitCalls.find((call) => call[0] === "add")).toEqual(["add", "a/b.ts", "a/old.ts"]);
    expect(host.dispatches[0].payload.changed_files).toBe("a/b.ts,a/old.ts");
  });

  it("fetches trunk and rebases onto it between the commit and the push, and pushes past the hook whose gate it already ran", async () => {
    const { deps, gitCalls } = arrange();

    await runImplement(deps);

    const order = gitCalls.map((call) => call[0]);
    expect(order.indexOf("commit")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("fetch")).toBeGreaterThan(order.indexOf("commit"));
    expect(order.indexOf("rebase")).toBeGreaterThan(order.indexOf("fetch"));
    expect(order.indexOf("push")).toBeGreaterThan(order.indexOf("rebase"));
    expect(gitCalls[order.indexOf("fetch")]).toEqual(["fetch", "origin", "main"]);
    expect(gitCalls[order.indexOf("rebase")]).toEqual(["rebase", "origin/main"]);
    expect(gitCalls[order.indexOf("push")]).toEqual(["push", "--no-verify", "origin", `HEAD:${BRANCH}`]);
  });
});

describe("the push gate runs in the wire, once, with one repair round", () => {
  const RED = { ok: false, output: "--- typecheck ---\nerror TS2322: boom" } as const;

  it("judges a green answer exactly once and never resumes the model", async () => {
    const { deps, stage, gateRuns } = arrange();

    await runImplement(deps);

    expect(gateRuns).toEqual([{ ok: true }]);
    expect(stage.calls).toHaveLength(1);
  });

  it("does not run the gate when the model left the checkout untouched", async () => {
    const { deps, gateRuns } = arrange({ built: {} });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "nothing-to-build" });
    expect(gateRuns).toEqual([]);
  });

  it("resumes the same session with the gate's output when it is red, then judges the repair once more", async () => {
    const stage = createFakeStages([
      { text: JSON.stringify({ ...BUILDS, outOfBriefReads: ["shape"] }), sessionId: "sess-1" },
      JSON.stringify({ summary: "Built, then repaired the thing.", outOfBriefReads: ["shape", "close-gate"] }),
    ]);
    const gate = gateSaying(RED, RED, { ok: true });
    const kept: Record<string, string> = {};
    const { deps, host } = arrange({
      github: { answer: (args) => (args[0] === "issue" && args[1] === "list" ? "[]" : undefined) },
      deps: {
        exec: stage.exec,
        runGate: gate.runGate,
        env: { [ANSWER_PATH_ENV]: "/tmp/answer.json" },
        writeFile: (path, content) => { kept[path] = content; },
      },
    });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(gate.runs).toEqual([RED, RED, { ok: true }]);
    expect(stage.calls[1]).toContain("--resume");
    expect(stage.calls[1][stage.calls[1].indexOf("--resume") + 1]).toBe("sess-1");
    expect(stage.stdins[1]).toContain(RED.output);
    expect(prCreatesIn(host.calls)[0]).toContain("Built, then repaired the thing.\n\nCloses #167");
    expect(JSON.parse(kept["/tmp/answer.json"]).outOfBriefReads).toEqual(["shape", "shape", "close-gate"]);
    expect(ticketCommentsIn(host.calls)).toEqual([]);
    expect(host.calls.some((call) => call.includes(NEEDS_HUMAN_LABEL))).toBe(false);
  });

  async function buildWithSession(...verdicts: GateVerdict[]) {
    const stage = createFakeStages([{ text: JSON.stringify(BUILDS), sessionId: "sess-1" }, JSON.stringify(BUILDS)]);
    const gate = gateSaying(...verdicts);
    const arranged = arrange({ deps: { exec: stage.exec, runGate: gate.runGate } });
    const result = await runImplement(arranged.deps);
    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    return { ...arranged, stage, gate };
  }

  it("re-runs a red gate once and, when the second run is green, treats the first as a flake and repairs nothing", async () => {
    const { host, stage, gate } = await buildWithSession(RED, { ok: true });

    expect(gate.runs).toEqual([RED, { ok: true }]);
    expect(stage.calls).toHaveLength(1);
    expect(ticketCommentsIn(host.calls)).toEqual([]);
    expect(host.calls.some((call) => call.includes(NEEDS_HUMAN_LABEL))).toBe(false);
  });

  it("denies the implementer the tools that would move the checkout or spend outside it", async () => {
    const { deps, stage } = arrange();

    await runImplement(deps);

    const argv = stage.calls[0];
    expect(argv[argv.indexOf("--disallowedTools") + 1]).toBe(IMPLEMENTER_DENIED_TOOLS.join(","));
    expect(IMPLEMENTER_DENIED_TOOLS).toContain("Bash(git stash:*)");
    expect(IMPLEMENTER_DENIED_TOOLS).toContain("Bash(gh:*)");
    expect(IMPLEMENTER_DENIED_TOOLS).not.toContain("Bash(git:*)");
  });
});

describe("rung two: a fresh Opus session with a clean context, after rung one is still red", () => {
  const RED = { ok: false, output: "--- typecheck ---\nerror TS2322: boom" } as const;

  it("runs a fresh session on claude-opus-5, with no --resume, carrying the ticket body, the attempt so far and the gate output", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const stage = createFakeStages([
      { text: JSON.stringify(BUILDS), sessionId: "sess-1" },
      JSON.stringify(BUILDS),
      JSON.stringify(BUILDS),
    ]);
    const gate = gateSaying(RED);
    const { deps, host } = arrange({ github: { ticket }, deps: { exec: stage.exec, runGate: gate.runGate } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(stage.calls).toHaveLength(3);
    const freshEyesArgv = stage.calls[2];
    expect(freshEyesArgv[freshEyesArgv.indexOf("--model") + 1]).toBe(FRESH_EYES_MODEL);
    expect(freshEyesArgv).not.toContain("--resume");
    expect(stage.stdins[2]).toContain(ticket.body);
    expect(stage.stdins[2]).toContain(RED.output);
    expect(stage.stdins[2]).toContain("Built the thing.");
    expect(stage.stdins[2]).toContain("Untracked:\n- a/b.ts");
    expect(gate.runs).toHaveLength(6);
    expect(prCreatesIn(host.calls)).toHaveLength(1);
  });

  it("leaves no trace of needs-human or a gateRedNote when the fresh-eyes round turns the gate green", async () => {
    const stage = createFakeStages([
      { text: JSON.stringify(BUILDS), sessionId: "sess-1" },
      JSON.stringify(BUILDS),
      JSON.stringify({ ...BUILDS, summary: "Fresh eyes fixed it." }),
    ]);
    const gate = gateSaying(RED, RED, RED, RED, { ok: true });
    const { deps, host } = arrange({ deps: { exec: stage.exec, runGate: gate.runGate } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(gate.runs).toEqual([RED, RED, RED, RED, { ok: true }]);
    expect(ticketCommentsIn(host.calls)).toEqual([]);
    expect(host.calls.some((call) => call.includes(NEEDS_HUMAN_LABEL))).toBe(false);
    const prCall = prCreatesIn(host.calls)[0];
    expect(prCall[prCall.indexOf("--body") + 1]).toContain("Fresh eyes fixed it.");
  });

  it("pushes anyway when the fresh-eyes round is still red, and hands the owner the gate's output on the ticket", async () => {
    const stage = createFakeStages([
      { text: JSON.stringify(BUILDS), sessionId: "sess-1" },
      JSON.stringify(BUILDS),
      JSON.stringify(BUILDS),
    ]);
    const gate = gateSaying(RED);
    const { deps, host, gitCalls } = arrange({ deps: { exec: stage.exec, runGate: gate.runGate } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(gate.runs).toHaveLength(6);
    expect(gitCalls.some((call) => call[0] === "push")).toBe(true);
    expect(ticketCommentsIn(host.calls)).toEqual([gateRedNote(RED.output)]);
    expect(host.calls).toContainEqual(["issue", "edit", String(ISSUE), "--add-label", NEEDS_HUMAN_LABEL]);
  });

  it("skips the repair round when rung one's answer came back without a session to resume, and goes straight to fresh eyes", async () => {
    const gate = gateSaying(RED);
    const { deps, host, stage } = arrange({ deps: { runGate: gate.runGate } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(stage.calls).toHaveLength(2);
    expect(stage.calls[1]).not.toContain("--resume");
    expect(stage.calls[1][stage.calls[1].indexOf("--model") + 1]).toBe(FRESH_EYES_MODEL);
    expect(gate.runs).toHaveLength(4);
    expect(ticketCommentsIn(host.calls)).toEqual([gateRedNote(RED.output)]);
  });

  it("posts fresh-eyes's declaredEdits in the PR body and as a ticket comment, via declaredEditsNote", async () => {
    const edits = [{ path: "a/b.ts", reason: "The acceptance test asserted the old return shape." }];
    const stage = createFakeStages([
      { text: JSON.stringify(BUILDS), sessionId: "sess-1" },
      JSON.stringify(BUILDS),
      JSON.stringify({
        summary: "Rewrote the acceptance test; it asserted the wrong shape.",
        outOfBriefReads: [],
        declaredEdits: edits,
      }),
    ]);
    const gate = gateSaying(RED, RED, RED, RED, { ok: true });
    const { deps, host } = arrange({ deps: { exec: stage.exec, runGate: gate.runGate } });

    await runImplement(deps);

    const note = declaredEditsNote(edits);
    const prCall = prCreatesIn(host.calls)[0];
    expect(prCall[prCall.indexOf("--body") + 1]).toContain(note);
    expect(ticketCommentsIn(host.calls)).toContain(note);
  });

  it("names the fresh-eyes stage in the sessions note", async () => {
    const stage = createFakeStages([
      { text: JSON.stringify(BUILDS), sessionId: "sess-1" },
      JSON.stringify(BUILDS),
      { text: JSON.stringify(BUILDS), turns: 5, gauntletRuns: 2 },
    ]);
    const gate = gateSaying(RED, RED, RED, RED, { ok: true });
    const { deps, host } = arrange({ deps: { exec: stage.exec, runGate: gate.runGate } });

    await runImplement(deps);

    expect(ticketCommentsIn(host.calls)).toEqual([
      sessionsNote([
        { stage: "implementer", turns: undefined, gauntletRuns: undefined },
        { stage: "implementer-repair", turns: undefined, gauntletRuns: undefined },
        { stage: "implementer-fresh-eyes", turns: 5, gauntletRuns: 2 },
      ]),
    ]);
  });

});

describe("instrumentation: a sessionsNote comment tells red gates from unrun ones", () => {
  it("posts one comment naming the implementer session's turns and gauntlet runs when the model reported them", async () => {
    const stage = createFakeStage({ text: JSON.stringify(BUILDS), turns: 41, gauntletRuns: 3 });
    const { deps, host } = arrange({ deps: { exec: stage.exec } });

    await runImplement(deps);

    expect(ticketCommentsIn(host.calls)).toEqual([
      sessionsNote([{ stage: "implementer", turns: 41, gauntletRuns: 3 }]),
    ]);
  });

  it("posts no sessionsNote comment when the run reported no turns, as on a checkpoint replay", async () => {
    const { deps, host } = arrange();

    await runImplement(deps);

    expect(ticketCommentsIn(host.calls)).toEqual([]);
  });
});

describe("runImplement claims its branch before it spends anything", () => {
  it("creates the ref at HEAD as its very first call, and only then runs the model", async () => {
    const { deps, host, stage } = arrange();

    await runImplement(deps);

    expect(host.calls[0]).toEqual(["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${HEAD_SHA}`]);
    expect(stage.stdins).toHaveLength(1);
  });

  it("refuses a closed ticket before the model: no stage call, claim released, said out loud", async () => {
    const { deps, host, stage } = arrange({ github: { ticket: { title: "already merged", body: "", state: "CLOSED" } } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "ticket-closed" });
    expect(stage.stdins, "the refusal fires before any model spend").toHaveLength(0);
    expect(host.refs.size, "the claim does not outlive the refusal").toBe(0);
    expect(prCreatesIn(host.calls)).toEqual([]);
  });

  it("exits already-claimed without the model, the PR, the dispatch or the acceptance tests", async () => {
    let resolved = 0;
    const { deps, host, stage, log } = arrange({
      github: { existingClaim: { branch: BRANCH, createdAt: minutesAgo(2) } },
      deps: { failingTests: () => { resolved += 1; return []; } },
    });

    const result = await runImplement(deps);

    expect(result, "a duplicate ticket-ready is an ordinary event, not a failure").toEqual({ outcome: "already-claimed" });
    expect(stage.stdins).toHaveLength(0);
    expect(prCreatesIn(host.calls)).toEqual([]);
    expect(host.dispatches).toEqual([]);
    expect(resolved, "the acceptance tests were read for a run that had nothing to do").toBe(0);
    expect(log.join("\n")).toContain(BRANCH);
  });

  it("asks GitHub only whether the refused claim is still held, and changes nothing", async () => {
    const { deps, host } = arrange({ github: { existingClaim: { branch: BRANCH, createdAt: minutesAgo(2) } } });

    await runImplement(deps);

    expect(host.calls.some((call) => call[0] === "issue")).toBe(false);
    expect(refDeletesIn(host.calls)).toEqual([]);
    expect(host.refs).toEqual(new Set([BRANCH]));
  });
});

describe("a claim does not outlive the run that made it", () => {
  it("releases the claim when the run fails before opening a pull request", async () => {
    const { deps, host } = arrange({ github: { prCreate: new Error("GraphQL: GitHub Actions is not permitted to create pull requests") } });

    await expect(runImplement(deps)).rejects.toThrow(/not permitted to create pull requests/);

    expect(host.refs.has(BRANCH), "the claim this run made outlived it").toBe(false);
    expect(refDeletesIn(host.calls)).toHaveLength(1);
  });

  it("leaves the claim alone when the failure came after a pull request was already open", async () => {
    const { deps, host } = arrange({
      github: {
        existingClaim: { branch: BRANCH, pullRequests: 1 },
        answer: (args) => {
          if (args[1] === "repos/{owner}/{repo}/dispatches") throw new Error("HTTP 503");
          return undefined;
        },
      },
    });
    host.refs.delete(BRANCH);

    await expect(runImplement(deps)).rejects.toThrow(/503/);

    expect(host.refs.has(BRANCH)).toBe(true);
    expect(refDeletesIn(host.calls)).toEqual([]);
  });

  it("takes over a stale claim, builds the ticket, and says so on the ticket", async () => {
    const { deps, host, stage } = arrange({ github: { existingClaim: { branch: BRANCH, createdAt: minutesAgo(CLAIM_TIMEOUT_MINUTES + 1) } } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(stage.stdins, "the implementer ran this time").toHaveLength(1);
    expect(ticketCommentsIn(host.calls)).toEqual([staleClaimTakeoverNote(BRANCH)]);
  });
});

describe("the implementer's answer, kept", () => {
  const RECEIPT = "/tmp/answer.json";

  async function keptAnswer(built: Record<string, string>): Promise<unknown> {
    const written: Record<string, string> = {};
    const { deps } = arrange({
      built,
      deps: { env: { [ANSWER_PATH_ENV]: RECEIPT }, writeFile: (path, content) => { written[path] = content; } },
    });

    await runImplement(deps);

    return JSON.parse(written[RECEIPT]);
  }

  it("writes the derived answer where the workflow can upload it, even on the run that builds nothing", async () => {
    expect(await keptAnswer({})).toEqual({ files: [], deleted: [], ...BUILDS });
  });

  it("carries the checkout's content, so a replay can land it without the model", async () => {
    expect(await keptAnswer(BUILT)).toEqual({ files: [{ path: "a/b.ts", content: "export const x = 1;" }], deleted: [], ...BUILDS });
  });

  it("writes nothing extra on a workstation run, which sets no path", async () => {
    const written: string[] = [];
    const { deps } = arrange({ deps: { env: {}, writeFile: (path) => written.push(path) } });

    await runImplement(deps);

    expect(written).toEqual(["a/b.ts"]);
  });

  it("still builds the ticket when the receipt cannot be written", async () => {
    const { deps } = arrange({
      deps: {
        env: { [ANSWER_PATH_ENV]: RECEIPT },
        writeFile: (path) => { if (path === RECEIPT) throw new Error("read-only filesystem"); },
      },
    });

    expect(await runImplement(deps)).toEqual({ outcome: "opened", pr: PR_URL });
  });
});

describe("findFailingTestFiles finds the slice's test.fails( tests without running anything", () => {
  const SLICE_TEST = ['// The gate is a constant', 'test.fails("#360: the gate is a constant", () => {', "  expect(1).toBe(2);", "});"].join("\n");

  function checkoutWith(files: Array<[string, string]>): { root: string; readFile: (path: string) => string } {
    const root = scratchDir("implement-slice");
    for (const [path, source] of files) {
      mkdirSync(join(root, ".Workflow", "x"), { recursive: true });
      writeFileSync(join(root, ".Workflow", path), source);
    }
    return { root, readFile: (path) => readFileSync(join(root, path), "utf8") };
  }

  it("returns the file carrying a test.fails( line naming the ticket, repo-relative with its content, and skips files without one", () => {
    const { root, readFile } = checkoutWith([
      ["x/gate.test.ts", SLICE_TEST],
      ["x/other.test.ts", 'it("#360 is mentioned here, but this test is on already", () => {});'],
      ["x/quoting.test.ts", "const sample = '-  test.fails(\"#360: quoted in a diff sample\", () => {';"],
    ]);

    expect(findFailingTestFiles(360, readFile, root)).toEqual([{ path: ".Workflow/x/gate.test.ts", content: SLICE_TEST }]);
  });

  it("matches the ticket number on a word boundary, so #36 does not select #360's test", () => {
    const { root, readFile } = checkoutWith([["x/gate.test.ts", SLICE_TEST]]);

    expect(findFailingTestFiles(36, readFile, root)).toEqual([]);
    expect(findFailingTestFiles(3600, readFile, root)).toEqual([]);
  });

  it("accepts it.fails( as the same marker, and a checkout with no suite tree as no tests", () => {
    const { root, readFile } = checkoutWith([["x/gate.test.ts", 'it.fails("#42: the other marker", () => {});']]);

    expect(findFailingTestFiles(42, readFile, root)).toHaveLength(1);
    expect(findFailingTestFiles(42, readFile, scratchDir("implement-empty")), "an unauthored slice is not an error").toEqual([]);
  });
});
