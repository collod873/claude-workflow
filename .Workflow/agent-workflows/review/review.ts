import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { execGit } from "../shared/git";
import { execGh, type GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import { reason } from "../shared/reason";
import { fileSpecGap } from "../shared/spec-gap";
import { testsForCriteria } from "../shared/affected-tests";
import { commitPullsPath } from "../shared/gh-paths";
import { implementationBranchTicket } from "../shared/ready-set";
import { extractCriteria, parentPrdNumber, readTicket } from "../shared/ticket-shape";
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
      stage: "correctness",
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

/**
 * This lane's `spec/gap`: the only place it writes an issue for a "the spec is silent" finding
 * rather than filtering one through `keepSurvivingFindings` — a gap is a defect in the spec, not a
 * finding against the diff, so it never reaches that filter at all. The filing itself is
 * `shared/spec-gap.ts`, shared with the fixer (ADR-0119); what belongs to this lane is the title,
 * which says which lane noticed and how.
 */
function fileConformanceGap(gh: GhExec, prdIssueNumber: number, report: string): number {
  return fileSpecGap(
    gh,
    prdIssueNumber,
    `spec/gap: #${prdIssueNumber}'s spec is silent on part of this diff`,
    `Filed by lane 07's conformance reviewer (ADR-0038).\n\n${report}`,
  );
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
      stage: "conformance",
    },
  );

  const divergences = raw.items
    .filter((item) => item.classification === "divergence")
    .map((item) => ({ message: item.message }));
  const findings = keepSurvivingFindings(divergences, input.diff, input.greenGateChecks);

  const gapIssues = raw.items
    .filter((item) => item.classification === "gap")
    .map((item) => fileConformanceGap(gh, input.prdIssueNumber, item.message));

  return { findings, gapIssues };
}

/** What one end-to-end run of lane 07 needs to reach the owner: a diff to review and who to notify. */
export interface RunReviewInput {
  diff: string;
  greenGateChecks: GreenGateCheck[];
  /** Who a filed finding, and a filed counter proposal, is assigned to. */
  assignee: string;
  /**
   * The commit this run is reviewing — `workflow_run.head_sha`, passed through from the argv
   * `review.yml` already builds. It is the *only* thing this function is told about which pull
   * request it is looking at: the ticket, its parent PRD and its criteria are all resolved from
   * it here (#189), so `main()` does no lookup of its own and `review.yml` needs no edit.
   */
  head: string;
}

/**
 * The spec half of a review, resolved from the commit under review: which PRD text to judge the
 * diff against, which criteria bound the judgement, and which issue a `spec/gap` is filed at.
 */
type ResolvedSpec = Pick<ConformanceReviewInput, "specText" | "criteria" | "prdIssueNumber">;

/** One pull request, as `commits/{head}/pulls` returns it — only the head this lane matches on. */
interface CommitPull {
  head?: { sha?: string; ref?: string };
}

/**
 * Resolves the spec for `head`, or throws naming the first thing that could not be resolved.
 *
 * Every step is a lookup that can legitimately come back empty on a real pull request, and
 * `runReview`'s caller catches all of them as one branch — see the note there for why a missing
 * spec is a fact about the pull request rather than a fault in lane 07.
 */
