import { describe, expect, it } from "vitest";
import { amendingAdrs, listed } from "./264-amending-ruling.fixture";

/**
 * #342's fifth criterion: one filed record amends both ADR-0140 and ADR-0142, and says what the
 * amendment is — that the committed venue half is written by lane 05's push-venue run on the
 * runner, and why a Verify run may still not write.
 *
 * The record directory is read rather than imported, which is what a `grep -l '^amends: ADR-0142'
 * docs/adr/*.md` does too; `264-amending-ruling.fixture.ts` beside this file already owns the walk
 * and the `amends:` frontmatter match, so it is imported rather than restated. That reader matches
 * the target anywhere on the `amends:` line, so `amends: ADR-0142, ADR-0140` and a line naming one
 * predecessor each are both found — the criterion is about the edges recorded, not their order.
 *
 * The content assertions are deliberately tolerant of wording and strict about subject: the record
 * has to name lane 05, the push venue, and a Verify run. That is the sentence the criterion asks
 * for, and an implementer reading the same sentence writes those three things; what it does not do
 * is pin a title, a number or a phrasing the ticket left open.
 */

describe("#342 a filed ruling amends both ADR-0140 and ADR-0142", () => {
  // An ADR amending ADR-0140 and ADR-0142 records that the committed venue half is written by lane
  it("05's push-venue run on the runner, and why a Verify run may still not write", () => {
    const amends0142 = amendingAdrs("ADR-0142");
    const amends0140 = amendingAdrs("ADR-0140");
    const both = amends0142.filter((record) =>
      amends0140.some((other) => other.absolute === record.absolute),
    );

    const edgeReport =
      both.length > 0
        ? ""
        : `no record amends both: ADR-0142 is amended by ${listed(amends0142)}, ` +
          `ADR-0140 by ${listed(amends0140)}`;
    expect(edgeReport).toBe("");

    const recording = both.filter(
      (record) =>
        /lane 05/i.test(record.text) &&
        /push[- ]venue/i.test(record.text) &&
        /verify/i.test(record.text),
    );

    const bodyReport =
      recording.length > 0
        ? ""
        : `${listed(both)} amends both rulings but names no lane 05 push-venue run on the ` +
          `runner, or does not say why a Verify run may still not write`;
    expect(bodyReport).toBe("");
  });
});
