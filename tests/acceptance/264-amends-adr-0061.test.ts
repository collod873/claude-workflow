import { describe, expect, it } from "vitest";
import { amendingAdrs, listed } from "./264-amending-ruling.fixture";

/**
 * #264's second acceptance criterion, verbatim from the ticket:
 *
 * - [ ] That same ADR names ADR-0061 among what it amends — check: `grep -rlZ '^amends:.*ADR-0100' docs/adr | xargs -r0 grep -lq 'ADR-0061'`
 *
 * ADR-0061's mark-accounting arithmetic keeps its input and loses its gate under this ruling, so the
 * ruling amends it too. The check pipes the ADR-0100 amenders into a second `grep`, and a `grep -lq`
 * handed several files exits clean when any one of them matches — so the claim being asserted is
 * that at least one of the records amending ADR-0100 also names ADR-0061.
 */
describe("#264 — the ruling amending ADR-0100", () => {
  it("That same ADR names ADR-0061 among what it amends — check: `grep -rlZ '^amends:.*ADR-0100' docs/adr | xargs -r0 grep -lq 'ADR-0061'`", () => {
    const amending = amendingAdrs("ADR-0100");

    expect(
      amending.length,
      'no record under docs/adr carries "amends: ADR-0100", so there is no ruling to check for ' +
        "ADR-0061 — the amending ruling has not been filed",
    ).toBeGreaterThan(0);

    const naming = amending.filter((file) => file.text.includes("ADR-0061"));

    expect(
      naming.length,
      `the record(s) amending ADR-0100 (${listed(amending)}) never mention ADR-0061, so the ` +
        "ruling does not name it among what it amends",
    ).toBeGreaterThan(0);
  });
});
