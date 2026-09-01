import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AUTHOR_PROMPT_PATH } from "../acceptance";

/**
 * The load-bearing prose of lane 04's author prompt, pinned.
 *
 * Every rule asserted here is one whose failure lands somewhere other than this lane: a criterion
 * quoted anywhere but a comment fails the *implementer's* pull request, an assertion on the
 * immutable set fires the repair loop against an implementer who is not wrong, and a duplicated
 * reader is absorbed into the clone baseline with nobody told. A paraphrase edit that keeps each
 * idea but drops the clause carrying the mechanism would still read well — this is what catches it.
 *
 * Pinned as terms rather than as whole authored sentences (the shape `241`'s acceptance test uses
 * on lane 01's two prompts): the prose is the owner's to rewrite, the mechanism is not.
 */

const prompt = readFileSync(AUTHOR_PROMPT_PATH, "utf8");

/** The `## …` section whose heading matches `re`, from its heading to the next one. */
function section(re: RegExp): string | undefined {
  return prompt.split(/^## /m).find((block) => re.test(block.slice(0, block.indexOf("\n"))));
}

describe("the acceptance author's prompt carries the rules its gates depend on", () => {
  it("renders the extracted criteria rather than leaving the author to parse the body", () => {
    // `acceptance.ts` supplies these; `shared/stage.ts` throws on a placeholder no var covers, so a
    // prompt that stopped naming them would be a wiring failure rather than a silent regression.
    expect(prompt).toContain("{{CRITERIA}}");
    expect(prompt).toContain("{{CRITERIA_COUNT}}");
  });

  it("tells the author the trailing check marker is part of the criterion string", () => {
    const criteria = section(/criteria/i);
    expect(criteria, "no criteria section found").toBeDefined();
    expect(criteria as string).toMatch(/check:/);
    expect(criteria as string).toMatch(/part of the string|marker.*is part|trailing/i);
  });

  it("requires the criterion in a comment, not merely in the test's name", () => {
    expect(prompt).toMatch(/whole block, verbatim, in a comment/i);
    // The `it(...)` name is explicitly allowed to shorten — the pair is the point, and a rewrite
    // that made the name sufficient again would re-open what `affected-tests.ts` greps for.
    expect(prompt).toMatch(/the comment may not/i);
  });

  it("names the immutable set as the thing never to assert on, and says the check reads code", () => {
    const immutable = section(/immutable set/i);
    expect(immutable, "no immutable-set section found").toBeDefined();
    expect(immutable as string).toMatch(/vitest\.config\.ts/);
    expect(immutable as string).toMatch(/\.github\//);
    // Without this sentence the author has no way to reconcile "quote the criterion verbatim" with
    // "never name these paths" for a criterion whose own check marker names a workflow file.
    expect(immutable as string).toMatch(/code.*not.*comments/i);
  });

  it("states the real cost of duplicating a reader, which is the baseline and not a refusal", () => {
    const fixture = section(/fixture/i);
    expect(fixture, "no fixture section found").toBeDefined();
    expect(fixture as string).toMatch(/baseline/i);
    expect(fixture as string).toMatch(/nobody is told|nobody outside this lane/i);
  });

  it("keeps the import boundary scoped to relative paths, which is what the rule checks", () => {
    expect(prompt).toMatch(/may import a relative path outside/i);
    expect(prompt).toContain("acceptance-boundary/no-outside-import");
  });

  it("closes on a coverage check rather than on the last criterion written", () => {
    const closing = section(/before you answer/i);
    expect(closing, "no closing coverage section found").toBeDefined();
    expect(closing as string).toMatch(/every number has a file/i);
  });

  it("shows the criterion comment in the worked example, not just in the rule", () => {
    const skeleton = /```structured-output\n([\s\S]*?)\n```/.exec(prompt);
    expect(skeleton, "no structured-output skeleton found").not.toBeNull();
    const files = (JSON.parse((skeleton as RegExpExecArray)[1]) as { files: { content: string }[] }).files;
    expect(files.length).toBeGreaterThan(0);
    // The example is the only concrete model in the prompt. It showed a bare `it(...)` name for as
    // long as the rule offered "name or comment", which is exactly the shape the grep cannot find.
    expect(files[0].content).toMatch(/\/\/ - \[ \]/);
  });
});
