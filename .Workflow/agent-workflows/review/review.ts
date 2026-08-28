import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { execGit } from "../shared/git";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import { testsForCriteria } from "../shared/affected-tests";
import { isStructurallyRefused, type Finding, type GreenGateCheck } from "./structural-refusal";
import { runRefuter } from "./refuter";
import { publishFindings } from "./publish-findings";
import { runCounter, type CounterOutcome, type RefuterTally } from "./counter";

export type { Finding, GreenGateCheck } from "./structural-refusal";

/**
 * Lane 07's two reviewers (PRD #145, move 7a): Opus stages that read a diff CI has already
 * passed. The correctness reviewer hunts defects in it; the conformance reviewer, below, checks
 * it against the spec. Neither runs alone — every raw finding either writes down is filtered
 * through [ADR-0036](../../../docs/adr/0036-a-finding-a-green-gate-already-covers-is-refused-before-any.md)'s
 * `isStructurallyRefused` before anything downstream (the owner, or a later refuter — ADR-0035)
 * ever sees it. This file owns that firing and that filter; it does not own the refuter, which is
 * a separate stage reading only what survives here.
 */

/** §3: being subtly wrong is expensive and invisible. Low volume, high consequence. */
const CORRECTNESS_REVIEWER_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/review/correctness-reviewer/prompt.md";

export const CORRECTNESS_REVIEWER_OUTPUT = structuredOutput(
  z.object({ findings: z.array(z.object({ message: z.string().min(1) })) }),
);

/** What the reviewer is asked about: the diff it reads, and the names a green gate already covers. */
export interface CorrectnessReviewInput {
  diff: string;
  greenGateChecks: GreenGateCheck[];
}

/**
 * Drops every finding `isStructurallyRefused` refuses and keeps the rest, in order.
 *
 * This is the whole of ADR-0036 as this lane applies it: no judgement of its own, just the same
 * lookup `structural-refusal.ts` already proves — reused rather than reimplemented, so a
 * finding failing either of its two conditions never reaches a caller of this function, and one
 * failing neither does.
 */
export function keepSurvivingFindings(
  findings: Finding[],
  diff: string,
  greenGateChecks: GreenGateCheck[],
): Finding[] {
  return findings.filter((finding) => !isStructurallyRefused(finding, diff, greenGateChecks));
}

/**
 * Runs the correctness reviewer on one diff and returns only the findings that survive the
 * structural refusal — never the raw list the model wrote down.
 */
export async function runCorrectnessReview(
  exec: StageExec,
  input: CorrectnessReviewInput,
): Promise<Finding[]> {
  const raw = await runStage(
    PROMPT_PATH,
    { DIFF: input.diff },
    exec,
    CORRECTNESS_REVIEWER_OUTPUT,
    {
      model: CORRECTNESS_REVIEWER_MODEL,
      // The diff has no upper bound by construction — see `stage.ts`'s own note on `spec.ts`'s
      // Decided context, the same reasoning applied to a diff instead of a sheet.
      promptViaStdin: true,
    },
  );
  return keepSurvivingFindings(raw.findings, input.diff, input.greenGateChecks);
}

/**
 * Lane 07's conformance reviewer ([ADR-0038](../../../docs/adr/0038-lane-07-s-conformance-reviewer-files-spec-gap-where-the-spec.md)):
 * reads the spec, then the diff, and checks the diff against **only the part of the spec no
 * acceptance test encodes** — every criterion `testsForCriteria` already found a test naming has
 * a machine verdict on the record, and re-answering it is the whole-spec duplicate ADR-0038 ruled
 * out. What it finds splits by which side is wrong: a diff that diverges from a clear reading of
 * the spec is an ordinary finding, filtered through the same structural refusal the correctness
 * reviewer uses; a spec that is silent, ambiguous, or self-contradictory is not a finding against
 * the diff at all — it is `spec/gap`, filed straight at the PRD (ADR-0034), never both for the
 * same observation.
 */
