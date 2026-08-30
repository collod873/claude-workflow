import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { GIT_REFS_PATH } from "../shared/gh-paths";
import type { GitExec } from "../shared/git";
import { readWorkflow } from "../shared/read-workflow";
import { implementationBranch } from "../shared/ready-set";
import { createFakeStage } from "../shared/stage.fake";
import { extractFilesClaimed, parentPrdNumber } from "../shared/ticket-shape";
import {
  ANSWER_PATH_ENV,
  assembleBrief,
  CLAIM_TIMEOUT_MINUTES,
  extractSeamsConsumed,
  IMPLEMENT_DISPATCH_EVENT_TYPE,
  moduleContextPath,
  nothingToBuildNote,
  runImplement,
  staleClaimTakeoverNote,
  VERIFY_DISPATCH_EVENT_TYPE,
  type BriefInputs,
  type ImplementDeps,
} from "./implement";
import { GENERATED_ARTIFACTS } from "./regenerate-artifacts";

describe("assembleBrief", () => {
  it("contains only the ticket body, seam manifest lines, module CONTEXT.md, and failing test file(s), and nothing else", () => {
    const inputs: BriefInputs = {
      ticketBody: "## What to build\nDo the thing.",
      seamManifestLines: ["Line one seam.", "Line two seam."],
      moduleContext: "# Module\n\nSome vocabulary.",
      failingTests: [{ path: "tests/acceptance/foo.test.ts", content: "describe('foo', () => {});" }],
    };

    const brief = assembleBrief(inputs);

    // Built independently of assembleBrief's own implementation, from exactly the same four
    // ingredients — an exact-equality check against this is what proves the function added
    // nothing a fifth ingredient would have supplied.
    const expected = [
      "## Ticket",
      inputs.ticketBody,
      "## Seam manifest lines consumed",
      "Line one seam.\nLine two seam.",
      "## Module CONTEXT.md",
      inputs.moduleContext,
      "## Failing acceptance test(s)",
      "### tests/acceptance/foo.test.ts\n\ndescribe('foo', () => {});",
    ].join("\n\n");

    expect(brief).toBe(expected);
  });

  it("carries every failing test file, not only the first", () => {
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
      ["## Ticket", "body", "## Seam manifest lines consumed", "(none)", "## Module CONTEXT.md", "ctx", "## Failing acceptance test(s)", "(none)"].join(
        "\n\n",
      ),
    );
  });
});

describe("extractSeamsConsumed", () => {
  it("reads the lines render-body.ts writes under '## Seams consumed'", () => {
    const body = [
      "## Files claimed",
      "- foo.ts",
      "",
      "## Seams consumed",
      "",
      "First seam line.",
      "Second seam line.",
      "",
    ].join("\n");

    expect(extractSeamsConsumed(body)).toEqual(["First seam line.", "Second seam line."]);
  });

  it("is empty when the ticket consumed no seam (the heading is absent)", () => {
    expect(extractSeamsConsumed("## Files claimed\n- foo.ts\n")).toEqual([]);
  });
});

describe("extractFilesClaimed", () => {
  it("reads the paths render-body.ts writes under '## Files claimed'", () => {
    const body = ["## Files claimed", "- a/b.ts", "- a/b.test.ts", "", "## Seams consumed", "", "a seam"].join("\n");

    expect(extractFilesClaimed(body)).toEqual(["a/b.ts", "a/b.test.ts"]);
  });

  it("treats render-body.ts's 'None — no files.' sentinel as no files, never as a path", () => {
    expect(extractFilesClaimed("## Files claimed\n- None — no files.\n")).toEqual([]);
  });
});

describe("moduleContextPath", () => {
  it("walks up from the first claimed file to the nearest CONTEXT.md", () => {
    const existing = new Set(["a/b/CONTEXT.md"]);
    const fileExists = (path: string) => existing.has(path);

    expect(moduleContextPath(["a/b/c.ts", "a/b/c.test.ts"], fileExists)).toBe("a/b/CONTEXT.md");
  });

  it("falls back to the repo root's CONTEXT.md when no closer one exists", () => {
    expect(moduleContextPath(["a/b/c.ts"], () => false)).toBe("CONTEXT.md");
  });

  it("falls back to the repo root's CONTEXT.md when the ticket claims no files", () => {
    expect(moduleContextPath([], () => false)).toBe("CONTEXT.md");
  });
});

