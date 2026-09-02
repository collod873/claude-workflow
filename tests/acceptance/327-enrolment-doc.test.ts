import { describe, expect, it } from "vitest";
import { ENROLMENT_DOC, ENROLMENT_DOC_RELATIVE, enrolmentDoc, presence } from "./327-enrol.fixture";

/** The rulings the criterion says the document has to name. */
const RULINGS = ["ADR-0133", "ADR-0132", "ADR-0093"];

describe("#327 — the enrolment document", () => {
  // `docs/agents/enrolment.md` states what an enrolled repository receives and what the topic
  it("names the topic, what a target receives, and the rulings behind it", () => {
    expect(presence(ENROLMENT_DOC_RELATIVE, ENROLMENT_DOC)).toBe("present");

    const doc = enrolmentDoc();

    // The topic — the criterion's own `grep`.
    expect(doc).toContain("claude-workflow-enrolled");
    expect(doc).toMatch(/topic/i);

    // What an enrolled repository receives: the labels, the setting, the secrets.
    expect(doc).toMatch(/label/i);
    expect(doc).toMatch(/secret/i);
    expect(doc).toMatch(/approve|permission|setting/i);

    const missing = RULINGS.filter((ruling) => !doc.includes(ruling));
    expect(missing).toEqual([]);
  });
});