const CONFORMANCE_REVIEWER_PROMPT_PATH =
  ".Workflow/agent-workflows/review/conformance-reviewer/prompt.md";

/** The label a filed spec/gap issue carries — read back by lane 02's amendment path (ADR-0034, `spec/amend.ts`). */
export const SPEC_GAP_LABEL = "spec/gap";

export const CONFORMANCE_REVIEWER_OUTPUT = structuredOutput(
  z.object({
    items: z.array(
      z.object({
        /** Which side is wrong — never both for the same observation (ADR-0038). */
        classification: z.enum(["divergence", "gap"]),
        /** `divergence`: a `path:line` finding, the correctness reviewer's own shape. `gap`: the in-scope criterion the spec leaves silent. */
        message: z.string().min(1),
      }),
    ),
  }),
);

/**
 * What the conformance reviewer is asked about: the spec it reads first, the diff it reads
 * second, the green gates a finding might restate, and the PRD a filed `spec/gap` names.
 */
export interface ConformanceReviewInput {
  /** The spec text — the PRD issue's own body — read before the diff, never after. */
  specText: string;
  diff: string;
  /** Every acceptance criterion the spec declares, verbatim — the same strings `testsForCriteria` matches against. */
  criteria: string[];
  greenGateChecks: GreenGateCheck[];
  /** The PRD issue number a filed `spec/gap` is routed at. */
  prdIssueNumber: number;
  /** Where `testsForCriteria` looks for acceptance tests. Omit for `ACCEPTANCE_DIR`; set only from a test double. */
  acceptanceDir?: string;
}

export interface ConformanceReviewResult {
  /** Survivors of the structural refusal, same shape as `runCorrectnessReview`'s. */
  findings: Finding[];
  /** The issue number of every `spec/gap` this review filed, in order. */
  gapIssues: number[];
}

/**
 * `criteria`, minus every one `testsForCriteria` already found a test naming — the untested
 * residue of the spec ADR-0038 scopes the conformance reviewer to. A criterion this keeps has no
 * acceptance test anywhere under `dir` that names it verbatim; a criterion this drops already has
 * a machine verdict on the record and is not the reviewer's to re-answer.
 */
export function untestedCriteria(criteria: string[], dir?: string): string[] {
  return criteria.filter((criterion) => testsForCriteria([criterion], dir).length === 0);
}

const GH_ISSUE_URL_RE = /\/issues\/(\d+)\s*$/;

/**
 * Files one `spec/gap` issue against `prdIssueNumber` and returns its number. The only place this
 * lane writes an issue for a "the spec is silent" finding rather than filtering one through
 * `keepSurvivingFindings` — a gap is a defect in the spec, not a finding against the diff, so it
 * never reaches that filter at all.
 */
function fileSpecGap(gh: GhExec, prdIssueNumber: number, report: string): number {
  const title = `spec/gap: #${prdIssueNumber}'s spec is silent on part of this diff`;
  const body = [
    `Filed by lane 07's conformance reviewer against #${prdIssueNumber} (ADR-0038).`,
    "",
    report,
  ].join("\n");
  const created = gh(["issue", "create", "--title", title, "--body", body, "--label", SPEC_GAP_LABEL]);
  const match = created.trim().match(GH_ISSUE_URL_RE);
  if (!match) {
    throw new Error(`could not parse an issue number from "gh issue create" output: ${JSON.stringify(created)}`);
  }
  return Number(match[1]);
}

/**
 * Runs the conformance reviewer on one diff and routes what it finds: a `divergence` item becomes
 * an ordinary finding, filtered through the same structural refusal `runCorrectnessReview` uses; a
 * `gap` item becomes a filed `spec/gap` issue and never an ordinary finding. `SCOPE` — the untested
 * residue of `input.criteria` — is substituted alongside `SPEC` and `DIFF`, so the reviewer is
 * never handed a criterion an acceptance test already covers.
 */