describe("parentPrdNumber", () => {
  it("reads the number render-body.ts writes under '## Parent PRD'", () => {
    expect(parentPrdNumber("## Parent PRD\n#145\n\n## What to build\n…")).toBe(145);
  });

  it("is undefined when the body carries no parent PRD heading", () => {
    expect(parentPrdNumber("## What to build\n…")).toBeUndefined();
  });
});

/**
 * A fake GitHub, small enough to read and stateful enough to answer a claim honestly: it holds the
 * set of refs that exist, so `POST git/refs` 422s on a ref already there and succeeds once that ref
 * is deleted — which is the whole of the claim primitive, and the only way a takeover test can be
 * about anything (#196).
 *
 * `existingClaim` pre-creates this ticket's branch and says what GitHub would report about it: how
 * many pull requests have named it, how many commits it carries, and when it was created. Those
 * three are exactly what `assessClaim` reads to tell a run that is still going from one that died.
 */
interface ExistingClaim {
  pullRequests?: number;
  commitsAhead?: number;
  /** ISO timestamp of the branch's creation, or `null` for a branch GitHub records no creation for. */
  createdAt?: string | null;
}

function fakeGh(
  ticket: { title: string; body: string },
  options: { existingClaim?: ExistingClaim; branch?: string; prCreateFails?: boolean } = {},
): { gh: GhExec; calls: string[][]; refs: Set<string> } {
  const calls: string[][] = [];
  const refs = new Set<string>();
  const claim = options.existingClaim;
  if (claim) refs.add(options.branch ?? implementationBranch(167));

  const gh: GhExec = (args) => {
    calls.push([...args]);
    if (args[0] === "api" && args[1] === GIT_REFS_PATH) {
      const ref = (args.find((arg) => arg.startsWith("ref=refs/heads/")) ?? "").slice("ref=refs/heads/".length);
      if (refs.has(ref)) throw new Error("HTTP 422: Reference already exists");
      refs.add(ref);
      return "";
    }
    if (args[0] === "api" && args[1] === "--method" && args[2] === "DELETE") {
      refs.delete(args[3].slice(`${GIT_REFS_PATH}/heads/`.length));
      return "";
    }
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify(Array.from({ length: claim?.pullRequests ?? 0 }, (_, index) => ({ number: index + 1 })));
    }
    if (args[0] === "api" && args[1].includes("/compare/")) {
      return JSON.stringify({ ahead_by: claim?.commitsAhead ?? 0 });
    }
    if (args[0] === "api" && args[1].includes("/activity?")) {
      const createdAt = claim?.createdAt === undefined ? NOW.toISOString() : claim.createdAt;
      return JSON.stringify(createdAt === null ? [] : [{ timestamp: createdAt }]);
    }
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify(ticket);
    if (args[0] === "issue" && args[1] === "comment") return "";
    if (args[0] === "pr" && args[1] === "create") {
      if (options.prCreateFails) throw new Error("GraphQL: GitHub Actions is not permitted to create pull requests");
      return "https://github.com/owner/repo/pull/42\n";
    }
    if (args[0] === "api") return "";
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };
  return { gh, calls, refs };
}

/** When every run in this file starts. A claim's age is measured against it. */
const NOW = new Date("2026-08-28T22:00:00Z");

/** `minutes` before `NOW`, as GitHub would stamp a branch creation. */
const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

/** Every ref delete in a recorded call list — how a claim is released. */
const refDeletesIn = (calls: string[][]): string[][] =>
  calls.filter((call) => call[0] === "api" && call[1] === "--method" && call[2] === "DELETE");

/** Every comment posted on a ticket. */
const ticketCommentsIn = (calls: string[][]): string[] =>
  calls.filter((call) => call[0] === "issue" && call[1] === "comment").map((call) => call[call.indexOf("--body") + 1]);

/** A fake `GitExec` that records every call and answers a fixed HEAD for `rev-parse`. */
/**
 * `status` scripts what `git status --porcelain -- <paths>` reports, which is how the lane decides
 * whether its implementer built anything. The default says every path it asks about is modified —
 * the ordinary run, where the implementer did the work — so only a test about the no-op has to say
 * otherwise.
 */
