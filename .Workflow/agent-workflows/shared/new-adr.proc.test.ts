import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { newAdrRepo, runNewAdr, twoAuthorRepo } from "./new-adr.fixture.ts";
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
  return runNewAdr(root, ["--land", runNewAdr(root, args, env)], env);
}

const INDEX = "docs/adr/INDEX.md";

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

  it("drafts a file the retired-grammar gate accepts once landed", () => {
    const root = repoWithAdrDir("new-adr-grammar");

    const landed = draftAndLand(root, ["--amends", "8", "A ruling"]);

    expect(readFileSync(landed, "utf8")).toContain("amends: ADR-0008");
  });
});

describe("bin/new-adr, drafting and landing", () => {
  it("drafts to an unnumbered filename, so nothing is claimed before there is a ruling to claim it for", () => {
    const path = runNewAdr(newAdrRepo("new-adr-draft").dir, ["A ruling"]);

    expect(basename(path)).toBe("draft-a-ruling.md");
    expect(basename(path)).not.toMatch(/^\d{4}-/);
  });

  it("does not take a number origin/main has already taken, even though the local disk has never seen it", () => {
    const root = twoAuthorRepo("0077").dir;

    const landed = draftAndLand(root, ["A ruling"]);

    expect(basename(landed)).toBe("0078-a-ruling.md");
    expect(readdirSync(join(root, "docs/adr")).filter((n) => n.startsWith("0077"))).toEqual([]);
  });

  it("does not reuse a number an unpushed local land already took", () => {
    const root = twoAuthorRepo("0077").dir;

    const first = draftAndLand(root, ["First ruling"]);
    const second = draftAndLand(root, ["Second ruling"]);

    expect(basename(first)).toBe("0078-first-ruling.md");
    expect(basename(second)).toBe("0079-second-ruling.md");
  });

  it("lands with no origin at all, falling back to the disk rather than failing", () => {
    const root = repoWithAdrDir("new-adr-no-origin");
    writeFileSync(join(root, "docs/adr/0004-existing.md"), "# Existing\n");

    expect(basename(draftAndLand(root, ["A ruling"]))).toBe("0005-a-ruling.md");
  });

  it("carries the amends: key written at draft time through the land", () => {
    const landed = draftAndLand(repoWithAdrDir("new-adr-amends-land"), ["--amends", "8", "A ruling"]);

    expect(frontmatterOf(readFileSync(landed, "utf8"))).toContain("amends: ADR-0008");
  });

  it("refuses a path that is not a draft, so a landed ADR cannot be renumbered by a second land", () => {
    const root = repoWithAdrDir("new-adr-reland");
    const landed = draftAndLand(root, ["A ruling"]);

    expect(() => runNewAdr(root, ["--land", landed])).toThrow();
    expect(readdirSync(join(root, "docs/adr"))).toEqual(["0001-a-ruling.md"]);
  });

  it("drafts and lands into the target checkout rather than the machine checkout it runs from, given TARGET_WORKSPACE", () => {
    const machine = newAdrRepo("new-adr-target-ws-machine").dir;
    const target = makeTempRepo("new-adr-target-ws-target").dir;
    const env = { TARGET_WORKSPACE: target };

    const draft = runNewAdr(machine, ["A ruling"], env);
    expect(draft).toBe(join(target, "docs/adr/draft-a-ruling.md"));
    expect(existsSync(join(machine, "docs/adr"))).toBe(false);

    const landed = runNewAdr(machine, ["--land", draft], env);
    expect(landed).toBe(join(target, "docs/adr/0001-a-ruling.md"));
    expect(existsSync(join(machine, "docs/adr"))).toBe(false);

    expect(existsSync(join(target, ".Workflow"))).toBe(false);
  });
});

describe("bin/new-adr --land, and the index it invalidates", () => {
  function stubHome(): { home: string; calls: () => string[] } {
    const home = scratchDir("new-adr-home");
    const log = join(home, "adr-check.calls");
    mkdirSync(join(home, "bin"));
    writeFileSync(
      join(home, "bin/adr-check"),
      `#!/usr/bin/env bash\nprintf '%s %s\\n' "$PWD" "$*" >> ${JSON.stringify(log)}\n`,
      { mode: 0o755 },
    );
    return { home, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []) };
  }

  it("regenerates the index it just invalidated, in the tree that owns it", () => {
    const root = repoWithAdrDir("new-adr-index", "stale\n");
    const { home, calls } = stubHome();

    draftAndLand(root, ["A ruling"], { HOME: home });

    expect(calls()).toHaveLength(1);
    const [cwd, ...argv] = calls()[0].split(" ");
    expect(realpathSync(cwd)).toBe(realpathSync(root));
    expect(argv).toEqual(["--fix"]);
  });

  it("does not create an index in a target that never adopted one, the way it does not create a corpus fixture", () => {
    const root = repoWithAdrDir("new-adr-no-index");
    const { home, calls } = stubHome();

    draftAndLand(root, ["A ruling"], { HOME: home });

    expect(calls()).toEqual([]);
    expect(existsSync(join(root, "docs/adr/INDEX.md"))).toBe(false);
  });

  it("lands rather than failing on a machine that carries no adr-check at all", () => {
    const root = repoWithAdrDir("new-adr-no-checker", "stale\n");

    expect(basename(draftAndLand(root, ["A ruling"], { HOME: scratchDir("new-adr-bare-home") }))).toBe("0001-a-ruling.md");
  });

  const REAL_ADR_CHECK = join(process.env.HOME ?? "", "bin/adr-check");
  it.skipIf(!existsSync(REAL_ADR_CHECK))("leaves the index naming the ADR the land just numbered", () => {
    const root = repoWithAdrDir("new-adr-index-real", "");

    const landed = draftAndLand(root, ["A ruling"]);

    expect(readFileSync(join(root, INDEX), "utf8")).toContain(basename(landed));
  });
});
