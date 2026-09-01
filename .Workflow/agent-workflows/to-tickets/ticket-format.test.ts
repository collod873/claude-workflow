import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ticketFormat } from "./to-tickets";

/**
 * §3 of #226: the ticket contract is written down once, in
 * `docs/agents/ticket-format.md`, and every producer takes it by injection
 * rather than restating it — the restatement is exactly what let
 * `/wayfinder`'s template drift out of sync with the parser it feeds. This
 * pins the slice stage's half of that: the prompt names a `{{TICKET_FORMAT}}`
 * placeholder rather than spelling the grammar itself, `buildVars` supplies
 * it from the doc, and the two restatements #304 found (the check-marker
 * grammar in rule 5, the rooted-path rule in rule 7) are gone.
 */

function read(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const SLICE_PROMPT_PATH = "to-tickets/slice/prompt.md";
const OUTPUT_CONTRACT_PATH = "to-tickets/references/output-contract.md";

describe("the slicer takes the ticket contract by injection", () => {
  it("names a {{TICKET_FORMAT}} placeholder in its prompt", () => {
    expect(read(SLICE_PROMPT_PATH)).toContain("{{TICKET_FORMAT}}");
  });

  it("ticketFormat() reads docs/agents/ticket-format.md's spec-sub-issue variant", () => {
    const format = ticketFormat();
    expect(format).toContain("### Spec sub-issue");
    expect(format).toContain("## Acceptance criteria");
    expect(format).toContain("## Files claimed");
    // Never a variant this lane doesn't publish.
    expect(format).not.toContain("Local-file ticket");
    expect(format).not.toContain("Wayfinder decision");
  });

  it("the prompt's own restatement of the check-marker grammar is gone", () => {
    const prompt = read(SLICE_PROMPT_PATH);
    // Rule 5 used to spell the em-dash/check:/backtick grammar and the
    // gh/curl/wget ban itself — both now live only in the injected contract.
    expect(prompt).not.toMatch(/An em dash, the word `check:`/);
    expect(prompt).not.toMatch(/gh api.*gh issue.*gh pr.*gh run.*curl.*wget/s);
  });

  it("the prompt's own restatement of the rooted-path rule is gone", () => {
    const prompt = read(SLICE_PROMPT_PATH);
    // Rule 7 used to spell out "the full path from the repository root,
    // always" itself — that sentence now lives only in the injected contract.
    expect(prompt).not.toMatch(/carries the full path from the repository root, always/);
  });
});

describe("the output contract no longer restates ticket-shape rules", () => {
  it("carries no dependsOn indexing, filesClaimed, or technical-scope restatement", () => {
    const contract = read(OUTPUT_CONTRACT_PATH);
    // The old restatements, verbatim — a return of any one of these is the
    // drift this test exists to catch.
    expect(contract).not.toMatch(/1-based indices naming earlier positions only/i);
    expect(contract).not.toMatch(/Array of relative file paths modified by the slice/i);
    expect(contract).not.toMatch(/Issue lifecycle directives \(`Closes`\) are handled by external automation/i);
  });
});
