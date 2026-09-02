import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { malformedTrailers } from "./trailer-form.ts";

/**
 * ADR-0045: `bin/new-adr --amends NNNN` writes the machine-readable amendment
 * edge the back-stamp and missing-trailer counter both read. That edge, and
 * the rest of an ADR's metadata, live in frontmatter — so what these assert is
 * that the draft opens in the grammar the corpus is read in.
 *
 * It did not, for a while. The template emitted `Recorded YYYY-MM-DD.` and an
 * `Amends:` prose trailer, which is exactly what `shared/trailer-form.ts`
 * refuses in a landed ADR and what `adr_shape.py` reports as three missing
 * keys — so the tool that exists to author ADRs handed every author a file its
 * own push venue rejects, and every author silently retyped the frontmatter.
 * The guard that closed it is the round-trip below: draft, land, and run the
 * real refusal over the result.
 *
 * `bin/new-adr` derives its `docs/adr` location from its own script path
 * (`dirname "${BASH_SOURCE[0]}"/..`), not from `cwd` — so a scratch run needs
 * a scratch `bin/`, not just a scratch `docs/adr`. `makeScratchRepo` gives
 * every case that shape.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NEW_ADR = join(REPO_ROOT, "bin/new-adr");

/** The frontmatter block alone, so an assertion about a key cannot be satisfied by the body. */
function frontmatterOf(content: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (match === null) throw new Error(`no frontmatter block in:\n${content}`);
  return match[1];
}

/** A repo-shaped scratch dir: `<root>/bin/new-adr` copied from `scriptPath`, so the script's own
 * `dirname/..` resolution lands `docs/adr` inside `<root>`, never in the real repo.
 *
 * `bin/node-on-path.sh` rides along because `--land` sources it. The corpus generator does not:
 * `--land` skips the regeneration when the tree has none, which is what these scratch trees are
 * exercising as much as the numbering. */
function makeScratchRepo(prefix: string, scriptPath: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/new-adr"), readFileSync(scriptPath, "utf8"), { mode: 0o755 });
  writeFileSync(join(root, "bin/node-on-path.sh"), readFileSync(join(REPO_ROOT, "bin/node-on-path.sh"), "utf8"));
  return root;
}

/** `git`, in a scratch tree, with the suite's sandbox variables out of the way so it acts on `cwd`. */
function git(cwd: string, ...args: string[]): string {
  const env = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_COMMON_DIR", "GIT_NAMESPACE"]) {
    delete env[name];
  }
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
}

/** Runs `<root>/bin/new-adr` and returns the path it printed. */
function runNewAdrPath(root: string, args: string[]): string {
  const env = { ...process.env };
  delete env.EDITOR;
  delete env.VISUAL;
  return execFileSync(join(root, "bin/new-adr"), args, { cwd: root, encoding: "utf8", env }).trim();
}

/**
 * A scratch tree whose `origin` already carries `docs/adr/<taken>-landed.md` on `main`, plus
 * whatever uncommitted state the caller adds — the two-author split from
 * [#146](https://github.com/collod873/claude-workflow/issues/146), staged locally: a remote the
 * other author has already pushed to, and a working tree that has not seen it.
 */
function makeTwoAuthorRepo(taken: string): string {
  const origin = mkdtempSync(join(tmpdir(), "new-adr-origin-"));
  git(origin, "init", "--quiet", "--bare", "--initial-branch=main");

  const seed = mkdtempSync(join(tmpdir(), "new-adr-seed-"));
  git(seed, "init", "--quiet", "--initial-branch=main");
  mkdirSync(join(seed, "docs/adr"), { recursive: true });
  writeFileSync(join(seed, `docs/adr/${taken}-landed.md`), `# The other author got here first\n\nRecorded 2026-08-27.\n`);
  git(seed, "add", "-A");
  git(seed, "-c", "user.email=t@e", "-c", "user.name=T", "commit", "--quiet", "-m", "seed");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "--quiet", "origin", "main");
  rmSync(seed, { recursive: true, force: true });

  const work = makeScratchRepo("new-adr-work-", NEW_ADR);
  git(work, "init", "--quiet", "--initial-branch=main");
  git(work, "remote", "add", "origin", origin);
  mkdirSync(join(work, "docs/adr"), { recursive: true });
  return work;
}

/**
 * Runs `<root>/bin/new-adr` with the given argv and returns the created file's contents.
 * `EDITOR`/`VISUAL` are stripped so a set editor never `exec`s over the test and hangs it —
 * `bin/new-adr` opens the created file in `$EDITOR` when one is set.
 */
function runNewAdr(root: string, args: string[]): string {
  const env = { ...process.env };
  delete env.EDITOR;
  delete env.VISUAL;
  const createdPath = execFileSync(join(root, "bin/new-adr"), args, { cwd: root, encoding: "utf8", env }).trim();
  return readFileSync(createdPath, "utf8");
}

