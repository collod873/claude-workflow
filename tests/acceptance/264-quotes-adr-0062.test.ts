import { describe, expect, it } from "vitest";
import { amendingAdrs, listed } from "./264-amending-ruling.fixture";

/**
 * #264's third acceptance criterion, verbatim from the ticket:
 *
 * - [ ] That same ADR quotes the expired assumption from ADR-0062 — check: `grep -rlZ 'Amends: ADR-0100' docs/adr | xargs -r0 grep -lq 'ADR-0062'`
 *
 * ADR-0062 is where the uncapped-rounds assumption was written down — that the machine asked and the
 * owner is answering — and this ruling quotes it from there rather than amending it. So the record
 * that amends ADR-0100 has to cite ADR-0062, and it has to be citing it *for the assumption*: the
 * ticket's own wording is that the ruling "names the assumption that expired — that the owner
 * answers", which is what the two word checks below stand for.
 */
describe("#264 — the ruling amending ADR-0100", () => {
  it("That same ADR quotes the expired assumption from ADR-0062 — check: `grep -rlZ 'Amends: ADR-0100' docs/adr | xargs -r0 grep -lq 'ADR-0062'`", () => {
    const amending = amendingAdrs("ADR-0100");

    expect(
      amending.length,
      'no record under docs/adr carries "Amends: ADR-0100", so nothing quotes ADR-0062 — the ' +
        "amending ruling has not been filed",
    ).toBeGreaterThan(0);

    const citing = amending.filter((file) => file.text.includes("ADR-0062"));

    expect(
      citing.length,
      `the record(s) amending ADR-0100 (${listed(amending)}) never cite ADR-0062, so the expired ` +
        "assumption is not quoted from where it was written",
    ).toBeGreaterThan(0);

    // Citing ADR-0062 in passing is not quoting the assumption it recorded. The ruling names the
    // assumption that expired — that the owner answers — so the record that cites ADR-0062 says
    // both words somewhere.
    const naming = citing.filter(
      (file) => /assumption/i.test(file.text) && /owner/i.test(file.text),
    );

    expect(
      naming.length,
      `the record(s) citing ADR-0062 (${listed(citing)}) never say both "assumption" and "owner", ` +
        "so the citation does not carry the expired assumption it is quoting",
    ).toBeGreaterThan(0);
  });
});