function fakeGit(status: (paths: string[]) => string = (paths) => paths.map((path) => ` M ${path}`).join("\n")): {
  git: GitExec;
  calls: string[][];
} {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    if (args[0] === "rev-parse") return `${HEAD_SHA}\n`;
    if (args[0] === "status") return status(args.slice(args.indexOf("--") + 1));
    return "";
  };
  return { git, calls };
}

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

/** Every `repository_dispatch` in a recorded call list — the ref claim is an `api` call too now. */
const dispatchesIn = (calls: string[][]): string[][] =>
  calls.filter((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");

/**
 * The ordinary run, on fakes: one claimed file, an implementer that writes it, a `git status` that
 * says it changed, and nothing refusing anything. `extra` is whatever the case under test is
 * actually about — every other field is scenery, and repeating the scenery per case is what the
 * clone gate reads as a copy.
 */
function ordinaryRun(extra: Partial<ImplementDeps> = {}): {
  deps: ImplementDeps;
  ticket: { title: string; body: string };
  stage: ReturnType<typeof createFakeStage>;
  ghCalls: string[][];
  gitCalls: string[][];
} {
  const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
  const { gh, calls: ghCalls } = fakeGh(ticket);
  const { git, calls: gitCalls } = fakeGit();
  const stage = createFakeStage(
    JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }),
  );

  return {
    ticket,
    stage,
    ghCalls,
    gitCalls,
    deps: {
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
      ...extra,
    },
  };
}

