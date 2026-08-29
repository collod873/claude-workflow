import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "./workflow-shape.fixture";

/**
 * #241 — "Codify the tracer rule and the owner's check-sentence in the two prompts".
 *
 * The ticket carries exactly one acceptance criterion, quoted verbatim as this file's `describe`
 * title and repeated here so a checker can match it character-for-character:
 *
 *   Both prompts carry the new prose, pinned by new tests — check: `npx vitest run
 *   .Workflow/agent-workflows/to-tickets/slice/prompt.test.ts
 *   .Workflow/agent-workflows/spec/author/prompt.test.ts`
 *
 * Two prompts and two pinning tests, so this file asks four things of the delivered work: the
 * slicer's prompt states the wave-0-is-a-tracer rule, the spec author's prompt carries the owner's
 * check-sentence as a third non-negotiable, and each of the two claimed `prompt.test.ts` files
 * exists and actually pins the prose of the prompt beside it.
 *
 * The assertions are on the prose's load-bearing terms rather than on one authored sentence: the
 * PRD leaves the choice between "wave 0" and "unblocked root" to the slice that writes the prompt,
 * so both are accepted, and nothing here demands a phrasing the ticket did not fix.
 */

const CRITERION =
  "Both prompts carry the new prose, pinned by new tests — check: `npx vitest run .Workflow/agent-workflows/to-tickets/slice/prompt.test.ts .Workflow/agent-workflows/spec/author/prompt.test.ts`";

const SLICE_PROMPT = ".Workflow/agent-workflows/to-tickets/slice/prompt.md";
const SLICE_PIN = ".Workflow/agent-workflows/to-tickets/slice/prompt.test.ts";
const AUTHOR_PROMPT = ".Workflow/agent-workflows/spec/author/prompt.md";
const AUTHOR_PIN = ".Workflow/agent-workflows/spec/author/prompt.test.ts";

/** A repo-relative file's text. */
function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

/** Whether a repo-relative path exists at all — the pinning tests are new files. */
function exists(rel: string): boolean {
  return fs.existsSync(path.join(repoRoot, rel));
}

/**
 * The first sentence-or-line of `text` matching `re`.
 *
 * Sentences rather than the whole file, because "never a wiring slice" and "a wiring slice is
 * fine" both contain the word: the negation has to sit next to the thing being rejected, and a
 * whole-file match cannot tell those apart.
 */
function sentenceWith(text: string, re: RegExp): string | undefined {
  return text.split(/(?<=[.!?])\s+|\n/).find((sentence) => re.test(sentence));
}

/** The `## …` section whose heading matches `re`, heading line included, up to the next `## `. */
function section(markdown: string, re: RegExp): string | null {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => /^##\s/.test(line) && re.test(line));
  if (start === -1) return null;
  const body = [lines[start]];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n");
}

describe(CRITERION, () => {
  describe("the slicer's prompt states the wave-0-is-a-tracer rule", () => {
    it("names the first wave, as either `wave 0` or the graph validator's `unblocked root`", () => {
      expect(read(SLICE_PROMPT)).toMatch(/wave 0|unblocked root/i);
    });

    it("defines that wave as the thinnest end-to-end path through every layer", () => {
      const prompt = read(SLICE_PROMPT);
      expect(prompt).toMatch(/thinnest/i);
      expect(prompt).toMatch(/end[-\s]to[-\s]end/i);
      expect(prompt).toMatch(/\blayer/i);
    });

    it("says stubs are permitted and expected there", () => {
      expect(read(SLICE_PROMPT)).toMatch(/stub/i);
    });

    it("rejects a wiring slice as the first wave", () => {
      const rejection = sentenceWith(read(SLICE_PROMPT), /wiring/i);
      expect(rejection, "no sentence in the slicer's prompt mentions a wiring slice").toBeDefined();
      expect(rejection as string).toMatch(/\bnever\b|\bnot\b|\bno\b/i);
    });

    it("rejects a bare seam slice as the first wave", () => {
      const rejection = sentenceWith(read(SLICE_PROMPT), /bare seam/i);
      expect(rejection, "no sentence in the slicer's prompt mentions a bare seam slice").toBeDefined();
      expect(rejection as string).toMatch(/\bnever\b|\bnot\b|\bno\b/i);
    });
  });

  describe("the spec author's prompt carries the owner's check-sentence as a third non-negotiable", () => {
    it("no longer heads that section as holding two rules", () => {
      const heading = read(AUTHOR_PROMPT)
        .split("\n")
        .find((line) => /^##\s.*non-negotiable/i.test(line));
      expect(heading, "the spec author's prompt has no non-negotiables heading").toBeDefined();
      expect(heading as string).not.toMatch(/\btwo\b/i);
    });

    it("states three rules in that section, not two", () => {
      const nonNegotiables = section(read(AUTHOR_PROMPT), /non-negotiable/i);
      expect(nonNegotiables, "the spec author's prompt has no non-negotiables section").not.toBeNull();
      // Each rule opens a paragraph with its bolded one-sentence statement, at column 0.
      const rules = (nonNegotiables as string).split("\n").filter((line) => /^\*\*/.test(line));
      expect(rules.length).toBeGreaterThanOrEqual(3);
    });

    it("quotes the owner's \"I'll know it works when I can ___\" sentence", () => {
      expect(read(AUTHOR_PROMPT)).toMatch(/I['’]ll know it works when I can/);
    });

    it("says that sentence becomes the spec's single check-marked criterion", () => {
      const nonNegotiables = section(read(AUTHOR_PROMPT), /non-negotiable/i);
      expect(nonNegotiables, "the spec author's prompt has no non-negotiables section").not.toBeNull();
      const thirdRule = (nonNegotiables as string).slice(
        (nonNegotiables as string).search(/I['’]ll know it works when I can/),
      );
      expect(thirdRule).toMatch(/check:/);
      expect(thirdRule).toMatch(/criteri(on|a)/i);
      expect(thirdRule).toMatch(/single|exactly one|\bone\b/i);
    });

    it("tells an author who cannot mechanise it to raise an open question instead of inventing a command", () => {
      const nonNegotiables = section(read(AUTHOR_PROMPT), /non-negotiable/i);
      expect(nonNegotiables, "the spec author's prompt has no non-negotiables section").not.toBeNull();
      const thirdRule = (nonNegotiables as string).slice(
        (nonNegotiables as string).search(/I['’]ll know it works when I can/),
      );
      expect(thirdRule).toMatch(/open question/i);
    });
  });

  describe("both additions are pinned by the new tests the check runs", () => {
    it("ships the slicer's pinning test, asserting against the prompt beside it", () => {
      expect(exists(SLICE_PIN), `${SLICE_PIN} does not exist`).toBe(true);
      const pin = read(SLICE_PIN);
      expect(pin).toMatch(/prompt\.md/);
      expect(pin).toMatch(/expect\(/);
      expect(pin).toMatch(/wave 0|unblocked root|thinnest|stub|wiring|bare seam/i);
    });

    it("ships the spec author's pinning test, asserting against the prompt beside it", () => {
      expect(exists(AUTHOR_PIN), `${AUTHOR_PIN} does not exist`).toBe(true);
      const pin = read(AUTHOR_PIN);
      expect(pin).toMatch(/prompt\.md/);
      expect(pin).toMatch(/expect\(/);
      expect(pin).toMatch(/I['’]ll know it works when I can|non-negotiable/i);
    });
  });
});
