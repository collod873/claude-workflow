import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STAGES, vocabulary } from "./to-tickets";

const VOCABULARY_PATH = ".Workflow/agent-workflows/to-tickets/vocabulary.md";
const CONTEXT_PATH = "CONTEXT.md";

const PROMPT_PATHS = [
  ".Workflow/agent-workflows/to-tickets/seam-sweep/prompt.md",
  ".Workflow/agent-workflows/to-tickets/slice/prompt.md",
  ".Workflow/agent-workflows/to-tickets/audit/prompt.md",
];

/**
 * The blocks below `vocabulary.md`'s `---` rule, one per term. Splitting on
 * blank lines rather than matching a term pattern is deliberate: a block that
 * is *not* shaped like an entry still comes back here and fails the shape
 * assertion below, where a pattern match would silently skip it and leave it
 * unchecked against `CONTEXT.md`.
 */
function entries(vocabulary: string): string[] {
  const body = vocabulary.split(/^---$/m)[1];
  return body.split(/\n\s*\n/).map((block) => block.trim()).filter((block) => block.length > 0);
}

/**
 * `vocabulary.md` is a **copy** — six of `CONTEXT.md`'s thirty-five entries,
 * inlined into every to-tickets prompt so no stage reads `CONTEXT.md`
 * (ADR-0082). A copy drifts, and the drift is the silent kind: the lane keeps
 * slicing, in words the repo stopped using.
 *
 * So the copy is pinned rather than trusted. This is the whole reason the
 * change is safe to make, and it is worth being precise about where it runs:
 * in *this* repo, which owns `CONTEXT.md` and can therefore check the copy
 * against it. A caller repo (ADR-0055) runs neither this test nor a
 * `CONTEXT.md` of this lane's — it runs the lane, carrying the vocabulary the
 * lane was published with, which is exactly the point.
 */
describe("the lane's vocabulary is a pinned copy of CONTEXT.md's", () => {
  const vocabulary = readFileSync(VOCABULARY_PATH, "utf8");
  const context = readFileSync(CONTEXT_PATH, "utf8");

  it("holds entries, so a file that stopped parsing cannot pass by holding none", () => {
    expect(entries(vocabulary).length).toBeGreaterThan(0);
  });

  it.each(entries(vocabulary))("carries %s verbatim from CONTEXT.md", (entry) => {
    expect(entry).toMatch(/^\*\*[^*]+\*\*:\n/);
    expect(context).toContain(entry);
  });
});

/**
 * The other half of the ruling, and the half a prompt edit can quietly undo:
 * every stage takes its vocabulary by injection, and none of them goes and
 * reads one. `runStage` already fails a stage whose prompt names a `{{VAR}}`
 * nothing supplies, so the placeholder half is enforced at run time — but
 * nothing at run time notices a prompt that *stopped* naming it, or one that
 * grew a `Read CONTEXT.md first` line back. Both are one sentence to write
 * and produce no error, which is what makes them worth a test.
 */
describe("no to-tickets stage reads CONTEXT.md", () => {
  it.each(PROMPT_PATHS)("%s takes the vocabulary by injection", (path) => {
    const prompt = readFileSync(path, "utf8");

    expect(prompt).toContain("{{VOCABULARY}}");
    expect(prompt).not.toContain("CONTEXT.md");
  });

  it("checks every stage's prompt, not a list that fell behind STAGES", () => {
    expect(PROMPT_PATHS).toHaveLength(Object.keys(STAGES).length);
  });

  /**
   * The prompt files are clean by inspection; what a stage is actually handed
   * is prompt *plus* the injected vocabulary, and `vocabulary.md`'s own header
   * argues at length about `CONTEXT.md` — it has to, to explain itself to the
   * next reader. That header is exactly what `vocabulary()`'s `---` split
   * exists to withhold, so this asserts against the rendered value rather than
   * the file: a header that grew past the rule, or a rule that got deleted,
   * puts the pointer back into every stage's context and nothing else notices.
   */
  it("withholds the vocabulary file's own header, which names CONTEXT.md", () => {
    expect(vocabulary()).not.toContain("CONTEXT.md");
    expect(vocabulary()).toContain("**Slice**:");
  });
});