describe("runImplement — on fakes", () => {
  it("opens exactly one PR, then sends exactly one repository_dispatch naming that PR", async () => {
    const ticket = {
      title: "Do the thing",
      body: [
        "## Acceptance criteria",
        "- [ ] The thing is done",
        "",
        "## Files claimed",
        "- a/b.ts",
        "",
        "## Seams consumed",
        "",
        "a seam",
      ].join("\n"),
    };
    const { gh, calls } = fakeGh(ticket);
    const { git } = fakeGit();
    const stage = createFakeStage(
      JSON.stringify({ files: [{ path: "a/b.ts", content: "export const x = 1;" }], summary: "Built the thing." }),
    );
    const written = new Map<string, string>();

    const result = await runImplement({
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: (path, content) => written.set(path, content),
      issueNumber: 167,
      failingTests: [{ path: "tests/acceptance/foo.test.ts", content: "…" }],
    });

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
    expect(written.get("a/b.ts")).toBe("export const x = 1;");

    const prCreateCalls = calls.filter((call) => call[0] === "pr" && call[1] === "create");
    expect(prCreateCalls).toHaveLength(1);

    const dispatchCalls = dispatchesIn(calls);
    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]).toContain(`event_type=${VERIFY_DISPATCH_EVENT_TYPE}`);
    expect(dispatchCalls[0]).toContain("client_payload[pr]=https://github.com/owner/repo/pull/42");

    // The other two fields trunk's `verify.yml` reads. Sending only `pr` is what left the
    // Immutability job refusing every PR on an empty changed-files input and the acceptance job
    // finding no test to run, even once the action names were reconciled (#145's seam audit).
    expect(dispatchCalls[0]).toContain("client_payload[changed_files]=a/b.ts");
    expect(dispatchCalls[0]).toContain("client_payload[criteria][]=The thing is done");

    // The PR opens before the dispatch that names it — not merely "both happened".
    const prIndex = calls.indexOf(prCreateCalls[0]);
    const dispatchIndex = calls.indexOf(dispatchCalls[0]);
    expect(prIndex).toBeLessThan(dispatchIndex);
  });

  it("hands the implementer stage a brief carrying the ticket body and the failing test content", async () => {
    const run = ordinaryRun({
      failingTests: [{ path: "tests/acceptance/foo.test.ts", content: "the failing assertion" }],
    });

    await runImplement(run.deps);

    const prompt = run.stage.stdins[0] ?? "";
    expect(prompt).toContain(run.ticket.body);
    expect(prompt).toContain("the failing assertion");
  });

  /**
   * The gate the implementer's work actually has to survive is the one on the **push**, not the
   * ones it thinks to run. Run 33282084838 built #238 correctly in 72 turns and $4.00 with a clean
   * `tsc`, a clean `eslint` and 45 passing tests, then lost all of it to a `pre-push` clone-gate
   * finding it had never been told existed — the money is spent by the time that gate speaks.
   *
   * Pinned against `package.json`'s own script name rather than a copy of it, so renaming the
   * script fails here instead of leaving the prompt naming a command that no longer exists.
   */
  it("tells the implementer to run the same gate the push will run", () => {
    const npmScripts = JSON.parse(
      readFileSync(fileURLToPath(new URL("../../../package.json", import.meta.url)), "utf8"),
    ) as { scripts: Record<string, string> };
    const prompt = readFileSync(
      fileURLToPath(new URL("./implementer/prompt.md", import.meta.url)),
      "utf8",
    );

    expect(npmScripts.scripts).toHaveProperty("check");
    expect(prompt).toContain("npm run check");
  });

  /** The other half of ADR-0107 — `regenerate-artifacts.ts`'s docstring is the home for why. */
  it("regenerates the generated artifacts and commits them alongside the implementer's files", async () => {
    const regenerated: string[] = [];
    const run = ordinaryRun({
      repoRoot: "/repo",
      runGenerator: (generator, root) => {
        regenerated.push(`${generator} ${root}`);
        return { exitCode: 0, output: "" };
      },
    });

    await runImplement(run.deps);

    expect(regenerated).toEqual(GENERATED_ARTIFACTS.map((artifact) => `${artifact.generator} /repo`));

    const addCall = run.gitCalls.find((call) => call[0] === "add") ?? [];
    expect(addCall).toContain("a/b.ts");
    for (const artifact of GENERATED_ARTIFACTS) {
      expect(addCall).toContain(artifact.path);
    }
  });

  it("still opens its PR when a generator fails, because a stale artifact is the push gate's to name", async () => {
    const logged: string[] = [];
    const run = ordinaryRun({
      log: (line) => logged.push(line),
      runGenerator: () => ({ exitCode: 1, output: "generator exploded" }),
    });

    const result = await runImplement(run.deps);

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
    expect(logged.join("\n")).toContain("generator exploded");
  });

  /**
   * The generators and the push-venue checks that diff them are spelled in two languages, and no
   * compiler sees across that boundary. A generator renamed in `bin/gauntlet` and not here leaves
   * lane 05 refreshing a file nothing checks, which reads exactly like working.
   */
  it("regenerates exactly what bin/gauntlet's push venue diffs", () => {
    const gauntlet = readFileSync(fileURLToPath(new URL("../../../bin/gauntlet", import.meta.url)), "utf8");

    for (const artifact of GENERATED_ARTIFACTS) {
      expect(gauntlet, `bin/gauntlet does not diff ${artifact.path}`).toContain(artifact.path);
      expect(gauntlet, `bin/gauntlet does not run ${artifact.generator}`).toContain(artifact.generator);
    }
  });

  /**
   * The wiring baseline is the one `regenerate && diff` artifact lane 05 must never refresh: it
   * grandfathers standing debt and only ever shrinks, so regenerating it would swallow exactly the
   * finding the gate exists to raise (ADR-0086, and `CLAUDE.md`'s own instruction to drop entries
   * rather than add them).
   */
  it("leaves the wiring baseline alone", () => {
    expect(GENERATED_ARTIFACTS.map((artifact) => artifact.path)).not.toContain(
      ".Workflow/agent-workflows/shared/wiring-baseline.json",
    );
  });

  /**
   * The second legal widening (the first being the generated files above, which the implementer is
   * told not to touch at all): a test its own change turned red. Both limits on it are load-bearing
   * — an implementer that edits the acceptance tests is editing the spec it is being judged against.
   */
  it("tells the implementer it may fix a test its change broke, but never the acceptance tests", () => {
    const prompt = readFileSync(fileURLToPath(new URL("./implementer/prompt.md", import.meta.url)), "utf8");

    expect(prompt).toContain("tests/acceptance/");
    expect(prompt).toMatch(/never the assertion/i);
    expect(prompt).toMatch(/name every such file in your summary/i);
  });
});

