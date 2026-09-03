import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { newAdrRepo, runNewAdr, twoAuthorRepo } from "./new-adr.fixture.ts";
import { scratchDir } from "./scratch.fixture.ts";
import { makeTempRepo } from "./temp-repo.fixture.ts";

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
 * `bin/new-adr` derives its `docs/adr` location from its own script path, not
 * from `cwd` — so every case runs a copy of it inside a scratch tree
 * (`new-adr.fixture.ts`'s `newAdrRepo`), never the real one.
 */

/** The frontmatter block alone, so an assertion about a key cannot be satisfied by the body. */
function frontmatterOf(content: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (match === null) throw new Error(`no frontmatter block in:\n${content}`);
  return match[1];
}

/** Runs `<root>/bin/new-adr` with the given argv and returns the created file's contents. */
function draftContents(root: string, args: string[]): string {
  return readFileSync(runNewAdr(root, args), "utf8");
}

/** Drafts and lands one ruling in `root`, returning the landed path. */
function draftAndLand(root: string, args: string[], env: Record<string, string> = {}): string {
  return runNewAdr(root, ["--land", runNewAdr(root, args, env)], env);
}

/** A scratch repo with a `docs/adr/` and, optionally, an index already in it. */
function repoWithAdrDir(prefix: string, index?: string): string {
  const root = newAdrRepo(prefix).dir;
  mkdirSync(join(root, "docs/adr"), { recursive: true });
  if (index !== undefined) writeFileSync(join(root, "docs/adr/INDEX.md"), index);
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
    // Empty on purpose: `docs/adr/README.md` makes `reversal:` the admission test rather than a
    // field, and `adr_shape.validate` refuses an empty one at the land. Seeding a sentence here
    // would answer the one question drafting exists to ask.
    expect(frontmatter).toMatch(/^reversal:\s*$/m);
  });

  // The round-trip, against the real refusal rather than a restatement of it: whatever the template
  // emits has to survive the check the push venue runs over `docs/adr/`. A template that drifts back
  // into the prose grammar fails here rather than at someone's push.
  it("drafts a file the retired-grammar gate accepts once landed", () => {
    const root = repoWithAdrDir("new-adr-grammar");

    const landed = draftAndLand(root, ["--amends", "8", "A ruling"]);

    expect(readFileSync(landed, "utf8")).toContain("amends: ADR-0008");
  });
});

/**
 * ADR-0080: the number is claimed at the land, against `origin/main`, because `docs/adr/` has two
 * authors and neither sees the other's uncommitted work. #146's first two items.
 */
describe("bin/new-adr, drafting and landing", () => {
  it("drafts to an unnumbered filename, so nothing is claimed before there is a ruling to claim it for", () => {
    const path = runNewAdr(newAdrRepo("new-adr-draft").dir, ["A ruling"]);

    expect(basename(path)).toBe("draft-a-ruling.md");
    expect(basename(path)).not.toMatch(/^\d{4}-/);
  });

  it("does not take a number origin/main has already taken, even though the local disk has never seen it", () => {
    // #146's first criterion, staged as the collision that actually happened: `origin/main`
    // carries 0077 (the lane filed it) and this working tree does not (the owner never pulled).
    // Numbering off the disk alone lands a second 0077; fetching first is what makes 0078.
    const root = twoAuthorRepo("0077").dir;

    const landed = draftAndLand(root, ["A ruling"]);

    expect(basename(landed)).toBe("0078-a-ruling.md");
    expect(readdirSync(join(root, "docs/adr")).filter((n) => n.startsWith("0077"))).toEqual([]);
  });

  it("does not reuse a number an unpushed local land already took", () => {
    // The other side of the max: two lands in one session, nothing pushed between them. Reading
    // `origin/main` alone would hand both the same number.
    const root = twoAuthorRepo("0077").dir;

    const first = draftAndLand(root, ["First ruling"]);
    const second = draftAndLand(root, ["Second ruling"]);

    expect(basename(first)).toBe("0078-first-ruling.md");
    expect(basename(second)).toBe("0079-second-ruling.md");
  });

  it("lands with no origin at all, falling back to the disk rather than failing", () => {
    // The fetch is a sharpening, not a precondition — a tree with no remote degrades to exactly
    // the pre-#146 behaviour instead of refusing to land.
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

  /**
   * ADR-0139: once a caller's machine checkout and target checkout are separate directories, this
   * script has to write `docs/adr/` into the *target* even though it runs from the machine — the
   * same split `run-accept.ts` drives it through in production, here staged directly against the
   * script rather than through that caller.
   */
  it("drafts and lands into the target checkout rather than the machine checkout it runs from, given TARGET_WORKSPACE", () => {
    const machine = newAdrRepo("new-adr-target-ws-machine").dir;
    const target = makeTempRepo("new-adr-target-ws-target").dir;
    const env = { TARGET_WORKSPACE: target };

    const draft = runNewAdr(machine, ["A ruling"], env);
    expect(draft).toBe(join(target, "docs/adr/draft-a-ruling.md"));
    // Nothing leaked into the machine checkout it actually ran from.
    expect(existsSync(join(machine, "docs/adr"))).toBe(false);

    const landed = runNewAdr(machine, ["--land", draft], env);
    expect(landed).toBe(join(target, "docs/adr/0001-a-ruling.md"));
    expect(existsSync(join(machine, "docs/adr"))).toBe(false);

    // The target never seeded a corpus fixture (an enrolled repository's shape, ADR-0139), so the
    // land must not create one — `regenerate && diff` only applies where the fixture already
    // exists, the same rule the gauntlet's own `clones` check applies to its baseline.
    expect(existsSync(join(target, ".Workflow"))).toBe(false);
  });
});

/**
 * `docs/adr/INDEX.md` is the second generated file under `docs/adr/`, and a land is the moment its
 * table grew a row — the same obligation this script already discharges for the corpus fixture, and
 * the one it did not (#356): the push gate went red on ADR-0147's land, on a file the tool the
 * author had just run was what invalidated.
 *
 * The generator is the machine-global `~/bin/adr-check --fix` (ADR-0097 — never vendored into a
 * consumer), so `HOME` is the seam: pointing it at a scratch home with a recorder in `bin/` is what
 * lets these assert the invocation without depending on the real tool being installed, the way
 * `generate-corpus-fixture.test.ts`'s push fixtures have to.
 */
describe("bin/new-adr --land, and the index it invalidates", () => {
  /** A scratch `$HOME` whose `bin/adr-check` records the cwd and argv it was called with, one line per call, instead of regenerating anything. */
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

  // The stubs above prove the invocation; this one proves the thing the invocation is for, against
  // the real generator. Skipped where it is not installed — a runner has no `~/bin`, exactly as
  // the gauntlet's own `adrs` check stands down there.
  const REAL_ADR_CHECK = join(process.env.HOME ?? "", "bin/adr-check");
  it.skipIf(!existsSync(REAL_ADR_CHECK))("leaves the index naming the ADR the land just numbered", () => {
    const root = repoWithAdrDir("new-adr-index-real", "");

    const landed = draftAndLand(root, ["A ruling"]);

    expect(readFileSync(join(root, "docs/adr/INDEX.md"), "utf8")).toContain(basename(landed));
  });
});
