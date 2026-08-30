import { describe, expect, it } from "vitest";
import {
  flagValue,
  readSource,
  sweepCall,
  SPEC_SOURCE,
  SWEEP_SOURCE,
} from "./261-spec-sweep.fixture";

/**
 * #261, criterion 3.
 *
 * ADR-0060's constraint is that this lane reaches no second source of intent, and a stage whose
 * whole job is reading the repository is the one most able to violate it by accident. The criterion
 * is about *reuse* rather than about the three names, so this asserts all three things reuse means:
 * the constant is named, the three names are not re-declared as a second literal, and the list that
 * actually reaches the argv is still exactly the author's.
 */
describe("#261 — the sweep's toolbelt", () => {
  // The sweep reads the author's exported allow-list rather than restating the tool names — check: `grep -q 'SPEC_AUTHOR_ALLOWED_TOOLS' .Workflow/agent-workflows/spec/sweep.ts`
  it("names the author's exported constant and declares no second list of the tool names", () => {
    const source = readSource(SWEEP_SOURCE);

    expect(source).toContain("SPEC_AUTHOR_ALLOWED_TOOLS");
    // The export it reads is still the author's own, in the module that documents it.
    expect(readSource(SPEC_SOURCE)).toContain("export const SPEC_AUTHOR_ALLOWED_TOOLS");

    // Prose may name the tools — a second array literal of them is the drift ADR-0060 is
    // fail-open against, so the check runs over the code with the comments taken out.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\[\s*["']Read["']/);
  });

  // The sweep reads the author's exported allow-list rather than restating the tool names — check: `grep -q 'SPEC_AUTHOR_ALLOWED_TOOLS' .Workflow/agent-workflows/spec/sweep.ts`
  it("reaches the CLI with exactly the author's three tools and no disallowedTools", () => {
    const argv = sweepCall().argv;

    expect(flagValue(argv, "--allowedTools")).toBe("Read,Grep,Glob");
    expect(argv).not.toContain("--disallowedTools");
  }, 600_000);
});