function resolveSpec(gh: GhExec, head: string): ResolvedSpec {
  const pulls = JSON.parse(gh(["api", commitPullsPath(head)])) as CommitPull[];

  // Every pull request *associated with* the commit comes back here, including ones that merely
  // contain it further down their branch. The one this run is reviewing is the one whose own head
  // is that commit — state is deliberately not a term: lane 07 rides a `workflow_run` and is
  // always behind the event that started it, so the pull request may already be merged (#189).
  const pull = pulls.find((candidate) => candidate.head?.sha === head);
  if (!pull) throw new Error(`no pull request has ${head} as its head commit`);

  const branch = pull.head?.ref ?? "";
  const ticketNumber = implementationBranchTicket(branch);
  if (ticketNumber === undefined) {
    throw new Error(`head branch \`${branch}\` is not an implementation claim, so it names no ticket`);
  }

  const ticket = readTicket(gh, ticketNumber);
  // The criteria are the *ticket's* own: they are the checkable statements this diff was asked to
  // satisfy, and the parent PRD carries no machine-readable criteria of its own.
  const criteria = extractCriteria(ticket.body);

  // A ticket filed without a `## Parent PRD` heading is still a spec — it is reviewed against its
  // own body, and a `spec/gap` is filed at the ticket. That is not the skip branch.
  const prdNumber = parentPrdNumber(ticket.body);
  if (prdNumber === undefined) {
    return { specText: ticket.body, criteria, prdIssueNumber: ticketNumber };
  }

  return { specText: readTicket(gh, prdNumber).body, criteria, prdIssueNumber: prdNumber };
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
 * Lane 07's whole chain, end to end (PRD #145, move 7a; both reviewers since #189): the
 * correctness reviewer's raw findings *and* the conformance reviewer's divergences, each filtered
 * by the structural refusal, concatenated correctness-first and sent through the
 * refuter (`runRefuter`), and each survivor of *that* filed as its own issue — never a PR comment,
 * never any other notification (`publishFindings`, carrying `counter.ts`'s `FINDING_LABEL`). The
 * refuter's own tally — how many findings it read, how many it refused — is counted here, in the
 * same process the refuter runs in ([`refuter.ts`](./refuter.ts)'s own note on why it has no
 * entrypoint of its own), and handed to `runCounter` so the delete trigger sees real evidence
 * rather than a second, undocumented place logging it.
 */
export async function runReview(exec: StageExec, gh: GhExec, input: RunReviewInput): Promise<RunReviewResult> {
  const correctness = await runCorrectnessReview(exec, { diff: input.diff, greenGateChecks: input.greenGateChecks });

  // Both reviewers, over the same diff and the same green gates, before anything reaches the
  // refuter — correctness first, so the combined list reads in the order the reviewers ran and
  // `tally.reached` counts both (#189).
  const conformance = await reviewConformance(exec, gh, input);

  const candidates = [...correctness, ...conformance];
  const survivors = await runRefuter(exec, candidates, input.diff, input.greenGateChecks);
  const tally: RefuterTally = { reached: candidates.length, refuted: candidates.length - survivors.length };

  const publishedIssues = publishFindings(gh, survivors, input.assignee);
  const counter = runCounter({ gh, tally, assignee: input.assignee });

  return { survivors, publishedIssues, tally, counter };
}

/**
 * The conformance reviewer's findings, or none when this run has no spec to judge against.
 *
 * **One skip branch wrapping the whole resolution** (#189): no pull request for the head commit,
 * a head branch that is not an implementation claim, the `gh` lookup throwing, or a ticket or
 * parent PRD that will not read — every one of them prints a line naming what could not be
 * resolved and leaves the correctness half to run alone, at exit 0. A reviewer that cannot find
 * its spec has nothing to judge conformance against, and that is a fact about the pull request,
 * not a fault in this lane; failing the run would block a merge over a missing heading.
 *
 * The resolution alone is inside the `try`. A conformance reviewer that *did* find its spec and
 * then failed is a real failure of this lane, and it surfaces rather than being swallowed here.
 */
async function reviewConformance(exec: StageExec, gh: GhExec, input: RunReviewInput): Promise<Finding[]> {
  let spec: ResolvedSpec;
  try {
    spec = resolveSpec(gh, input.head);
  } catch (err) {
    console.error(`conformance review skipped: ${reason(err)}`);
    return [];
  }

  const result = await runConformanceReview(exec, gh, {
    specText: spec.specText,
    diff: input.diff,
    criteria: spec.criteria,
    greenGateChecks: input.greenGateChecks,
    prdIssueNumber: spec.prdIssueNumber,
  });
  return result.findings;
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

  // Which checkout is the repository under review. `TARGET_WORKSPACE` is set only by the reusable
  // workflow (ADR-0055): there this process runs from the machine checkout, where the diff being
  // reviewed does not exist and never will. Absent — a workstation run — cwd is both.
  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();

  try {
    const diff = execGit(["-C", repoDir, "diff", `${base}...${head}`]);
    // `head` goes through unchanged: which pull request it belongs to, and which ticket that pull
    // request implements, are `runReview`'s to resolve — this entrypoint looks nothing up.
    // The reviewer's own working directory is the target too: the diff is inlined in its prompt,
    // but what it reads *around* the diff has to be the code that diff belongs to.
    const result = await runReview(execClaudeIn(repoDir), execGh, { diff, greenGateChecks, assignee, head });
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
