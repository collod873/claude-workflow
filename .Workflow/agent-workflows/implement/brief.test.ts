import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scratchDir } from "../shared/scratch.fixture";
import {
  assembleBrief,
  gatherBriefContext,
  INLINE_BUDGET_BYTES,
  INLINE_FILE_CAP_BYTES,
  listAdrFiles,
  walkSourceFiles,
  type BriefContextDeps,
  type BriefInputs,
} from "./brief";

function fakeDeps(overrides: Partial<BriefContextDeps> = {}): BriefContextDeps {
  return {
    ticketBody: "",
    filesClaimed: [],
    readFile: () => "",
    fileExists: () => false,
    sourceFiles: () => [],
    adrFiles: () => [],
    failingTestPaths: [],
    ...overrides,
  };
}

describe("assembleBrief", () => {
  it("contains the ticket body, seam manifest lines, module CONTEXT.md, acceptance tests, claimed files, citations and nearby paths, and nothing else", () => {
    const inputs: BriefInputs = {
      ticketBody: "## What to build\nDo the thing.",
      seamManifestLines: ["Line one seam.", "Line two seam."],
      moduleContext: "# Module\n\nSome vocabulary.",
      failingTests: [{ path: "foo.test.ts", content: "describe('foo', () => {});" }],
      claimed: [{ path: "a/b.ts", content: "export const x = 1;" }],
      cited: [{ path: "docs/adr/0042-thing.md", content: "# The ruling" }],
      nearby: ["a/b.test.ts"],
    };

    const expected = [
      "## Ticket",
      inputs.ticketBody,
      "## Seam manifest lines consumed",
      "Line one seam.\nLine two seam.",
      "## Module CONTEXT.md",
      inputs.moduleContext,
      "## Acceptance test(s) to turn on",
      "### foo.test.ts\n\ndescribe('foo', () => {});",
      "## Files claimed, as they stand",
      "### a/b.ts\n\nexport const x = 1;",
      "## Cited by the ticket",
      "### docs/adr/0042-thing.md\n\n# The ruling",
      "## Nearby, by path",
      "- a/b.test.ts",
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
      claimed: [],
      cited: [],
      nearby: [],
    });

    expect(brief).toContain("content A");
    expect(brief).toContain("content B");
  });

  it("renders a placeholder rather than fabricating an ingredient when a section is empty", () => {
    const brief = assembleBrief({
      ticketBody: "body",
      seamManifestLines: [],
      moduleContext: "ctx",
      failingTests: [],
      claimed: [],
      cited: [],
      nearby: [],
    });

    expect(brief).toBe(
      [
        "## Ticket",
        "body",
        "## Seam manifest lines consumed",
        "(none)",
        "## Module CONTEXT.md",
        "ctx",
        "## Acceptance test(s) to turn on",
        "(none)",
        "## Files claimed, as they stand",
        "(none)",
        "## Cited by the ticket",
        "(none)",
        "## Nearby, by path",
        "(none)",
      ].join("\n\n"),
    );
  });

  it("prints '(does not exist yet)' for a claimed path with no content, alongside one that has it", () => {
    const brief = assembleBrief({
      ticketBody: "body",
      seamManifestLines: [],
      moduleContext: "ctx",
      failingTests: [],
      claimed: [
        { path: "a/b.ts", content: "export const x = 1;" },
        { path: "a/new.ts" },
      ],
      cited: [],
      nearby: [],
    });

    expect(brief).toContain("### a/b.ts\n\nexport const x = 1;");
    expect(brief).toContain("### a/new.ts\n\n(does not exist yet)");
  });

  it("lists an over-budget claimed or cited path under Nearby, with a suffix saying why it isn't inlined", () => {
    const brief = assembleBrief({
      ticketBody: "body",
      seamManifestLines: [],
      moduleContext: "ctx",
      failingTests: [],
      claimed: [{ path: "big.ts", omitted: "over-budget" }],
      cited: [{ path: "also-big.ts", omitted: "over-budget" }],
      nearby: ["nearby.ts"],
    });

    const nearbySection = brief.split("## Nearby, by path")[1];
    expect(nearbySection).toContain("- nearby.ts");
    expect(nearbySection).toContain("- big.ts (not inlined: over budget)");
    expect(nearbySection).toContain("- also-big.ts (not inlined: over budget)");
  });
});

