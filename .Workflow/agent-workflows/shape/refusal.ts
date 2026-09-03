import type { PriorArt, Sweep } from "../shared/sweep-schema";

const ISSUE_REF = /^#\d+$/;

function citesItself(ref: string, subject: number): boolean {
  return ref === `#${subject}`;
}

const ADR_REF = /^ADR-\d{4}$/;

export interface Refusal {
  cause: "already-exists" | "already-ruled";
  evidence: PriorArt;
}

export function refusalFor(sweep: Sweep, subject: number): Refusal | undefined {
  for (const entry of sweep.priorArt) {
    if (citesItself(entry.ref, subject)) continue;
    if (entry.verdict === "duplicate" && ISSUE_REF.test(entry.ref)) {
      return { cause: "already-exists", evidence: entry };
    }
    if (entry.verdict === "ruled" && ADR_REF.test(entry.ref)) {
      return { cause: "already-ruled", evidence: entry };
    }
  }
  return undefined;
}

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