/**
 * The claim that makes at-least-once dispatch free (#179).
 *
 * The reconciler recomputes the ready set on every `graph-changed` and every `session-captured` and
 * is deliberately dumb about what it has already sent, which is only affordable because a duplicate
 * costs nothing. It costs nothing only if the ref is created **before** the model runs — the old
 * order pushed at the end, so two implementers both did the whole job and only the push collided.
 */
describe("runImplement claims its branch before it spends anything", () => {
  const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };

  function deps(gh: GhExec, git: GitExec, stage: ReturnType<typeof createFakeStage>, log: string[]) {
    return {
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
      log: (line: string) => log.push(line),
      now: NOW,
    };
  }

  it("creates the ref at HEAD before running the model", async () => {
    const { gh, calls } = fakeGh(ticket);
    const { git } = fakeGit();
    const stage = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }));

    await runImplement(deps(gh, git, stage, []));

    const claim = calls.find((call) => call[0] === "api" && call[1] === GIT_REFS_PATH);
    expect(claim).toEqual([
      "api",
      GIT_REFS_PATH,
      "-f",
      `ref=refs/heads/${implementationBranch(167)}`,
      "-f",
      `sha=${HEAD_SHA}`,
    ]);

    // Before the model, not merely both — the whole point of moving it.
    expect(calls.indexOf(claim!)).toBe(0);
    expect(stage.stdins).toHaveLength(1);
  });

  it("exits without running the model or opening a PR when the ref is already there", async () => {
    const { gh, calls } = fakeGh(ticket, { existingClaim: { createdAt: minutesAgo(2) } });
    const { git } = fakeGit();
    const stage = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }));
    const log: string[] = [];

    const result = await runImplement(deps(gh, git, stage, log));

    expect(result, "a duplicate ticket-ready is an ordinary event, not a failure").toEqual({
      outcome: "already-claimed",
    });
    expect(stage.stdins, "no model ran").toHaveLength(0);
    expect(calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);
    expect(dispatchesIn(calls)).toEqual([]);
    expect(log.join("\n")).toContain(implementationBranch(167));
  });

  it("reads nothing and writes nothing else once the claim is refused", async () => {
    const { gh, calls, refs } = fakeGh(ticket, { existingClaim: { createdAt: minutesAgo(2) } });
    const { git } = fakeGit();
    const stage = createFakeStage("{}");

    await runImplement(deps(gh, git, stage, []));

    // The refusal is allowed to *ask* GitHub whether the claim it hit is still held — that question
    // is the repair (#196). What it is not allowed to do is spend anything or change anything: no
    // ticket read, no context read, no comment, and the claim it found still standing where it was.
    expect(calls.some((call) => call[0] === "issue")).toBe(false);
    expect(calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);
    expect(refDeletesIn(calls)).toEqual([]);
    expect(refs).toEqual(new Set([implementationBranch(167)]));
  });
});

/**
 * A claim a dead run left behind is not a claim (#196).
 *
 * Lane 05's claim primitive is a ref, and a ref outlives the run that made it. Twice in one evening
 * a run died after claiming and before opening its pull request — once on a pre-push hook, once on
 * the repository's *Allow GitHub Actions to create pull requests* setting — and both times every
 * retry read `HTTP 422: Reference already exists`, logged "already claimed", and exited 0 having
 * done nothing. The ticket was unbuildable until somebody ran `git push origin --delete` by hand.
 */