export async function runConformanceReview(
  exec: StageExec,
  gh: GhExec,
  input: ConformanceReviewInput,
): Promise<ConformanceReviewResult> {
  const scope = untestedCriteria(input.criteria, input.acceptanceDir);

  const raw = await runStage(
    CONFORMANCE_REVIEWER_PROMPT_PATH,
    { SPEC: input.specText, SCOPE: scope.join("\n"), DIFF: input.diff },
    exec,
    CONFORMANCE_REVIEWER_OUTPUT,
    {
      model: CORRECTNESS_REVIEWER_MODEL,
      // Same reasoning as the correctness reviewer's own call: a spec has no upper bound by
      // construction any more than a diff does.
      promptViaStdin: true,
    },
  );

  const divergences = raw.items
    .filter((item) => item.classification === "divergence")
    .map((item) => ({ message: item.message }));
  const findings = keepSurvivingFindings(divergences, input.diff, input.greenGateChecks);

  const gapIssues = raw.items
    .filter((item) => item.classification === "gap")
    .map((item) => fileSpecGap(gh, input.prdIssueNumber, item.message));

  return { findings, gapIssues };
}

/** What one end-to-end run of lane 07 needs to reach the owner: a diff to review and who to notify. */
export interface RunReviewInput {
  diff: string;
  greenGateChecks: GreenGateCheck[];
  /** Who a filed finding, and a filed counter proposal, is assigned to. */
  assignee: string;
}

export interface RunReviewResult {
  /** Findings the refuter left standing — the only ones this filed an issue for. */
  survivors: Finding[];
  /** Issue numbers `publishFindings` opened, one per survivor, in order. */
  publishedIssues: number[];
  /** How many findings reached the refuter, and how many it refused — `counter.ts`'s delete trigger. */
  tally: RefuterTally;
  counter: CounterOutcome;
}

/**
 * Lane 07's whole chain, end to end (PRD #145, move 7a): the correctness reviewer's raw findings,
 * filtered by the structural refusal (`runCorrectnessReview`), each surviving one sent through the
 * refuter (`runRefuter`), and each survivor of *that* filed as its own issue — never a PR comment,
 * never any other notification (`publishFindings`, carrying `counter.ts`'s `FINDING_LABEL`). The
 * refuter's own tally — how many findings it read, how many it refused — is counted here, in the
 * same process the refuter runs in ([`refuter.ts`](./refuter.ts)'s own note on why it has no
 * entrypoint of its own), and handed to `runCounter` so the delete trigger sees real evidence
 * rather than a second, undocumented place logging it.
 */
export async function runReview(exec: StageExec, gh: GhExec, input: RunReviewInput): Promise<RunReviewResult> {
  const candidates = await runCorrectnessReview(exec, { diff: input.diff, greenGateChecks: input.greenGateChecks });
  const survivors = await runRefuter(exec, candidates, input.diff, input.greenGateChecks);
  const tally: RefuterTally = { reached: candidates.length, refuted: candidates.length - survivors.length };

  const publishedIssues = publishFindings(gh, survivors, input.assignee);
  const counter = runCounter({ gh, tally, assignee: input.assignee });

  return { survivors, publishedIssues, tally, counter };
}

async function main(): Promise<void> {
  const base = process.argv[2];
  const head = process.argv[3] ?? "HEAD";
  const greenGateChecks = process.argv.slice(4);

  if (!base) {
    console.error("usage: review.ts <base-ref> [head-ref] [green-gate-check...]");
    process.exitCode = 1;
    return;
  }

  const assignee = process.env.SIGNAL_ASSIGNEE;
  if (!assignee) {
    console.error("SIGNAL_ASSIGNEE must be set — an unassigned finding notifies nobody");
    process.exitCode = 1;
    return;
  }

  try {
    const diff = execGit(["diff", `${base}...${head}`]);
    const result = await runReview(execClaude, execGh, { diff, greenGateChecks, assignee });
    console.log(
      JSON.stringify({ publishedIssues: result.publishedIssues, tally: result.tally }),
    );
  } catch (err) {
    console.error(`review failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
