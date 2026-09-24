import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadedBytes, loadedDocs, onDisk, pathsToNothing, type Tree } from "./loaded-docs.ts";
import { git, plant, scratch } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");

function atCommit(repo: string, rev: string): Tree {
  return {
    entries: (dir) => git(repo, "ls-tree", "--name-only", rev, `${dir}/`).split("\n").filter(Boolean).map((path) => basename(path)),
    read: (file) => {
      try {
        return git(repo, "cat-file", "-t", `${rev}:${file}`) === "blob" ? git(repo, "show", `${rev}:${file}`) : undefined;
      } catch {
        return undefined;
      }
    },
  };
}

function growthSinceBase(repo: string): string[] {
  const base = git(repo, "merge-base", "HEAD", "origin/main");
  const before = loadedBytes(loadedDocs(atCommit(repo, base)));
  const now = loadedBytes(loadedDocs(onDisk(repo)));
  return now > before ? [`the docs every session loads hold ${now} bytes, over ${before} at the merge base ${base.slice(0, 12)}`] : [];
}

const skill = (name: string, description: string, body = "", disabled = false) =>
  `---\nname: ${name}\ndescription: ${description}\n${disabled ? "disable-model-invocation: true\n" : ""}---\n\n${body}\n`;

function committedDocs(): string {
  const repo = scratch("loaded-docs-");
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "docs@test");
  git(repo, "config", "user.name", "docs");
  plant(repo, "CLAUDE.md", "# Planted\n\nRead `CONTEXT.md`.\n");
  plant(repo, "CONTEXT.md", "**Ticket**:\nOne thing the machine builds.\n");
  plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first.", "A long body nobody loads until the skill runs."));
  plant(repo, ".claude/skills/drain/SKILL.md", skill("drain", "Drain tickets.", "", true));
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  git(repo, "update-ref", "refs/remotes/origin/main", "HEAD");
  return repo;
}

describe("the docs every session loads never grow in total, and name no path to nothing (#663)", () => {
  it("holds today's loaded docs at or under their total at the merge base with origin/main", () => {
    expect(growthSinceBase(REPO)).toEqual([]);
  });

  it("refuses growth in a loaded doc or a skill or agent's description, and lets a skill body or a hidden skill grow", () => {
    const repo = committedDocs();

    plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first.", "A longer body nobody loads until the skill runs, whatever it says."));
    plant(repo, ".claude/skills/drain/SKILL.md", skill("drain", "Drain a batch of tickets in parallel worktrees.", "", true));
    plant(repo, "CONTEXT.md", "**Ticket**:\nOne unit the machine builds.\n");
    expect(growthSinceBase(repo)).toEqual([]);

    plant(repo, "CONTEXT.md", "**Ticket**:\nOne unit the machine builds, and one more line.\n");
    expect(growthSinceBase(repo)).toEqual([expect.stringMatching(/^the docs every session loads hold \d+ bytes, over \d+ at the merge base [0-9a-f]{12}$/)]);

    plant(repo, "CONTEXT.md", "**Ticket**:\nOne unit the machine builds.\n");
    plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first, then build.", "A long body nobody loads until the skill runs."));
    expect(growthSinceBase(repo)).toHaveLength(1);

    plant(repo, ".claude/skills/tdd/SKILL.md", skill("tdd", "Test first.", "A long body nobody loads until the skill runs."));
    plant(repo, ".claude/agents/reviewer.md", skill("reviewer", "Reviews."));
    expect(growthSinceBase(repo)).toHaveLength(1);
  });

  it("names no repo path that does not exist in today's loaded docs", () => {
    expect(pathsToNothing(REPO, loadedDocs(onDisk(REPO)))).toEqual([]);
  });

  it("names the doc and line of a planted path to nothing, and leaves placeholders, urls and other repos alone", () => {
    const repo = committedDocs();
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