describe("a claim does not outlive the run that made it", () => {
  const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
  const branch = implementationBranch(167);

  function deps(gh: GhExec, git: GitExec, stage: ReturnType<typeof createFakeStage>) {
    return {
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [],
      log: () => {},
      now: NOW,
    };
  }

  const builds = () => createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }));

  it("releases the claim when the run fails before opening a pull request, so the next dispatch can build the ticket", async () => {
    const { gh, calls, refs } = fakeGh(ticket, { prCreateFails: true });
    const { git } = fakeGit();

    await expect(runImplement(deps(gh, git, builds()))).rejects.toThrow(/not permitted to create pull requests/);

    // Not "a delete happened" — the ref this run created is gone, which is the thing that decides
    // whether the next `ticket-ready` for #167 builds or exits 0 having done nothing.
    expect(refs.has(branch), "the claim this run made outlived it").toBe(false);
    expect(refDeletesIn(calls)).toHaveLength(1);
  });

  it("leaves the claim alone when the failure came after a pull request was already open", async () => {
    // The dispatch send is the step after `pr create`, and a branch with a PR standing on it is
    // finished work — deleting it would take the run's own pull request down with it.
    const { gh, calls, refs } = fakeGh(ticket, { existingClaim: { pullRequests: 1 } });
    refs.delete(branch);
    const dispatchFails: GhExec = (args) => {
      const out = gh(args);
      if (args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches") throw new Error("HTTP 503");
      return out;
    };
    const { git } = fakeGit();

    await expect(runImplement(deps(dispatchFails, git, builds()))).rejects.toThrow(/503/);

    expect(refs.has(branch)).toBe(true);
    expect(refDeletesIn(calls)).toEqual([]);
  });

  it("still refuses a claim held by a run that is still going, so two dispatches cannot both build one ticket", async () => {
    // Young, no commits, no pull request — exactly what a healthy run looks like in its first
    // minutes, and the case a naive "delete anything without a PR" release would trample.
    const { gh, calls, refs } = fakeGh(ticket, { existingClaim: { createdAt: minutesAgo(5) } });
    const { git } = fakeGit();
    const stage = builds();

    const result = await runImplement(deps(gh, git, stage));

    expect(result).toEqual({ outcome: "already-claimed" });
    expect(stage.stdins, "no second implementer ran").toHaveLength(0);
    expect(refs.has(branch)).toBe(true);
    expect(refDeletesIn(calls)).toEqual([]);
  });

  // Every case here is a claim old enough to have expired but not clearly abandoned, and every one
  // answers "still held". Refusing a claim that was in fact debris costs one delayed retry; taking
  // one that was in fact held costs two implementers building the same ticket at once.
  const notClearlyDebris: Array<[string, ExistingClaim]> = [
    ["the branch carries commits somebody may still want", { createdAt: minutesAgo(600), commitsAhead: 3 }],
    ["a pull request already stands on the branch", { createdAt: minutesAgo(600), pullRequests: 1 }],
    ["GitHub reports no creation time to age it by", { createdAt: null }],
  ];

  it.each(notClearlyDebris)("refuses a claim it cannot call debris: %s", async (_case, existingClaim) => {
    const { gh, refs } = fakeGh(ticket, { existingClaim });
    const { git } = fakeGit();

    expect(await runImplement(deps(gh, git, builds()))).toEqual({ outcome: "already-claimed" });
    expect(refs.has(branch)).toBe(true);
  });

  it("takes over a claim with no pull request, no commits and no live run, and says so on the ticket", async () => {
    const { gh, calls, refs } = fakeGh(ticket, { existingClaim: { createdAt: minutesAgo(CLAIM_TIMEOUT_MINUTES + 1) } });
    const { git } = fakeGit();
    const stage = builds();

    const result = await runImplement(deps(gh, git, stage));

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
    expect(stage.stdins, "the implementer ran this time").toHaveLength(1);
    expect(refs.has(branch), "the claim is this run's now").toBe(true);

    // Taken atomically, not assumed: the debris is deleted and the ref re-created, so two runs that
    // both find the same debris still race on `POST git/refs` and still only one wins.
    const claimCreates = calls.filter((call) => call[0] === "api" && call[1] === GIT_REFS_PATH);
    expect(claimCreates).toHaveLength(2);
    expect(calls.indexOf(refDeletesIn(calls)[0])).toBeLessThan(calls.indexOf(claimCreates[1]));

    // A retry that succeeded and a retry that was refused both look like a green run to anybody
    // reading the tracker. This comment is the only thing that tells them apart.
    expect(ticketCommentsIn(calls).join("\n")).toContain(branch);
    expect(ticketCommentsIn(calls).join("\n")).toBe(staleClaimTakeoverNote(branch));
  });

  it("does not take over a stale claim it loses the race to re-create", async () => {
    const { gh, refs } = fakeGh(ticket, { existingClaim: { createdAt: minutesAgo(600) } });
    const raced: GhExec = (args) => {
      const out = gh(args);
      // A sibling claimed the freed ref between this run's delete and its create.
      if (args[0] === "api" && args[1] === "--method" && args[2] === "DELETE") refs.add(branch);
      return out;
    };
    const { git } = fakeGit();
    const stage = builds();

    expect(await runImplement(deps(raced, git, stage))).toEqual({ outcome: "already-claimed" });
    expect(stage.stdins).toHaveLength(0);
  });
});

