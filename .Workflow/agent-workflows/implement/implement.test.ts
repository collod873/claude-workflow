import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { GIT_REFS_PATH } from "../shared/gh-paths";
import type { GitExec } from "../shared/git";
import { readWorkflow } from "../shared/read-workflow";
import { implementationBranch } from "../shared/ready-set";
import { createFakeStage } from "../shared/stage.fake";
import { extractFilesClaimed, parentPrdNumber } from "../shared/ticket-shape";
import {
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
} from "./implement";

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
function fakeGit(): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    return args[0] === "rev-parse" ? `${HEAD_SHA}\n` : "";
  };
  return { git, calls };
}

const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";

/** Every `repository_dispatch` in a recorded call list — the ref claim is an `api` call too now. */
const dispatchesIn = (calls: string[][]): string[][] =>
  calls.filter((call) => call[0] === "api" && call[1] === "repos/{owner}/{repo}/dispatches");

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
    const ticket = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };
    const { gh } = fakeGh(ticket);
    const { git } = fakeGit();
    const stage = createFakeStage(JSON.stringify({ files: [{ path: "a/b.ts", content: "x" }], summary: "s" }));

    await runImplement({
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: () => {},
      issueNumber: 167,
      failingTests: [{ path: "tests/acceptance/foo.test.ts", content: "the failing assertion" }],
    });

    const prompt = stage.stdins[0] ?? "";
    expect(prompt).toContain(ticket.body);
    expect(prompt).toContain("the failing assertion");
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

  async function runAgainstDisk(disk: Record<string, string>) {
    const { gh, calls, refs } = fakeGh(ticket);
    const { git, calls: gitCalls } = fakeGit();
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
    const { result, calls, gitCalls, refs } = await runAgainstDisk({ "a/b.ts": ALREADY_ON_DISK });

    expect(result).toEqual({ outcome: "nothing-to-build" });
    expect(gitCalls.some((call) => call[0] === "commit"), "the commit that died on `nothing to commit`").toBe(false);
    expect(gitCalls.some((call) => call[0] === "push")).toBe(false);
    expect(calls.some((call) => call[0] === "pr" && call[1] === "create")).toBe(false);

    expect(refs.has(branch), "a no-op keeps the ticket unbuildable if it keeps its claim").toBe(false);
    expect(ticketCommentsIn(calls)).toEqual([nothingToBuildNote(167)]);
  });

  it("commits as usual when even one of the implementer's files differs from what is on disk", async () => {
    const { result, gitCalls, refs } = await runAgainstDisk({ "a/b.ts": "export const x = 0;\n" });

    expect(result).toEqual({ outcome: "opened", pr: "https://github.com/owner/repo/pull/42" });
    expect(gitCalls.some((call) => call[0] === "commit")).toBe(true);
    expect(refs.has(branch)).toBe(true);
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
});