describe("bin/new-adr", () => {
  let scratch: string | undefined;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  it("--amends 8 writes the amends: ADR-0008 key into the created file's frontmatter", () => {
    scratch = makeScratchRepo("new-adr-amends-", NEW_ADR);

    const created = runNewAdr(scratch, ["--amends", "8", "a title"]);

    expect(frontmatterOf(created)).toContain("amends: ADR-0008");
  });

  it("opens with the three keys adr_shape.py requires, and a reversal the author has to write", () => {
    scratch = makeScratchRepo("new-adr-frontmatter-", NEW_ADR);

    const frontmatter = frontmatterOf(runNewAdr(scratch, ["a title"]));

    expect(frontmatter).toMatch(/^status: constraint$/m);
    expect(frontmatter).toMatch(/^date: \d{4}-\d{2}-\d{2}$/m);
    // Empty on purpose: `docs/adr/README.md` makes `reversal:` the admission test rather than a
    // field, and `adr_shape.validate` refuses an empty one at the land. Seeding a sentence here
    // would answer the one question drafting exists to ask.
    expect(frontmatter).toMatch(/^reversal:\s*$/m);
  });

  // The round-trip, against the real refusal rather than a restatement of it: whatever the template
  // emits has to survive the check the push venue runs over `docs/adr/`. A template that drifts back
  // into the prose grammar fails here rather than at someone's push.
  it("drafts a file the retired-grammar gate accepts once landed", () => {
    scratch = makeScratchRepo("new-adr-grammar-", NEW_ADR);
    mkdirSync(join(scratch, "docs/adr"), { recursive: true });

    const landed = runNewAdrPath(scratch, ["--land", runNewAdrPath(scratch, ["--amends", "8", "A ruling"])]);

    expect(malformedTrailers([{ path: landed, content: readFileSync(landed, "utf8") }])).toEqual([]);
  });
});

/**
 * ADR-0080: the number is claimed at the land, against `origin/main`, because `docs/adr/` has two
 * authors and neither sees the other's uncommitted work. #146's first two items.
 */
describe("bin/new-adr, drafting and landing", () => {
  const roots: string[] = [];
  afterEach(() => {
    while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
  });

  function scratch(root: string): string {
    roots.push(root);
    return root;
  }

  it("drafts to an unnumbered filename, so nothing is claimed before there is a ruling to claim it for", () => {
    const root = scratch(makeScratchRepo("new-adr-draft-", NEW_ADR));

    const path = runNewAdrPath(root, ["A ruling"]);

    expect(basename(path)).toBe("draft-a-ruling.md");
    expect(basename(path)).not.toMatch(/^\d{4}-/);
  });

  it("does not take a number origin/main has already taken, even though the local disk has never seen it", () => {
    // #146's first criterion, staged as the collision that actually happened: `origin/main`
    // carries 0077 (the lane filed it) and this working tree does not (the owner never pulled).
    // Numbering off the disk alone lands a second 0077; fetching first is what makes 0078.
    const root = scratch(makeTwoAuthorRepo("0077"));

    const draft = runNewAdrPath(root, ["A ruling"]);
    const landed = runNewAdrPath(root, ["--land", draft]);

    expect(basename(landed)).toBe("0078-a-ruling.md");
    expect(readdirSync(join(root, "docs/adr")).filter((n) => n.startsWith("0077"))).toEqual([]);
  });

  it("does not reuse a number an unpushed local land already took", () => {
    // The other side of the max: two lands in one session, nothing pushed between them. Reading
    // `origin/main` alone would hand both the same number.
    const root = scratch(makeTwoAuthorRepo("0077"));

    const first = runNewAdrPath(root, ["--land", runNewAdrPath(root, ["First ruling"])]);
    const second = runNewAdrPath(root, ["--land", runNewAdrPath(root, ["Second ruling"])]);

    expect(basename(first)).toBe("0078-first-ruling.md");
    expect(basename(second)).toBe("0079-second-ruling.md");
  });

  it("lands with no origin at all, falling back to the disk rather than failing", () => {
    // The fetch is a sharpening, not a precondition — a tree with no remote degrades to exactly
    // the pre-#146 behaviour instead of refusing to land.
    const root = scratch(makeScratchRepo("new-adr-no-origin-", NEW_ADR));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    writeFileSync(join(root, "docs/adr/0004-existing.md"), "# Existing\n");

    const landed = runNewAdrPath(root, ["--land", runNewAdrPath(root, ["A ruling"])]);

    expect(basename(landed)).toBe("0005-a-ruling.md");
  });

  it("carries the amends: key written at draft time through the land", () => {
    const root = scratch(makeScratchRepo("new-adr-amends-land-", NEW_ADR));
    mkdirSync(join(root, "docs/adr"), { recursive: true });

    const landed = runNewAdrPath(root, ["--land", runNewAdrPath(root, ["--amends", "8", "A ruling"])]);

    expect(frontmatterOf(readFileSync(landed, "utf8"))).toContain("amends: ADR-0008");
  });

  it("refuses a path that is not a draft, so a landed ADR cannot be renumbered by a second land", () => {
    const root = scratch(makeScratchRepo("new-adr-relend-", NEW_ADR));
    mkdirSync(join(root, "docs/adr"), { recursive: true });
    const landed = runNewAdrPath(root, ["--land", runNewAdrPath(root, ["A ruling"])]);

    expect(() => runNewAdrPath(root, ["--land", landed])).toThrow();
    expect(readdirSync(join(root, "docs/adr"))).toEqual(["0001-a-ruling.md"]);
  });
});
