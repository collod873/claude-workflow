import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkoutReporting,
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
import { GIT_REFS_PATH } from "../shared/gh-paths";
import { implementationBranch } from "../shared/ready-set";
import { scratchDir } from "../shared/scratch.fixture";
import { createFakeStage } from "../shared/stage.fake";
import { extractFilesClaimed, parentPrdNumber } from "../shared/ticket-shape";
import {
  ANSWER_PATH_ENV,
  assembleBrief,
  CLAIM_TIMEOUT_MINUTES,
  extractSeamsConsumed,
  findFailingTestFiles,
  moduleContextPath,
  runImplement,
  staleClaimTakeoverNote,
  VERIFY_DISPATCH_EVENT_TYPE,
  type BriefInputs,
  type ImplementDeps,
} from "./implement";

/**
 * Lane 05's own half: the brief it assembles, the order it spends in (claim, then ticket, then
 * model), and what it does with the answer before handing it to `landAnswer`. The landing half —
 * how a claim is assessed and taken over, the commit-rebase-push, the no-op — is
 * `shared/implementation-landing.test.ts`, because `recover/recover.ts` runs that same code.
 */

const ISSUE = 167;
const BRANCH = implementationBranch(ISSUE);
const BUILDS = { files: [{ path: "a/b.ts", content: "export const x = 1;" }], summary: "Built the thing." };

/**
 * The ordinary run, on fakes: one claimed file, an implementer that writes it, a `git status` that
 * says it changed, and nothing refusing anything. `github` and `extra` are whatever the case under
 * test is actually about — every other field is scenery.
 */
function arrange(github: ClaimHostOptions = {}, extra: Partial<ImplementDeps> = {}) {
  const host = githubHoldingClaims(github);
  const checkout = checkoutReporting();
  const stage = createFakeStage(JSON.stringify(BUILDS));
  const log: string[] = [];
  const deps: ImplementDeps = {
    gh: host.gh,
    exec: stage.exec,
    git: checkout.git,
    readFile: () => "# CONTEXT\n",
    fileExists: () => false,
    writeFile: () => {},
    issueNumber: ISSUE,
    failingTests: () => [],
    log: (line) => log.push(line),
    now: NOW,
    ...extra,
  };
  return { deps, host, stage, log, gitCalls: checkout.calls };
}

describe("assembleBrief", () => {
  it("contains only the ticket body, seam manifest lines, module CONTEXT.md, and acceptance test file(s), and nothing else", () => {
    const inputs: BriefInputs = {
      ticketBody: "## What to build\nDo the thing.",
      seamManifestLines: ["Line one seam.", "Line two seam."],
      moduleContext: "# Module\n\nSome vocabulary.",
      failingTests: [{ path: "foo.test.ts", content: "describe('foo', () => {});" }],
    };

    // Built independently of assembleBrief's own implementation, from exactly the same four
    // ingredients — an exact-equality check is what proves the function added nothing a fifth
    // ingredient would have supplied.
    const expected = [
      "## Ticket",
      inputs.ticketBody,
      "## Seam manifest lines consumed",
      "Line one seam.\nLine two seam.",
      "## Module CONTEXT.md",
      inputs.moduleContext,
      "## Acceptance test(s) to turn on",
      "### foo.test.ts\n\ndescribe('foo', () => {});",
    ].join("\n\n");

    expect(assembleBrief(inputs)).toBe(expected);
  });

  it("carries every acceptance test file, not only the first", () => {
    const brief = assembleBrief({
      ticketBody: "body",
      seamManifestLines: [],
      moduleContext: "ctx",
      failingTests: [
        { path: "a.test.ts", content: "content A" },
        { path: "b.test.ts", content: "content B" },
      ],
    });

    expect(brief).toContain("content A");
    expect(brief).toContain("content B");
  });

  it("renders a placeholder rather than fabricating a fifth ingredient when seams or tests are empty", () => {
    const brief = assembleBrief({ ticketBody: "body", seamManifestLines: [], moduleContext: "ctx", failingTests: [] });

    expect(brief).toBe(
      ["## Ticket", "body", "## Seam manifest lines consumed", "(none)", "## Module CONTEXT.md", "ctx", "## Acceptance test(s) to turn on", "(none)"].join(
        "\n\n",
      ),
    );
  });
});

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
  it("writes the answer, opens exactly one PR, then sends exactly one dispatch naming it, the files and the criteria", async () => {
    const ticket = {
      title: "Do the thing",
      body: ["## Acceptance criteria", "- [ ] The thing is done", "", "## Files claimed", "- a/b.ts", "", "## Seams consumed", "", "a seam"].join("\n"),
    };
    const written = new Map<string, string>();
    const { deps, host } = arrange({ ticket }, { writeFile: (path, content) => written.set(path, content) });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(written.get("a/b.ts")).toBe("export const x = 1;");
    expect(prCreatesIn(host.calls)).toHaveLength(1);

    // The other two fields trunk's `verify.yml` reads. Sending only `pr` left the Immutability
    // job refusing every PR on an empty changed-files input and the acceptance job finding no test
    // to run (#145's seam audit).
    expect(host.dispatches).toEqual([
      { eventType: VERIFY_DISPATCH_EVENT_TYPE, payload: { pr: PR_URL, changed_files: "a/b.ts", criteria: "The thing is done" } },
    ]);
    const dispatch = host.calls.find((call) => call[1] === "repos/{owner}/{repo}/dispatches");
    expect(dispatch).toContain("client_payload[criteria][]=The thing is done");

    // The PR opens before the dispatch that names it — not merely "both happened".
    expect(host.calls.indexOf(prCreatesIn(host.calls)[0])).toBeLessThan(host.calls.indexOf(dispatch!));
  });

  it("hands the implementer stage a brief carrying the ticket body and the acceptance test content", async () => {
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const { deps, stage } = arrange({ ticket }, { failingTests: () => [{ path: "foo.test.ts", content: "the test.fails( assertion" }] });

    await runImplement(deps);

    expect(stage.stdins[0]).toContain(ticket.body);
    expect(stage.stdins[0]).toContain("the test.fails( assertion");
  });

  /**
   * #334: the window Class 3 of the research note calls "exposed, worst case" — job-start checkout,
   * a 45-minute model run, then a push with no fetch or rebase between them. This lane is the one
   * caller of `landAnswer` that opts in; what a conflict does is that module's own test.
   */
  it("fetches trunk and rebases onto it between the commit and the push", async () => {
    const { deps, gitCalls } = arrange();

    await runImplement(deps);

    const order = gitCalls.map((call) => call[0]);
    expect(order.indexOf("commit")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("fetch")).toBeGreaterThan(order.indexOf("commit"));
    expect(order.indexOf("rebase")).toBeGreaterThan(order.indexOf("fetch"));
    expect(order.indexOf("push")).toBeGreaterThan(order.indexOf("rebase"));
    expect(gitCalls[order.indexOf("fetch")]).toEqual(["fetch", "origin", "main"]);
    expect(gitCalls[order.indexOf("rebase")]).toEqual(["rebase", "origin/main"]);
  });
});