/**
 * ADR-0103. A lane 05 answer exists in the model's reply and nowhere else — the runner log elides
 * the payload, and a run that opens no pull request commits nothing — so the only copy that can
 * survive a run is one written before the run decides anything about it.
 */
describe("the implementer's answer, kept", () => {
  const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
  const ANSWER = { files: [{ path: "a/b.ts", content: "export const x = 1;\n" }], summary: "Built it." };

  async function runWith(env: Record<string, string | undefined>, writeFile: (path: string, content: string) => void) {
    const { gh } = fakeGh(ticket);
    const { git } = fakeGit(() => "");
    await runImplement({
      gh,
      exec: createFakeStage(JSON.stringify(ANSWER)).exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile,
      issueNumber: 167,
      failingTests: [],
      log: () => {},
      now: NOW,
      env,
    });
  }

  it("writes the whole answer where the workflow can upload it, even on the run that builds nothing", async () => {
    const written: Record<string, string> = {};
    await runWith({ [ANSWER_PATH_ENV]: "/tmp/answer.json" }, (path, content) => {
      written[path] = content;
    });

    // The no-op path: `git status` said clean, so nothing was committed and no PR was opened. The
    // receipt is the only thing this run leaves behind, which is the case it exists for.
    expect(JSON.parse(written["/tmp/answer.json"])).toMatchObject(ANSWER);
  });

  it("writes nothing extra on a workstation run, which sets no path", async () => {
    const written: string[] = [];
    await runWith({}, (path) => written.push(path));

    expect(written).toEqual(["a/b.ts"]);
  });

  it("still builds the ticket when the receipt cannot be written", async () => {
    const { gh } = fakeGh(ticket);
    const { git } = fakeGit();
    const result = await runImplement({
      gh,
      exec: createFakeStage(JSON.stringify(ANSWER)).exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: (path) => {
        if (path === "/tmp/answer.json") throw new Error("read-only filesystem");
      },
      issueNumber: 167,
      failingTests: [],
      log: () => {},
      now: NOW,
      env: { [ANSWER_PATH_ENV]: "/tmp/answer.json" },
    });

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
  });
});

/**
 * A run that builds nothing is a legitimate outcome, not a crash (#196).
 *
 * Run 33229214201 built #210, the model correctly found the ticket already implemented and returned
 * its files unchanged, and the run died on `git commit -m "Implement #210"` with `nothing to commit,
 * working tree clean` — nonzero exit, no pull request, claim left standing.
 */
