import type { PriorArt, Sweep } from "./sweep-schema";

/**
 * Lane 01's stage-1 refusal, as a rule rather than a judgement.
 *
 * `DESIGN.md` §01: *at stage 1, an idea that already exists or that an ADR
 * has already ruled on — the chain stops there and never spends the shaper.*
 * The evidence for that lives in the tracker and in `docs/adr/`, which means
 * a model has to read it; the *verdict* is
 * [ADR-0014](../../../docs/adr/0014-a-model-may-translate-evidence-into-a-gate-s-grammar-but-nev.md)'s
 * — the sweep translates what it found into `sweep-schema.ts`'s grammar, and
 * this function decides. Nothing the sweep says is itself a refusal.
 *
 * **What the grammar checks that a prompt could not.** A `duplicate` verdict
 * must cite an issue and a `ruled` verdict must cite an ADR. A sweep that
 * says `{verdict: "ruled", ref: "#42"}` has not found a ruling, whatever it
 * believes, and this refuses to refuse on it — the citation shape is the
 * evidence, and an unevidenced kill is the one outcome this lane cannot take
 * back cheaply. That is the same instinct as the close gate's
 * `bad-evidence-shape`: a salvaged record that claims MET with nothing
 * shaped like evidence is refused exactly as a person's would be.
 */

/** A `duplicate` must cite an issue; `#42` is the only shape that is one. */
const ISSUE_REF = /^#\d+$/;

/** A `ruled` must cite a ruling; `ADR-0007` is the only shape that is one. */
const ADR_REF = /^ADR-\d{4}$/;

export interface Refusal {
  /** `already-exists` or `already-ruled` — the two §01 names, as slugs. */
  cause: "already-exists" | "already-ruled";
  /** The prior art that carried the verdict, for the comment that reports it. */
  evidence: PriorArt;
}

/**
 * The refusal a sweep's prior art earns, or `undefined` when the chain may
 * proceed. The first citable hit wins; a sweep that found several says so on
 * the sheet it never gets to write, and one refusal is one comment.
 */
export function refusalFor(sweep: Sweep): Refusal | undefined {
  for (const entry of sweep.priorArt) {
    if (entry.verdict === "duplicate" && ISSUE_REF.test(entry.ref)) {
      return { cause: "already-exists", evidence: entry };
    }
    if (entry.verdict === "ruled" && ADR_REF.test(entry.ref)) {
      return { cause: "already-ruled", evidence: entry };
    }
  }
  return undefined;
}

/**
 * What the refusal says on the idea issue.
 *
 * [ADR-0011](../../../docs/adr/0011-a-refusal-ships-only-once-something-can-clear-it.md) — *a
 * refusal ships only once something can clear it* — is why the last line is
 * here rather than in a runbook nobody reads. What clears this one is a
 * comment, which is §01's fourth owner verb doing the job it already has: a
 * change request re-runs the chain, and `rounds.ts` suppresses this refusal
 * from the second run on, because by then the owner has looked at the
 * evidence and disagreed. No new verb, no new label, and the same two-round
 * cap bounds the spend.
 */
export function refusalComment(refusal: Refusal): string {
  const { evidence } = refusal;
  const lead =
    refusal.cause === "already-exists"
      ? `This idea already exists: ${evidence.ref}`
      : `An ADR has already ruled on this: ${evidence.ref}`;

  return `**Refused before shaping.** ${lead} — ${evidence.url}

${evidence.bearing}

The shaper was not spent. If this is genuinely a different idea, say so in a comment and the chain re-runs without this refusal.`;
}
