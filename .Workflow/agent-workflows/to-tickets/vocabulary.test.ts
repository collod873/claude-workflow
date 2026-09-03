import { describe, expect, it } from "vitest";
import { promptHandedTo } from "./checkpoint.fixture";
import { STAGES, vocabulary, type StageName } from "./to-tickets";

/**
 * `vocabulary.md` is a **copy** — six of `CONTEXT.md`'s entries, inlined into every to-tickets
 * prompt so no stage reads `CONTEXT.md` (ADR-0082). The half of that ruling a prompt edit can
 * quietly undo: every stage takes its vocabulary by injection, and none of them goes and reads
 * one. `runStage` already fails a stage whose prompt names a `{{VAR}}` nothing supplies, so the
 * placeholder half is enforced at run time — but nothing at run time notices a prompt that
 * *stopped* naming it, or one that grew a `Read CONTEXT.md first` line back. Both are one sentence
 * to write and produce no error, which is what makes them worth a test — asserted on the prompt
 * each stage was actually handed, rendered through the real stage over a fake model.
 */
describe("no to-tickets stage reads CONTEXT.md", () => {
  // `Object.keys(STAGES)`, not a list that could fall behind it.
  it.each(Object.keys(STAGES) as StageName[])("%s takes the vocabulary by injection", async (stage) => {
    const prompt = await promptHandedTo(stage);

    expect(prompt).toContain(vocabulary());
    expect(prompt).not.toContain("CONTEXT.md");
    expect(prompt).not.toContain("{{");
  });

  /**
   * What a stage is handed is prompt *plus* the injected vocabulary, and `vocabulary.md`'s own
   * header argues at length about `CONTEXT.md` — it has to, to explain itself to the next reader.
   * That header is exactly what `vocabulary()`'s `---` split exists to withhold: a header that
   * grew past the rule, or a rule that got deleted, puts the pointer back into every stage's
   * context and nothing else notices.
   */
  it("withholds the vocabulary file's own header, which names CONTEXT.md", () => {
    expect(vocabulary()).not.toContain("CONTEXT.md");
    expect(vocabulary()).toContain("**Slice**:");
  });
});
