import { describe, expect, it } from "vitest";
import { ADR_DIR, adrFiles, amendingAdrs, listed } from "./264-amending-ruling.fixture";

/**
 * #264's first acceptance criterion, verbatim from the ticket:
 *
 * - [ ] An ADR carries the amending trailer this ruling owes ADR-0100 — check: `grep -rlq 'Amends: ADR-0100' docs/adr`
 *
 * The ruling this ticket files changes the reconciler's input, which is ADR-0100's mechanism, so it
 * owes ADR-0100 an amending trailer. The record itself is the subject here — there is no module to
 * run — so the test reads `docs/adr` the way the criterion's own `grep -r` does.
 */
describe("#264 — the ruling amending ADR-0100", () => {
  it("An ADR carries the amending trailer this ruling owes ADR-0100 — check: `grep -rlq 'Amends: ADR-0100' docs/adr`", () => {
    const records = adrFiles();
    const amending = amendingAdrs("ADR-0100");

    expect(
      amending.length,
      `no record under ${ADR_DIR} carries the literal text "Amends: ADR-0100" ` +
        `(${records.length} record(s) read)`,
    ).toBeGreaterThan(0);

    // "Trailer": the amendment is declared on a line of its own rather than mentioned mid-sentence.
    // A list marker or a blockquote prefix is still a trailer line; prose that happens to contain
    // the words is not, and a reader who has to find what a ruling amends should not have to.
    const trailer = /^[>\s]*(?:[-*]\s*)?Amends:\s*ADR-0100\b/m;
    const carriers = amending.filter((file) => trailer.test(file.text));

    expect(
      carriers.length,
      `"Amends: ADR-0100" appears in ${listed(amending)}, but on no line that begins the ` +
        `declaration — the amendment is not carried as a trailer`,
    ).toBeGreaterThan(0);
  });
});
