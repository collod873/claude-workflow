import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { admit, newAdrRepo, runNewAdr, twoAuthorRepo } from "./new-adr.fixture.ts";
import { scratchDir } from "./scratch.fixture.ts";
import { makeTempRepo } from "./temp-repo.fixture.ts";

function frontmatterOf(content: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (match === null) throw new Error(`no frontmatter block in:\n${content}`);
  return match[1];
}

function draftContents(root: string, args: string[]): string {
  return readFileSync(runNewAdr(root, args), "utf8");
}

function draftAndLand(root: string, args: string[], env: Record<string, string> = {}): string {
  return runNewAdr(root, ["--land", admit(runNewAdr(root, args, env))], env);
}

const INDEX = "docs/adr/INDEX.md";
const RULING = "A ruling that binds later work";
const SLUG = "a-ruling-that-binds-later-work";

function repoWithAdrDir(prefix: string, index?: string): string {
  const root = newAdrRepo(prefix).dir;
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  if (index !== undefined) writeFileSync(join(root, INDEX), index);
  return root;
}

describe("bin/new-adr", () => {
  it("--amends 8 writes the amends: ADR-0008 key into the created file's frontmatter", () => {
    const root = newAdrRepo("new-adr-amends").dir;

    expect(frontmatterOf(draftContents(root, ["--amends", "8", "a title"]))).toContain("amends: ADR-0008");
  });

  it("opens with the three keys adr_shape.py requires, and a reversal the author has to write", () => {
    const root = newAdrRepo("new-adr-frontmatter").dir;

    const frontmatter = frontmatterOf(draftContents(root, ["a title"]));

    expect(frontmatter).toMatch(/^status: constraint$/m);
    expect(frontmatter).toMatch(/^date: \d{4}-\d{2}-\d{2}$/m);
    expect(frontmatter).toMatch(/^reversal:\s*$/m);
  });

  it("answers --help with usage instead of filing a ruling titled --help, which is how docs/adr/draft-help.md reached main", () => {
    const root = newAdrRepo("new-adr-help").dir;

    expect(runNewAdr(root, ["--help"])).toBe("");
    expect(existsSync(join(root, "docs/adr"))).toBe(false);
  });

  it("refuses a leading dash rather than slugifying an unknown flag into a ruling", () => {
    const root = newAdrRepo("new-adr-unknown-flag").dir;

    expect(() => runNewAdr(root, ["--nope", "a title"])).toThrow();
    expect(existsSync(join(root, "docs/adr"))).toBe(false);
  });

  it("drafts a file the retired-grammar gate accepts once landed", () => {
    const root = repoWithAdrDir("new-adr-grammar");

    const landed = draftAndLand(root, ["--amends", "8", RULING]);

    expect(readFileSync(landed, "utf8")).toContain("amends: ADR-0008");
  });
});

