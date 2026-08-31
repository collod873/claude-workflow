import { z } from "zod";
import { PATH_LINE_RE } from "../shared/ticket-shape";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import type { Finding, GreenGateCheck } from "./structural-refusal";

/**
 * Lane 07's refuter (PRD #145, move 7a; [ADR-0035](../../../docs/adr/0035-lane-07-ships-with-one-refuter-and-a-refusal-that-names-no-r.md)):
 * one Sonnet call per finding that survives the structural refusal
 * (`structural-refusal.ts`), reading only what a machine could not rule on.
 *
 * At N=1 there is no majority, so this is a **veto** — and a veto combined
 * with "default to refuted when uncertain" would let one hedging response
 * kill every finding the lane ever produces. ADR-0035 bounds that: **a
 * refusal must name its reason** — the gate that already covers the
 * finding, or the `path:line` by which it is unreachable. A refusal that
 * names neither is stripped mechanically, the same shape as
 * [ADR-0028](../../../docs/adr/0028-an-assumption-mark-names-what-it-moves-or-it-is-not-a-mark.md)'s
 * malformed assumption mark: the test needs no judgement at check time,
 * only a lookup against text the model already wrote.
 */

/** §3: bounded by what the structural refusal already narrowed the queue to. */
export const REFUTER_MODEL = "claude-sonnet-5";

export const PROMPT_PATH = ".Workflow/agent-workflows/review/refuter/prompt.md";

/**
 * The refuter's raw answer for one finding. `refuted` is the verdict;
 * `reason` is the text it must be checked against before that verdict is
 * trusted — an empty string is a legal answer (a survivor never needs one),
 * and a `refuted: true` with an empty or unqualified `reason` is exactly the
 * shape ADR-0035 strips.
 */
export const REFUTER_OUTPUT = structuredOutput(
  z.object({ refuted: z.boolean(), reason: z.string() }),
);

export type RefuterVerdict = z.infer<typeof REFUTER_OUTPUT.schema>;

/**
 * Whether `reason` names a checkable reason: a `path:line` (the finding is
 * unreachable, or points at a line the diff does not touch) or the name of
 * a check `greenGateChecks` already lists (the gate that already covers
 * it). Reused rather than reimplemented from `structural-refusal.ts`'s two
 * conditions — this is the same lookup, aimed at the refuter's own text
 * instead of the reviewer's.
 *
 * Plain string matching, deliberately: a model judging whether its own
 * refusal named a reason would be the same defect ADR-0036 already refused
 * to build — creative about a lookup it should not be creative about.
 */
export function refusalNamesReason(reason: string, greenGateChecks: GreenGateCheck[]): boolean {
  return PATH_LINE_RE.test(reason) || greenGateChecks.some((check) => reason.includes(check));
}

/**
 * Whether `finding` survives one refuter verdict: `true` unless the verdict
 * refuses it **and** names a checkable reason for doing so. A refusal
 * naming nothing — `refuted: true` with a reason that cites no gate and no
 * `path:line` — is stripped here, and the finding survives exactly as if
 * the refuter had said nothing.
 */
export function survivesRefutation(
  verdict: RefuterVerdict,
  greenGateChecks: GreenGateCheck[],
): boolean {
  return !verdict.refuted || !refusalNamesReason(verdict.reason, greenGateChecks);
}

/** Runs the refuter once, on one finding. The only place this lane spawns a model per finding. */
async function runOne(
  exec: StageExec,
  finding: Finding,
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Promise<RefuterVerdict> {
  return runStage(
    PROMPT_PATH,
    {
      FINDING: finding.message,
      DIFF: diff,
      GREEN_GATE_CHECKS: greenGateChecks.length ? greenGateChecks.join(", ") : "(none)",
    },
    exec,
    REFUTER_OUTPUT,
    {
      model: REFUTER_MODEL,
      // The diff has no upper bound by construction — the same reasoning
      // `review.ts` already applies to the correctness reviewer's own prompt.
      promptViaStdin: true,
      stage: "refuter",
    },
  );
}

/**
 * Runs the refuter over every finding that survived the structural refusal
 * — **exactly one** call per finding, never a batch and never a re-ask —
 * and returns only the survivors, in order.
 */
export async function runRefuter(
  exec: StageExec,
  findings: Finding[],
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Promise<Finding[]> {
  const survivors: Finding[] = [];
  for (const finding of findings) {
    const verdict = await runOne(exec, finding, diff, greenGateChecks);
    if (survivesRefutation(verdict, greenGateChecks)) survivors.push(finding);
  }
  return survivors;
}

// No standalone entrypoint: unlike `review.ts`, this stage is never dispatched on its own — it is
// a function `review.ts`'s chain calls once per surviving finding, in the same process. A CLI
// wrapper here would be a second way to run it that nothing uses, and every other stage's
// `pathToFileURL` guard exists to let a real entrypoint be tested without spawning `claude`; this
// file has no entrypoint to guard.
