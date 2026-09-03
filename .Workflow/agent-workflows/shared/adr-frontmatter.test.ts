import { describe, expect, it } from "vitest";

import { frontmatterBlock, withReversal } from "./adr-frontmatter";

const DRAFT = "---\nstatus: constraint\ndate: 2026-09-02\nreversal:\n---\n\n# A ruling\n";

describe("frontmatterBlock", () => {
  it("returns the block between the fences, and nothing from the body", () => {
    expect(frontmatterBlock(DRAFT)).toBe("status: constraint\ndate: 2026-09-02\nreversal:");
  });

  it("is undefined for a file that has none", () => {
    expect(frontmatterBlock("# A ruling\n\nProse.\n")).toBeUndefined();
  });
});

describe("withReversal", () => {
  it("fills the empty key and leaves the body untouched", () => {
    const filled = withReversal(DRAFT, "Undoing it costs a rotation across the estate.");

    expect(filled).toBe(
      "---\nstatus: constraint\ndate: 2026-09-02\nreversal: Undoing it costs a rotation across the estate.\n---\n\n# A ruling\n",
    );
  });

  it("replaces a sentence already there rather than writing a second key", () => {
    const once = withReversal(DRAFT, "First.");

    expect(withReversal(once, "Second.")).toBe(withReversal(DRAFT, "Second."));
  });

  it("flattens a newline, which would otherwise end the key mid-value and eat the fence", () => {
    expect(withReversal(DRAFT, "Undoing it costs\n  a second pass.\n")).toContain(
      "reversal: Undoing it costs a second pass.",
    );
  });

  it("keeps the other keys in place, so `amends:` survives the write", () => {
    const drafted = "---\nstatus: constraint\ndate: 2026-09-02\namends: ADR-0008\nreversal:\n---\n\n# A ruling\n";

    expect(withReversal(drafted, "A cost.")).toContain("amends: ADR-0008\nreversal: A cost.");
  });

  it("throws rather than silently writing nothing when there is no frontmatter", () => {
    expect(() => withReversal("# A ruling\n", "A cost.")).toThrow(/no frontmatter block/);
  });

  it("throws when the block carries no reversal key", () => {
    expect(() => withReversal("---\nstatus: note\ndate: 2026-09-02\n---\n\n# A ruling\n", "A cost.")).toThrow(
      /no `reversal:` key/,
    );
  });
});