/**
 * The claim that makes at-least-once dispatch free (#179): the reconciler is deliberately dumb
 * about what it has already sent, which is only affordable if a duplicate costs nothing — and it
 * costs nothing only if the ref is created **before** the model runs.
 */
describe("runImplement claims its branch before it spends anything", () => {
  it("creates the ref at HEAD as its very first call, and only then runs the model", async () => {
    const { deps, host, stage } = arrange();

    await runImplement(deps);

    expect(host.calls[0]).toEqual(["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${BRANCH}`, "-f", `sha=${HEAD_SHA}`]);
    expect(stage.stdins).toHaveLength(1);
  });

  // ADR-0115 / #279: a dispatch can name a ticket that already merged and closed, and the model
  // run it used to buy exited green — the stall was invisible.
  it("refuses a closed ticket before the model: no stage call, claim released, said out loud", async () => {
    const { deps, host, stage } = arrange({ ticket: { title: "already merged", body: "", state: "CLOSED" } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "ticket-closed" });
    expect(stage.stdins, "the refusal fires before any model spend").toHaveLength(0);
    expect(host.refs.size, "the claim does not outlive the refusal").toBe(0);
    expect(prCreatesIn(host.calls)).toEqual([]);
  });

  /**
   * The thunk is #179's guarantee pinned where it broke: `main` builds `ImplementDeps` as the
   * *argument* to `runImplement`, so an eagerly-resolved `failingTests` ran before the claim was
   * attempted — seventeen minutes of acceptance suite on 2026-09-02, long enough for the
   * reconciler to read a running implementer as unstarted and dispatch a second one against #342.
   */
  it("exits already-claimed without the model, the PR, the dispatch or the acceptance tests", async () => {
    let resolved = 0;
    const { deps, host, stage, log } = arrange(
      { existingClaim: { branch: BRANCH, createdAt: minutesAgo(2) } },
      { failingTests: () => { resolved += 1; return []; } },
    );

    const result = await runImplement(deps);

    expect(result, "a duplicate ticket-ready is an ordinary event, not a failure").toEqual({ outcome: "already-claimed" });
    expect(stage.stdins).toHaveLength(0);
    expect(prCreatesIn(host.calls)).toEqual([]);
    expect(host.dispatches).toEqual([]);
    expect(resolved, "the acceptance tests were read for a run that had nothing to do").toBe(0);
    expect(log.join("\n")).toContain(BRANCH);
  });

  it("asks GitHub only whether the refused claim is still held, and changes nothing", async () => {
    const { deps, host } = arrange({ existingClaim: { branch: BRANCH, createdAt: minutesAgo(2) } });

    await runImplement(deps);

    // The question is the repair (#196). No ticket read, no comment, and the claim it hit still
    // standing where it was.
    expect(host.calls.some((call) => call[0] === "issue")).toBe(false);
    expect(refDeletesIn(host.calls)).toEqual([]);
    expect(host.refs).toEqual(new Set([BRANCH]));
  });
});

/**
 * A claim a dead run left behind is not a claim (#196). Twice in one evening a run died after
 * claiming and before opening its pull request, and every retry read `HTTP 422`, logged "already
 * claimed" and exited 0 — the ticket was unbuildable until somebody deleted the branch by hand.
 */
describe("a claim does not outlive the run that made it", () => {
  it("releases the claim when the run fails before opening a pull request", async () => {
    const { deps, host } = arrange({ prCreate: new Error("GraphQL: GitHub Actions is not permitted to create pull requests") });

    await expect(runImplement(deps)).rejects.toThrow(/not permitted to create pull requests/);

    // Not "a delete happened" — the ref this run created is gone, which decides whether the next
    // `ticket-ready` for this ticket builds or exits 0 having done nothing.
    expect(host.refs.has(BRANCH), "the claim this run made outlived it").toBe(false);
    expect(refDeletesIn(host.calls)).toHaveLength(1);
  });

  it("leaves the claim alone when the failure came after a pull request was already open", async () => {
    // The dispatch is the step after `pr create`, and a branch with a PR on it is finished work —
    // deleting it would take the run's own pull request down with it.
    const { deps, host } = arrange({
      existingClaim: { branch: BRANCH, pullRequests: 1 },
      answer: (args) => {
        if (args[1] === "repos/{owner}/{repo}/dispatches") throw new Error("HTTP 503");
        return undefined;
      },
    });
    host.refs.delete(BRANCH);

    await expect(runImplement(deps)).rejects.toThrow(/503/);

    expect(host.refs.has(BRANCH)).toBe(true);
    expect(refDeletesIn(host.calls)).toEqual([]);
  });

  it("takes over a stale claim, builds the ticket, and says so on the ticket", async () => {
    const { deps, host, stage } = arrange({ existingClaim: { branch: BRANCH, createdAt: minutesAgo(CLAIM_TIMEOUT_MINUTES + 1) } });

    const result = await runImplement(deps);

    expect(result).toEqual({ outcome: "opened", pr: PR_URL });
    expect(stage.stdins, "the implementer ran this time").toHaveLength(1);
    // A retry that succeeded and a retry that was refused both look like a green run to anybody
    // reading the tracker. This comment is the only thing that tells them apart.
    expect(ticketCommentsIn(host.calls)).toEqual([staleClaimTakeoverNote(BRANCH)]);
  });
});

/**
 * ADR-0103. A lane 05 answer exists in the model's reply and nowhere else — the runner log elides
 * the payload, and a run that opens no pull request commits nothing — so the only copy that can
 * survive a run is one written before the run decides anything about it.
 */
describe("the implementer's answer, kept", () => {
  const RECEIPT = "/tmp/answer.json";

  it("writes the whole answer where the workflow can upload it, even on the run that builds nothing", async () => {
    const written: Record<string, string> = {};
    const { deps } = arrange({}, {
      git: checkoutReporting(() => "").git,
      env: { [ANSWER_PATH_ENV]: RECEIPT },
      writeFile: (path, content) => { written[path] = content; },
    });

    await runImplement(deps);

    // The no-op path: nothing committed, no PR. The receipt is the only thing this run leaves
    // behind, which is the case it exists for.
    expect(JSON.parse(written[RECEIPT])).toMatchObject(BUILDS);
  });

  it("writes nothing extra on a workstation run, which sets no path", async () => {
    const written: string[] = [];
    const { deps } = arrange({}, { env: {}, writeFile: (path) => written.push(path) });

    await runImplement(deps);

    expect(written).toEqual(["a/b.ts"]);
  });

  it("still builds the ticket when the receipt cannot be written", async () => {
    const { deps } = arrange({}, {
      env: { [ANSWER_PATH_ENV]: RECEIPT },
      writeFile: (path) => { if (path === RECEIPT) throw new Error("read-only filesystem"); },
    });

    expect(await runImplement(deps)).toEqual({ outcome: "opened", pr: PR_URL });
  });
});

/**
 * Scoped to the slice (#167) and read, never run (#360): an unscoped run handed every implementer
 * 19 failing files, 10 of them nobody's, and spent ~26 minutes of a 45-minute job doing it. A
 * slice's test now lands green, marked `test.fails(` and naming its ticket, so the brief is a grep
 * over the suite's own trees for that marker.
 */
describe("findFailingTestFiles finds the slice's test.fails( tests without running anything", () => {
  const SLICE_TEST = ['// The gate is a constant', 'test.fails("#360: the gate is a constant", () => {', "  expect(1).toBe(2);", "});"].join("\n");

  /** A checkout whose `.Workflow` tree holds the given test files, each `[relative path, source]`. */
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