describe("a run whose implementer changes nothing", () => {
  const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
  const branch = implementationBranch(167);
  const ALREADY_ON_DISK = "export const x = 1;\n";

  /**
   * `worktreeState` is what `git status --porcelain` reports for `a/b.ts` — the tree as it stands
   * when the implementer is done, whoever put it in that state. The disk always ends up holding
   * exactly what the implementer reported, because that is true of every real run: the stage writes
   * the answer out before anything is decided about it.
   */
  async function runAgainstTree(worktreeState: string) {
    const disk: Record<string, string> = { "a/b.ts": ALREADY_ON_DISK };
    const { gh, calls, refs } = fakeGh(ticket);
    const { git, calls: gitCalls } = fakeGit(() => worktreeState);
    const stage = createFakeStage(
      JSON.stringify({ files: [{ path: "a/b.ts", content: ALREADY_ON_DISK }], summary: "Already implemented." }),
    );

    const result = await runImplement({
      gh,
      exec: stage.exec,
      git,
      readFile: (path) => disk[path] ?? "",
      fileExists: (path) => path in disk,
      writeFile: (path, content) => {
        disk[path] = content;
      },
      issueNumber: 167,
      failingTests: [],
      log: () => {},
      now: NOW,
    });
    return { result, calls, gitCalls, refs };
  }

  it("exits green without a commit, releases its claim, and says on the ticket that it found nothing to build", async () => {
    const { result, calls, gitCalls, refs } = await runAgainstTree("");

    expect(result).toEqual({ outcome: "nothing-to-build" });
    expect(gitCalls.some((call) => call[0] === "commit"), "the commit that died on `nothing to commit`").toBe(false);
    expect(gitCalls.some((call) => call[0] === "push")).toBe(false);
    expect(calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);

    expect(refs.has(branch), "a no-op keeps the ticket unbuildable if it keeps its claim").toBe(false);
    expect(ticketCommentsIn(calls)).toEqual([nothingToBuildNote(167)]);
  });

  /**
   * The regression ADR-0103 is about, and the reason this suite asks git rather than the filesystem.
   *
   * The implementer holds Edit, Write and Bash, and building a ticket is what it does with them — so
   * by the time it reports a file, that file has been on disk for twenty minutes. This is precisely
   * the setup of the no-op above (answer identical to disk, byte for byte) and the opposite outcome,
   * and only `git status` can tell the two apart. Run 33275876786 built #237, was compared against
   * its own edits, agreed with itself, and was discarded as "nothing to build" — 23 minutes and
   * $6.36, unrecoverable.
   */
  it("commits work the implementer did itself, even though its answer matches disk byte for byte", async () => {
    const { result, gitCalls, refs } = await runAgainstTree(" M a/b.ts");

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
    expect(gitCalls.some((call) => call[0] === "commit"), "the work was on disk, so there was a commit to make").toBe(
      true,
    );
    expect(refs.has(branch)).toBe(true);
  });

  it("counts a file the implementer created, which a diff against HEAD alone would not show", async () => {
    const { result } = await runAgainstTree("?? a/b.ts");

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
  });

  it("asks git only about the paths the implementer reported, so a stray edit cannot ride along", async () => {
    const { gitCalls } = await runAgainstTree(" M a/b.ts");

    const status = gitCalls.find((call) => call[0] === "status");
    expect(status).toEqual(["status", "--porcelain", "--", "a/b.ts"]);
  });
});

describe("implement.yml", () => {
  it("gates its dispatch-triggered job on IMPLEMENT_DISPATCH_EVENT_TYPE, with no sender-gate if condition", () => {
    const { workflow } = readWorkflow<{ jobs: Record<string, { if?: string }> }>("implement.yml");
    const jobIf = workflow.jobs.implement.if;

    expect(jobIf).toBe(`github.event.action == '${IMPLEMENT_DISPATCH_EVENT_TYPE}'`);
    expect(jobIf).not.toContain("sender");
    expect(jobIf).not.toContain("author_association");
  });

  it("is triggered by repository_dispatch", () => {
    const { workflow } = readWorkflow<{ on: Record<string, unknown> }>("implement.yml");
    expect(workflow.on).toHaveProperty("repository_dispatch");
  });

  it("times its job out at exactly the age CLAIM_TIMEOUT_MINUTES calls a claim dead", () => {
    // No compiler sees across the JS↔YAML boundary, and this number decides whether a live run's
    // claim can be stolen. A job allowed to run longer than the constant would have its own claim
    // taken out from under it by the next dispatch.
    const { workflow } = readWorkflow<{ jobs: Record<string, { "timeout-minutes"?: number }> }>("implement.yml");
    expect(workflow.jobs.implement["timeout-minutes"]).toBe(CLAIM_TIMEOUT_MINUTES);
  });

  it("keys concurrency on the ticket, so a wave runs as wide as lane 03 cut it", () => {
    // A fixed group here serialises the whole lane, which ADR-0039 rules against — and worse, it
    // drops slices: GitHub keeps at most one *pending* run per group, and a newly queued run
    // cancels whatever was pending, `cancel-in-progress: false` notwithstanding (that setting only
    // ever protected the executing run). A three-wide wave lost its middle ticket to exactly this.
    // ADR-0108 has the ruling. Keyed per ticket, the group's only contender is a re-dispatch of the
    // same ticket, which is the one case where keeping the running one is right.
    const { workflow } = readWorkflow<{
      concurrency?: { group?: string; "cancel-in-progress"?: boolean };
    }>("implement.yml");

    expect(workflow.concurrency?.group).toContain("client_payload.issue");
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });
});
