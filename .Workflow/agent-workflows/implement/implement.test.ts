import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import type { GitExec } from "../shared/git";
import { readWorkflow } from "../shared/read-workflow";
import { createFakeStage } from "../shared/stage.fake";
import {
  assembleBrief,
  extractFilesClaimed,
  extractSeamsConsumed,
  IMPLEMENT_DISPATCH_EVENT_TYPE,
  moduleContextPath,
  parentPrdNumber,
  runImplement,
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

/** A fake `GhExec` that answers a ticket read, a PR create, and a dispatch send — nothing else. */
function fakeGh(ticket: { title: string; body: string }): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify(ticket);
    if (args[0] === "pr" && args[1] === "create") return "https://github.com/owner/repo/pull/42\n";
    if (args[0] === "api") return "";
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };
  return { gh, calls };
}

/** A fake `GitExec` that records every call and answers nothing. */
function fakeGit(): { git: GitExec; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitExec = (args) => {
    calls.push([...args]);
    return "";
  };
  return { git, calls };
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

    const prUrl = await runImplement({
      gh,
      exec: stage.exec,
      git,
      readFile: () => "# CONTEXT\n",
      fileExists: () => false,
      writeFile: (path, content) => written.set(path, content),
      issueNumber: 167,
      failingTests: [{ path: "tests/acceptance/foo.test.ts", content: "…" }],
    });

    expect(prUrl).toBe("https://github.com/owner/repo/pull/42");
    expect(written.get("a/b.ts")).toBe("export const x = 1;");

    const prCreateCalls = calls.filter((call) => call[0] === "pr" && call[1] === "create");
    expect(prCreateCalls).toHaveLength(1);

    const dispatchCalls = calls.filter((call) => call[0] === "api");
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
});
