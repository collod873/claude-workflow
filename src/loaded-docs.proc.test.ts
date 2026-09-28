import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadedBytes, loadedDocs, onDisk, pathsToNothing } from "./loaded-docs.ts";
import { plant, scratch } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const CEILINGS: Record<string, number> = { "CLAUDE.md": 4 * 1024, "CONTEXT.md": 20 * 1024 };
const DESCRIPTION_CEILING = 1024;

function overCeiling(repo: string): string[] {
  return loadedDocs(onDisk(repo)).flatMap((doc) => {
    const ceiling = CEILINGS[doc.file] ?? DESCRIPTION_CEILING;
    const bytes = loadedBytes([doc]);
    return bytes > ceiling ? [`${doc.file} loads ${bytes} bytes into every session, over its ${ceiling}`] : [];
  });
}

const skill = (name: string, description: string, body = "", disabled = false) =>
  `---\nname: ${name}\ndescription: ${description}\n${disabled ? "disable-model-invocation: true\n" : ""}---\n\n${body}\n`;

function plantedDocs(): string {
  const repo = scratch("loaded-docs-");
  plant(repo, "CLAUDE.md", "# Planted\n\nRead `CONTEXT.md`.\n");
  plant(repo, "CONTEXT.md", "**Ticket**:\nOne thing the machine builds.\n");
  plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first.", "A long body nobody loads until the skill runs."));
  plant(repo, ".claude/skills/drain/SKILL.md", skill("drain", "Drain tickets.", "", true));
  return repo;
}

describe("each doc every session loads stays under its own ceiling, and names no path to nothing (#663)", () => {
  it("holds each of today's loaded docs under its ceiling", () => {
    expect(overCeiling(REPO)).toEqual([]);
  });

  it("lets a doc grow up to its own ceiling, where #968's builder cut eight definitions to fit one new one", () => {
    const repo = plantedDocs();

    plant(repo, "CONTEXT.md", `${"x".repeat(19 * 1024)}\n`);
    plant(repo, "CLAUDE.md", `${"x".repeat(3 * 1024)}\n`);
    expect(overCeiling(repo)).toEqual([]);

    plant(repo, "CONTEXT.md", `${"x".repeat(21 * 1024)}\n`);
    plant(repo, "CLAUDE.md", `${"x".repeat(5 * 1024)}\n`);
    expect(overCeiling(repo)).toEqual([
      "CLAUDE.md loads 5121 bytes into every session, over its 4096",
      "CONTEXT.md loads 21505 bytes into every session, over its 20480",
    ]);
  });

  it("refuses a skill or agent's description past its ceiling, and lets a skill body or a hidden skill grow past any", () => {
    const repo = plantedDocs();

    plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first.", "x".repeat(50 * 1024)));
    plant(repo, ".claude/skills/drain/SKILL.md", skill("drain", "x".repeat(2 * 1024), "", true));
    expect(overCeiling(repo)).toEqual([]);

    plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "x".repeat(2 * 1024)));
    plant(repo, ".claude/agents/reviewer.md", skill("reviewer", "x".repeat(2 * 1024)));
    expect(overCeiling(repo)).toEqual([
      ".claude/skills/tdd/SKILL.md loads 2072 bytes into every session, over its 1024",
      ".claude/agents/reviewer.md loads 2077 bytes into every session, over its 1024",
    ]);
  });

  it("names no repo path that does not exist in today's loaded docs", () => {
    expect(pathsToNothing(REPO, loadedDocs(onDisk(REPO)))).toEqual([]);
  });

  it("names the doc and line of a planted path to nothing, and leaves placeholders, urls and other repos alone", () => {
    const repo = plantedDocs();
    plant(repo, "bin/check", "");
    plant(repo, "CLAUDE.md", [
      "# Planted",
      "",
      "Run `bin/check`, never `src/gone.ts`; see [the context](CONTEXT.md) and [the lanes](docs/agents/lanes.md).",
      "Branches are `ticket/<n>`, globs `core/**/*.ts`, commands `/ratify`, and [the tracker](https://github.com/collod873/claude-workflow#top).",
      "`anthropics/claude-code-action` is another repo; `lib/` is gone.",
      "",
    ].join("\n"));
    plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first, as `docs/nowhere.md` says.", "The body names `src/body-only.ts`."));

    expect(pathsToNothing(repo, loadedDocs(onDisk(repo)))).toEqual([
      "CLAUDE.md:3 names src/gone.ts, which does not exist",
      "CLAUDE.md:3 names docs/agents/lanes.md, which does not exist",
      "CLAUDE.md:5 names lib/, which does not exist",
      ".claude/skills/tdd/SKILL.md:3 names docs/nowhere.md, which does not exist",
    ]);
  });
});