describe("gatherBriefContext gathers what the ticket claims and cites, and what sits nearby it", () => {
  it("inlines a claimed file's content, and leaves a claimed path that does not exist without content", () => {
    const files = new Map([["a/b.ts", "export const x = 1;"]]);

    const { claimed } = gatherBriefContext(
      fakeDeps({
        filesClaimed: ["a/b.ts", "a/missing.ts"],
        readFile: (path) => files.get(path) ?? "",
        fileExists: (path) => files.has(path),
      }),
    );

    expect(claimed).toEqual([{ path: "a/b.ts", content: "export const x = 1;" }, { path: "a/missing.ts" }]);
  });

  it("resolves an ADR-#### mention and a backticked path to the files they name, and inlines both", () => {
    const files = new Map([
      ["docs/adr/0042-do-the-thing.md", "# Do the thing"],
      ["shared/foo.ts", "export const foo = 1;"],
    ]);

    const { cited } = gatherBriefContext(
      fakeDeps({
        ticketBody: "See ADR-0042 and `shared/foo.ts` for the shape.",
        readFile: (path) => files.get(path) ?? "",
        fileExists: (path) => files.has(path),
        adrFiles: () => ["docs/adr/0042-do-the-thing.md"],
      }),
    );

    expect(cited).toEqual([
      { path: "docs/adr/0042-do-the-thing.md", content: "# Do the thing" },
      { path: "shared/foo.ts", content: "export const foo = 1;" },
    ]);
  });

  it("drops a citation that is already a claimed path", () => {
    const files = new Map([["shared/foo.ts", "export const foo = 1;"]]);

    const { cited } = gatherBriefContext(
      fakeDeps({
        ticketBody: "See `shared/foo.ts` for the shape.",
        filesClaimed: ["shared/foo.ts"],
        readFile: (path) => files.get(path) ?? "",
        fileExists: (path) => files.has(path),
      }),
    );

    expect(cited).toEqual([]);
  });

  it("drops a file over the per-file cap from being inlined, marking it over-budget", () => {
    const big = "x".repeat(INLINE_FILE_CAP_BYTES + 1);
    const files = new Map([["a/big.ts", big]]);

    const { claimed } = gatherBriefContext(
      fakeDeps({
        filesClaimed: ["a/big.ts"],
        readFile: (path) => files.get(path) ?? "",
        fileExists: (path) => files.has(path),
      }),
    );

    expect(claimed).toEqual([{ path: "a/big.ts", omitted: "over-budget" }]);
  });

  it("drops a file that would push the running total past the overall budget, even under the per-file cap", () => {
    const atCap = "x".repeat(INLINE_FILE_CAP_BYTES);
    const paths = ["a/f0.ts", "a/f1.ts", "a/f2.ts", "a/f3.ts"];
    const files = new Map(paths.map((path) => [path, atCap]));

    const { claimed } = gatherBriefContext(
      fakeDeps({
        filesClaimed: paths,
        readFile: (path) => files.get(path) ?? "",
        fileExists: (path) => files.has(path),
      }),
    );

    expect(claimed).toEqual([
      { path: "a/f0.ts", content: atCap },
      { path: "a/f1.ts", content: atCap },
      { path: "a/f2.ts", content: atCap },
      { path: "a/f3.ts", omitted: "over-budget" },
    ]);
  });

  it("puts an over-budget claimed file's path under Nearby, by path once its snapshot feeds into assembleBrief", () => {
    const big = "x".repeat(INLINE_FILE_CAP_BYTES + 1);

    const { claimed, cited, nearby } = gatherBriefContext(
      fakeDeps({
        filesClaimed: ["a/big.ts"],
        readFile: () => big,
        fileExists: () => true,
      }),
    );

    const brief = assembleBrief({
      ticketBody: "body",
      seamManifestLines: [],
      moduleContext: "ctx",
      failingTests: [],
      claimed,
      cited,
      nearby,
    });

    expect(brief).toContain("- a/big.ts (not inlined: over budget)");
  });

  it("finds a test mentioning a claimed file's basename, but excludes claimed, cited and failing-test paths from the list", () => {
    const files = new Map([
      ["shared/stage.ts", "export function stage() {}"],
      ["shared/stage.test.ts", "import { stage } from '../shared/stage';"],
      ["shared/stage-consumer.ts", "import { stage } from '../shared/stage';"],
      ["shared/failing.test.ts", "import { stage } from '../shared/stage';"],
      ["shared/unrelated.ts", "export const unrelated = 1;"],
    ]);

    const { nearby } = gatherBriefContext(
      fakeDeps({
        ticketBody: "See `shared/stage-consumer.ts`.",
        filesClaimed: ["shared/stage.ts"],
        readFile: (path) => files.get(path) ?? "",
        fileExists: (path) => files.has(path),
        sourceFiles: () => [...files.keys()],
        failingTestPaths: ["shared/failing.test.ts"],
      }),
    );

    expect(nearby).toEqual(["shared/stage.test.ts"]);
  });
});

