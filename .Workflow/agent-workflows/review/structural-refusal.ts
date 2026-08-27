import { PATH_LINE_RE } from "../shared/ticket-shape";

/**
 * The gate ahead of lane 07's refuter: [ADR-0036](../../../docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md) —
 * *a finding a green gate already covers is refused before any refuter reads
 * it.*
 *
 * Lane 07 fires on CI green, which means lint, typecheck, the test suite,
 * and lane 04's immutable acceptance tests have already run against this
 * diff and said nothing. A finding restating one of those verdicts is noise
 * by construction, and ruling it out takes no judgement — it is a lookup
 * against artifacts that already exist, not a question for a model.
 * [ADR-0010](../../../docs/adr/0010-every-gate-fires-at-the-earliest-venue-that-can-run-it.md):
 * the earliest venue that can run this check is before the model call, its
 * budget is microseconds, and what earliest buys is that the expensive
 * refuter stage never sees the item at all.
 *
 * This deliberately is not a model judging "is this already covered?" — the
 * ADR rejected that: a model asked to do a lookup will occasionally be
 * creative about it, and a filter that is wrong in the *drop* direction
 * loses findings silently. Both conditions below are plain string matching.
 */

/**
 * A raw finding, as a reviewer stage writes it, before any refuter reads it.
 *
 * One field on purpose: `message` is the only thing this gate reads, and it
 * reads it the same way a person would — by looking for a `path:line` and
 * for the name of a check that already ran. A later stage may attach more
 * to a finding once it survives this gate; nothing here needs it to.
 */
export interface Finding {
  /** The finding's own text, exactly as the reviewer wrote it. */
  message: string;
}

/**
 * The name of one check a green CI run already carries — an
 * `eslint.config.js` rule id, a type error, a named test, or an acceptance
 * criterion already checked off. [ADR-0036](../../../docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md)
 * lists exactly these four kinds; nothing here distinguishes between them,
 * because the refusal is the same lookup regardless of which kind matched.
 */
export type GreenGateCheck = string;

/** `PATH_LINE_RE`, made global so every citation in a finding is found, not just the first. */
const PATH_LINE_RE_G = new RegExp(PATH_LINE_RE.source, "g");

/**
 * Whether `finding` names at least one `path:line` that actually appears in
 * `diff` — the evidence shape `shared/ticket-shape.ts`'s `PATH_LINE_RE`
 * already enforces on a closing record, reused rather than reinvented here.
 *
 * A finding that cites no `path:line` at all has pointed at nothing in the
 * diff under review, and neither has one that cites a `path:line` the diff
 * does not contain — a hallucinated or stale location is not evidence.
 */
function citesLocationInDiff(finding: Finding, diff: string): boolean {
  const citations = finding.message.match(PATH_LINE_RE_G) ?? [];
  return citations.some((citation) => diff.includes(citation));
}

/**
 * Whether `finding` names a check that `greenGateChecks` already lists.
 *
 * The gates that ran are named artifacts with named outputs; matching
 * against them is a lookup, not a judgement — a finding arguing with a
 * verdict already on the record names that verdict's own name to do it.
 */
function restatesAGreenCheck(finding: Finding, greenGateChecks: GreenGateCheck[]): boolean {
  return greenGateChecks.some((check) => finding.message.includes(check));
}

/**
 * `true` when `finding` should be dropped before any refuter spends a model
 * on it — it names no `path:line` inside `diff`, or it restates a check
 * `greenGateChecks` already lists. `false` means the finding survives to
 * ADR-0035's single refuter.
 */
export function isStructurallyRefused(
  finding: Finding,
  diff: string,
  greenGateChecks: GreenGateCheck[],
): boolean {
  return !citesLocationInDiff(finding, diff) || restatesAGreenCheck(finding, greenGateChecks);
}
