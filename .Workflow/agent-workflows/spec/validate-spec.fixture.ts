import type { SpecBodyValidator } from "./validate-spec";

/**
 * A `SpecBodyValidator` that accepts everything, for the suites that drive `publishSpec` and
 * `runSpecPublication` over fixture drafts.
 *
 * Those suites are about the write sequence — the create, the label, the gate, the dispatch — and
 * their drafts are one-line prose stubs on purpose. The real validator would refuse every one of
 * them, and giving each a well-formed criterion instead would not fix it: `validate("spec", …)`
 * *runs* the criterion's check command (ADR-0130), so a hermetic unit test would start spawning
 * processes to assert something it is not about.
 *
 * The real one is driven where it belongs, against bodies chosen for it, in
 * `validate-spec.proc.test.ts`.
 *
 * @fixture Reached only from the suites, by design.
 */
export const NO_VALIDATION: SpecBodyValidator = () => [];
