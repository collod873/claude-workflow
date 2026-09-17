import { describe, expect, it } from "vitest";
import { deletedPathMentions, renderDrift, retiredCitations, staleStamps, type TextFile } from "./prose-drift";

function adr(number: number, frontmatter: string, body = "Why it binds."): TextFile {
  return {
    path: `docs/adr/${String(number).padStart(4, "0")}-a-ruling.md`,
    content: `---\n${frontmatter}\ndate: 2026-09-16\nreversal: Undoing it costs a rewrite.\n---\n\n# A ruling\n\n${body}\n`,
  };
}

const retiredTen = adr(10, "status: superseded\nsuperseded_by: ADR-0020");
const successorTwenty = adr(20, "status: constraint\nsupersedes: ADR-0010");

describe("retiredCitations", () => {
  it("names a live document's line that cites a retired ADR, and the ADR that rules now", () => {
    const findings = retiredCitations([retiredTen, successorTwenty, { path: "CONTEXT.md", content: "intro\nSee ADR-0010.\n" }]);

    expect(findings).toEqual([{ path: "CONTEXT.md", line: 2, says: "cites ADR-0010, which is retired; the ruling now lives in ADR-0020" }]);
  });

  it("reads a relative link to the retired file as a citation", () => {
    const findings = retiredCitations([retiredTen, successorTwenty, { path: "docs/agents/venues.md", content: "[why](../adr/0010-a-ruling.md)\n" }]);

    expect(findings.map((finding) => finding.line)).toEqual([1]);
  });

  it("counts an ADR as retired the moment a successor declares it, before the back-stamp writes its status", () => {
    const unstamped = adr(10, "status: constraint");
    const findings = retiredCitations([unstamped, successorTwenty, { path: "README.md", content: "ADR-0010\n" }]);

    expect(findings).toHaveLength(1);
  });

  it("follows a chain of successors to the ADR that is live now", () => {
    const middle = adr(20, "status: superseded\nsuperseded_by: ADR-0030\nsupersedes: ADR-0010");
    const head = adr(30, "status: constraint\nsupersedes: ADR-0020");
    const findings = retiredCitations([retiredTen, middle, head, { path: "README.md", content: "ADR-0010\n" }]);

    expect(findings[0].says).toContain("the ruling now lives in ADR-0030");
  });

  it("leaves a citation of a live ADR, another repo's ADR, and anything the ADR corpus, research or tests say", () => {
    const files = [
      retiredTen,
      successorTwenty,
      { path: "CONTEXT.md", content: "ADR-0020 and agent-skills/ADR-0010\n" },
      { path: "docs/research/2026-08-notes.md", content: "ADR-0010\n" },
      { path: ".Workflow/agent-workflows/shared/thing.test.ts", content: "ADR-0010\n" },
      adr(30, "status: constraint", "Rejected: what ADR-0010 ruled."),
    ];

    expect(retiredCitations(files)).toEqual([]);
  });
});

describe("staleStamps", () => {
  it("names a superseded_by pointer whose successor declares no supersedes: for it", () => {
    const findings = staleStamps([retiredTen, adr(20, "status: note")]);

    expect(findings).toEqual([{ path: retiredTen.path, says: "superseded_by names ADR-0020, which declares no supersedes: ADR-0010" }]);
  });

  it("names a superseded status with no pointer at all", () => {
    expect(staleStamps([adr(10, "status: superseded")])).toHaveLength(1);
  });

  it("is quiet when the pointer and the declaration agree", () => {
    expect(staleStamps([retiredTen, successorTwenty])).toEqual([]);
  });
});

describe("deletedPathMentions", () => {
  const gone = [".Workflow/agent-workflows/shared/generate-contract.ts"];

  it("names a live line that spells the deleted path in full, from the agent-workflows root, or by its unique file name", () => {
    const files = [
      { path: "CONTEXT.md", content: "`.Workflow/agent-workflows/shared/generate-contract.ts`\n`shared/generate-contract.ts`\ngenerate-contract.ts\n" },
    ];

    expect(deletedPathMentions(files, gone).map((finding) => finding.line)).toEqual([1, 2, 3]);
  });

  it("leaves a file name that another tracked file still carries", () => {
    const files = [
      { path: "docs/agents/venues.md", content: "the slice prompt.md\n" },
      { path: ".Workflow/agent-workflows/spec/prompt.md", content: "x\n" },
    ];

    expect(deletedPathMentions(files, [".Workflow/agent-workflows/slice/prompt.md"])).toEqual([]);
  });

  it("reads only the reversal line of a live ADR, and nothing of a retired one", () => {
    const live = adr(30, "status: constraint", "Rejected: keeping generate-contract.ts.");
    live.content = live.content.replace("reversal: Undoing it costs a rewrite.", "reversal: Undoing it restores generate-contract.ts.");
    const retired = adr(31, "status: superseded\nsuperseded_by: ADR-0030");
    retired.content = retired.content.replace("reversal: Undoing it costs a rewrite.", "reversal: generate-contract.ts.");

    expect(deletedPathMentions([live, retired], gone).map((finding) => [finding.path, finding.line])).toEqual([[live.path, 4]]);
  });

  it("does not match a longer name that only contains the deleted one", () => {
    expect(deletedPathMentions([{ path: "README.md", content: "generate-contract.ts.bak and old-generate-contract.ts\n" }], gone)).toEqual([]);
  });

  it("does not match the same path moved under another folder, but still matches one led by ./", () => {
    const moved = ["bin/land"];

    expect(deletedPathMentions([{ path: "README.md", content: "run `core/bin/land`\n" }], moved)).toEqual([]);
    expect(deletedPathMentions([{ path: "README.md", content: "run `./bin/land`\n" }], moved)).toHaveLength(1);
  });

  it("finds nothing when the change deleted nothing", () => {
    expect(deletedPathMentions([{ path: "README.md", content: "generate-contract.ts\n" }], [])).toEqual([]);
  });
});

describe("renderDrift", () => {
  it("leads with the count and tells the reader to rewrite rather than repoint", () => {
    const report = renderDrift([{ path: "CONTEXT.md", line: 2, says: "cites ADR-0010, which is retired" }]);

    expect(report.split("\n")[0]).toBe("prose drift: 1 line name something that no longer holds.");
    expect(report).toContain("repointing a restated rule");
    expect(report).toContain("CONTEXT.md:2  cites ADR-0010");
  });
});
