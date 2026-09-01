import { describe, expect, it } from "vitest";
import { amendingAdrs, names } from "./264-amending-ruling.fixture";

/**
 * #264's fourth acceptance criterion, verbatim from the ticket:
 *
 * - [ ] The amending ruling lands no amendment on the twice-superseded ADR-0062 — check: `! grep -rq '^amends:.*ADR-0062' docs/adr`
 *
 * ADR-0062 is superseded by ADR-0085 and ADR-0085 by ADR-0100, so an amendment landed on it reaches
 * no reader — which is the mistake this spec's own predecessor made.
 *
 * The criterion is a property of the finished record, so the first assertion is that the finished
 * record exists: a ruling that was never filed cannot have filed its amendment in the wrong place,
 * and a bare negative grep would report that as success. The claim under test is *this ruling landed
 * and it landed nowhere near ADR-0062*, not *docs/adr is quiet*.
 */
describe("#264 — the ruling amending ADR-0100", () => {
  it("The amending ruling lands no amendment on the twice-superseded ADR-0062 — check: `! grep -rq '^amends:.*ADR-0062' docs/adr`", () => {
    expect(
      amendingAdrs("ADR-0100").length,
      'no record under docs/adr carries "amends: ADR-0100" — the amending ruling has not been ' +
        "filed, so where it landed its amendments is not yet observable",
    ).toBeGreaterThan(0);

    const misfiled = amendingAdrs("ADR-0100").filter((f) => /^amends:.*\bADR-0062\b/m.test(f.text));

    expect(
      names(misfiled),
      "an amendment is landed on ADR-0062, which is superseded by ADR-0085 and ADR-0085 by " +
        "ADR-0100, so it reaches no reader",
    ).toEqual([]);
  });
});