describe("walkSourceFiles and listAdrFiles read the tree without touching git", () => {
  it("walkSourceFiles finds every .ts/.mts/.mjs/.js file under .Workflow and .claude, skipping node_modules and worktrees", () => {
    const root = scratchDir("brief-walk-source");
    mkdirSync(join(root, ".Workflow", "agent-workflows", "implement"), { recursive: true });
    mkdirSync(join(root, ".claude"), { recursive: true });
    mkdirSync(join(root, ".Workflow", "node_modules", "dep"), { recursive: true });
    mkdirSync(join(root, ".claude", "worktrees", "wt"), { recursive: true });
    writeFileSync(join(root, ".Workflow", "agent-workflows", "implement", "brief.ts"), "");
    writeFileSync(join(root, ".Workflow", "agent-workflows", "implement", "brief.test.ts"), "");
    writeFileSync(join(root, ".claude", "gate-size.test.ts"), "");
    writeFileSync(join(root, ".Workflow", "node_modules", "dep", "index.js"), "");
    writeFileSync(join(root, ".claude", "worktrees", "wt", "index.ts"), "");
    writeFileSync(join(root, ".Workflow", "README.md"), "");

    expect(walkSourceFiles(root).sort()).toEqual(
      [
        ".Workflow/agent-workflows/implement/brief.test.ts",
        ".Workflow/agent-workflows/implement/brief.ts",
        ".claude/gate-size.test.ts",
      ].sort(),
    );
  });

  it("listAdrFiles lists docs/adr/*.md, repo-relative", () => {
    const root = scratchDir("brief-list-adr");
    mkdirSync(join(root, "docs", "adr"), { recursive: true });
    writeFileSync(join(root, "docs", "adr", "0001-a-ruling.md"), "");
    writeFileSync(join(root, "docs", "adr", "0002-another-ruling.md"), "");
    writeFileSync(join(root, "docs", "adr", "INDEX.md"), "");
    writeFileSync(join(root, "docs", "adr", "not-markdown.txt"), "");

    expect(listAdrFiles(root)).toEqual(["docs/adr/0001-a-ruling.md", "docs/adr/0002-another-ruling.md", "docs/adr/INDEX.md"]);
  });

  it("listAdrFiles returns no files for a repo with no docs/adr directory", () => {
    expect(listAdrFiles(scratchDir("brief-list-adr-empty"))).toEqual([]);
  });
});