describe("bin/new-adr, drafting and landing", () => {
  it("drafts to an unnumbered filename, so nothing is claimed before there is a ruling to claim it for", () => {
    const path = runNewAdr(newAdrRepo("new-adr-draft").dir, [RULING]);

    expect(basename(path)).toBe(`draft-${SLUG}.md`);
    expect(basename(path)).not.toMatch(/^\d{4}-/);
  });

  it("does not take a number origin/main has already taken, even though the local disk has never seen it", () => {
    const root = twoAuthorRepo("0077").dir;

    const landed = draftAndLand(root, [RULING]);

    expect(basename(landed)).toBe(`0078-${SLUG}.md`);
    expect(readdirSync(join(root, "docs/adr")).filter((n) => n.startsWith("0077"))).toEqual([]);
  });

  it("does not reuse a number an unpushed local land already took", () => {
    const root = twoAuthorRepo("0077").dir;

    const first = draftAndLand(root, ["The first ruling that binds"]);
    const second = draftAndLand(root, ["The second ruling that binds"]);

    expect(basename(first)).toBe("0078-the-first-ruling-that-binds.md");
    expect(basename(second)).toBe("0079-the-second-ruling-that-binds.md");
  });

  it("lands with no origin at all, falling back to the disk rather than failing", () => {
    const root = repoWithAdrDir("new-adr-no-origin");
    writeFileSync(join(root, "docs/adr/0004-existing.md"), "# Existing\n");

    expect(basename(draftAndLand(root, [RULING]))).toBe(`0005-${SLUG}.md`);
  });

  it("carries the amends: key written at draft time through the land", () => {
    const landed = draftAndLand(repoWithAdrDir("new-adr-amends-land"), ["--amends", "8", RULING]);

    expect(frontmatterOf(readFileSync(landed, "utf8"))).toContain("amends: ADR-0008");
  });

  it("refuses a path that is not a draft, so a landed ADR cannot be renumbered by a second land", () => {
    const root = repoWithAdrDir("new-adr-reland");
    const landed = draftAndLand(root, [RULING]);

    expect(() => runNewAdr(root, ["--land", landed])).toThrow();
    expect(readdirSync(join(root, "docs/adr"))).toEqual([`0001-${SLUG}.md`]);
  });

  it("drafts and lands into the target checkout rather than the machine checkout it runs from, given TARGET_WORKSPACE", () => {
    const machine = newAdrRepo("new-adr-target-ws-machine").dir;
    const target = makeTempRepo("new-adr-target-ws-target").dir;
    const env = { TARGET_WORKSPACE: target };

    const draft = admit(runNewAdr(machine, [RULING], env));
    expect(draft).toBe(join(target, `docs/adr/draft-${SLUG}.md`));
    expect(existsSync(join(machine, "docs/adr"))).toBe(false);

    const landed = runNewAdr(machine, ["--land", draft], env);
    expect(landed).toBe(join(target, `docs/adr/0001-${SLUG}.md`));
    expect(existsSync(join(machine, "docs/adr"))).toBe(false);

    expect(existsSync(join(target, ".Workflow"))).toBe(false);
  });
});

describe("bin/new-adr --land, and the index it invalidates", () => {
  const MACHINE = resolve(import.meta.dirname, "../../..");

  function targetWithAdrDir(prefix: string, index?: string): string {
    const root = makeTempRepo(prefix).dir;
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    if (index !== undefined) writeFileSync(join(root, INDEX), index);
    return root;
  }

  it("regenerates the index it just invalidated, in the tree that owns it and not the machine's", () => {
    const target = targetWithAdrDir("new-adr-index", "stale\n");
    const before = readFileSync(join(MACHINE, INDEX), "utf8");

    const landed = draftAndLand(MACHINE, [RULING], { TARGET_WORKSPACE: target });

    expect(readFileSync(join(target, INDEX), "utf8")).toContain(basename(landed));
    expect(readFileSync(join(MACHINE, INDEX), "utf8")).toBe(before);
  });

  it("does not create an index in a target that never adopted one, the way it does not create a corpus fixture", () => {
    const target = targetWithAdrDir("new-adr-no-index");

    draftAndLand(MACHINE, [RULING], { TARGET_WORKSPACE: target });

    expect(existsSync(join(target, INDEX))).toBe(false);
  });

  it("needs nothing on $HOME, so a land on a hosted runner leaves the index as fresh as one here", () => {
    const target = targetWithAdrDir("new-adr-bare-home", "stale\n");

    const landed = draftAndLand(MACHINE, [RULING], {
      TARGET_WORKSPACE: target,
      HOME: scratchDir("new-adr-empty-home"),
    });

    expect(basename(landed)).toBe(`0001-${SLUG}.md`);
    expect(readFileSync(join(target, INDEX), "utf8")).toContain(basename(landed));
  });

  it("lands rather than failing where the renderer is not reachable at all, as in a vendored checkout", () => {
    const root = repoWithAdrDir("new-adr-no-renderer", "stale\n");

    expect(basename(draftAndLand(root, [RULING]))).toBe(`0001-${SLUG}.md`);
  });
});
