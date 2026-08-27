import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The ADR-corpus fixture generator (spec #134, ticket #140), reusing ADR-0056's
 * `regenerate && diff` pattern this file's neighbour, `generate-contract.ts`, established.
 * `adr-corpus.evidence.json` is `missing-trailer.test.ts`'s captured snapshot of this repo's own
 * record — the corpus `missing-trailer-counter.ts` walks fresh at runtime via its own
 * `readAdrCorpus`/`readResearchCorpus`. This file reproduces that reading logic rather than
 * importing it: `missing-trailer-counter.ts` imports `../shared/gh.ts` by an extensionless
 * specifier that `tsx` resolves and plain `node` does not, and this generator has to run under
 * plain `node` the same way `generate-contract.ts` does — `bin/gauntlet push` spawns it directly,
 * with no `tsx` in between. The two reading functions below have to keep walking the corpus
 * exactly the way the counter's do, or the fixture stops describing what the counter actually
 * sees; they are a second copy for a module-resolution reason, not a design choice.
 *
 * Two shapes in the one file, because the code under test reads them differently (PRD #134's "The
 * fixture holds preambles and is generated"): an ADR's `body` is stored **whole**, because
 * `hasAmendsTrailer`, `hasSupersessionVerb` and `lowerNumberedAdrLinks` (`missing-trailer.ts`) each
 * read the whole thing. A research note's `body` is trimmed to its **preamble** — everything
 * before the first `##` section — because `hasResolvesPointer` slices there before its own regex
 * ever runs. Trimming past that point would describe a corpus none of the code under test reads
 * that far into; trimming an ADR's body would weaken the tests that need it whole.
 */

/** Where the generated fixture lives, relative to the repo root it was generated from. */
export const CORPUS_RELATIVE_PATH = ".Workflow/agent-workflows/watchdog/adr-corpus.evidence.json";

/** One ADR as the fixture carries it — the shape `missing-trailer.ts`'s `AdrDoc` declares. */
export interface AdrDoc {
  number: number;
  filename: string;
  title: string;
  body: string;
}

/** One research note as the fixture carries it — the shape `missing-trailer.ts`'s `ResearchNote` declares. */
export interface ResearchNote {
  filename: string;
  title: string;
  body: string;
}

/** The fixture's whole shape: both corpora, exactly as `missing-trailer.test.ts` loads them. */
export interface AdrCorpusFixture {
  adrs: AdrDoc[];
  notes: ResearchNote[];
}

const ADR_FILENAME_RE = /^(\d{4})-.*\.md$/;

/** The ruling, as its title reads — the first line of the file, minus the leading `# `. Mirrors `missing-trailer-counter.ts`'s own `titleOf`. */
function titleOf(body: string): string {
  return (body.split("\n")[0] ?? "").replace(/^#\s*/, "").trim();
}

/**
 * Every numbered ADR under `adrDir`, sorted by number. Reproduces
 * `missing-trailer-counter.ts`'s `readAdrCorpus` (see this file's header for why it is a second
 * copy) with one addition: the sort. `findMissingTrailers` sorts before it files anything, so the
 * counter itself does not need `readAdrCorpus` to — but this generator's output has to be
 * byte-identical run over run, and `readdirSync`'s order is not a promise the filesystem makes.
 */
function readAdrCorpus(adrDir: string): AdrDoc[] {
  return readdirSync(adrDir)
    .filter((name) => ADR_FILENAME_RE.test(name))
    .map((filename) => {
      const match = filename.match(ADR_FILENAME_RE)!;
      const body = readFileSync(join(adrDir, filename), "utf8");
      return { number: Number(match[1]), filename, title: titleOf(body), body };
    })
    .sort((a, b) => a.number - b.number);
}

/**
 * Every research note under `researchDir`, sorted by filename — the note counterpart of
 * `readAdrCorpus` above, same reasons (reproduces `readResearchCorpus`, sorted for determinism).
 *
 * `draft-` is excluded for the reason ADR-0080 gives: a draft is not yet part of the record. An
 * ADR gets that for free, because a draft carries no number and `ADR_FILENAME_RE` above wants
 * four digits. A note's filename has no such shape to fail, so the exclusion is written out.
 */
function readResearchCorpus(researchDir: string): ResearchNote[] {
  return readdirSync(researchDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .filter((entry) => !entry.name.startsWith("draft-"))
    .map((entry) => {
      const body = readFileSync(join(researchDir, entry.name), "utf8");
      return { filename: entry.name, title: titleOf(body), body };
    })
    .sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * A research note's preamble — everything before its first `##` section. The exact slice
 * `hasResolvesPointer` (`missing-trailer.ts`) takes before its own pointer regex ever runs,
 * duplicated here for the same module-resolution reason `readAdrCorpus` above is: that function is
 * private to its module, and this one has to run under plain `node`.
 */
function preambleOnly(body: string): string {
  const firstSection = body.search(/\n##\s/);
  return firstSection === -1 ? body : body.slice(0, firstSection);
}

/**
 * Serializes an `AdrCorpusFixture` the way it is committed: two-space indent, trailing newline —
 * the same one formatting decision `generate-contract.ts`'s `serializeContract` owns for the
 * contract, made here for the corpus.
 */
export function serializeCorpusFixture(fixture: AdrCorpusFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

/**
 * Reads `root`'s `docs/adr` and `docs/research`, trims every note to its preamble, and returns the
 * text that belongs at `<root>/${CORPUS_RELATIVE_PATH}`.
 */
export function generateCorpusFixture(root: string): string {
  const adrs = readAdrCorpus(join(root, "docs/adr"));
  const notes = readResearchCorpus(join(root, "docs/research")).map((note) => ({
    ...note,
    body: preambleOnly(note.body),
  }));
  return serializeCorpusFixture({ adrs, notes });
}

/** Generates `root`'s corpus fixture fresh and writes it to `<root>/${CORPUS_RELATIVE_PATH}`. */
export function writeCorpusFixture(root: string): void {
  writeFileSync(join(root, CORPUS_RELATIVE_PATH), generateCorpusFixture(root));
}

/**
 * Every filename where a fresh generation of `root`'s corpus disagrees with `committedPath`'s
 * content — added, removed, or changed, by corpus (`adrs`/`notes`) and filename. Kept separate
 * from the byte comparison `diffCorpusFixture` actually gates on, the same split
 * `generate-contract.ts`'s `describeMismatch` makes: a byte diff is what `regenerate && diff`
 * means, and a per-document readout is only for whoever has to fix it. Keyed on filename rather
 * than a fixed slot name, because a corpus is a set of documents growing and shrinking, not a
 * fixed schema the way a check contract is.
 */
function describeMismatch(committedText: string, freshText: string, root: string): string {
  const lines = [
    `stale against a fresh generation from ${root} — the committed corpus fixture no longer`,
    "matches the ADR and research-note directories it was captured from. Regenerate it:",
    `  node .Workflow/agent-workflows/shared/generate-corpus-fixture.ts ${root}`,
    "",
  ];

  try {
    const committed = JSON.parse(committedText) as AdrCorpusFixture;
    const fresh = JSON.parse(freshText) as AdrCorpusFixture;
    for (const kind of ["adrs", "notes"] as const) {
      const before = new Map(committed[kind].map((doc) => [doc.filename, doc]));
      const after = new Map(fresh[kind].map((doc) => [doc.filename, doc]));
      for (const filename of after.keys()) {
        if (!before.has(filename)) lines.push(`+ ${kind}: ${filename}`);
      }
      for (const filename of before.keys()) {
        if (!after.has(filename)) lines.push(`- ${kind}: ${filename}`);
      }
      for (const [filename, doc] of after) {
        const prior = before.get(filename);
        if (prior && JSON.stringify(prior) !== JSON.stringify(doc)) {
          lines.push(`~ ${kind}: ${filename}`);
        }
      }
    }
  } catch {
    // Not even parseable as an AdrCorpusFixture — the byte diff above is the whole story, and a
    // per-document readout would just be a second, worse way of saying that.
    lines.push("--- committed and fresh could not both be parsed as an AdrCorpusFixture ---");
  }

  return lines.join("\n");
}

/**
 * `regenerate && diff` (ADR-0056), as one call for the corpus fixture: generates `root`'s corpus
 * fresh and compares it byte-for-byte against whatever text already sits at `committedPath`.
 * Returns `undefined` when they match, or a human-readable report of the mismatch when they
 * don't — never throws on a mismatch, since that is the expected, well-formed result of a corpus
 * that has drifted from its own fixture.
 */
export function diffCorpusFixture(root: string, committedPath: string): string | undefined {
  const fresh = generateCorpusFixture(root);
  const committed = readFileSync(committedPath, "utf8");
  if (fresh === committed) return undefined;
  return describeMismatch(committed, fresh, root);
}

// --- CLI -------------------------------------------------------------------------------------
//
// `node generate-corpus-fixture.ts <root>`                    regenerates <root>/<CORPUS_RELATIVE_PATH> in place.
// `node generate-corpus-fixture.ts diff <root> <fixturePath>`  exits 1 and prints the mismatch when
//                                                               <fixturePath> disagrees with a fresh
//                                                               generation of <root>, exits 0 when
//                                                               they match. This is the mode
//                                                               `bin/gauntlet push` runs.
//
// Guarded with `pathToFileURL(process.argv[1])`, never a hand-built `file://${argv[1]}` — the
// same defect `generate-contract.ts`'s own guard exists to avoid (#139): the latter loses
// percent-encoding on a path with a space, which is this repo's own real checkout path, and would
// make this guard silently never fire there.
const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const args = process.argv.slice(2);
  if (args[0] === "diff") {
    const [, root, committedPath] = args;
    if (!root || !committedPath) {
      console.error("usage: generate-corpus-fixture.ts diff <root> <fixturePath>");
      process.exit(2);
    }
    const mismatch = diffCorpusFixture(root, committedPath);
    if (mismatch) {
      console.log(mismatch);
      process.exit(1);
    }
    process.exit(0);
  } else {
    const root = args[0] ?? process.cwd();
    writeCorpusFixture(root);
  }
}
