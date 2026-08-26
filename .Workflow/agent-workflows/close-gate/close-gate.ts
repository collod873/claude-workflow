import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { extractOutput } from "../shared/output-block";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { countCriteria } from "../shared/ticket-shape";
import {
  GRAMMAR_DOC,
  RECORD_HEADING,
  evaluateRecord,
  findMarkerText,
  mostRecentRecord,
  type Evaluation,
  type IssueComment,
} from "./record-grammar";

/**
 * The close gate, at the one venue the agents it judges cannot reach
 * (`DESIGN.md` §09, lane 09).
 *
 * Era 6 ran this logic as a PreToolUse hook on the workstation, which meant
 * a commit-keyword close (`Closes #704`) never reached it and a crashing
 * rail failed open unseen — 83 rows of exactly that in each of two logs.
 * `issues.closed` fires no matter *how* an issue was closed, and an Action
 * that errors is a red run rather than a silent pass. That is the whole
 * change: not the judgement, the venue. It is `GOAL.md`'s blocker 1,
 * retired structurally rather than patched.
 *
 * Three outcomes, and the difference between the last two matters:
 *
 * - **pass** — the close stands. Nothing is written to the issue unless a
 *   record was salvaged (the record is posted) or a previous refusal is
 *   still labelled (the label is lifted).
 * - **refuse** — the close is reversed: the issue is reopened, the reason
 *   commented, `close-refused` applied. The run stays green, because a
 *   refusal is this gate working, not this gate breaking.
 * - **degraded** — the gate could not do its job (the tracker did not
 *   answer, the salvage stage died). Fails closed — reopens exactly as a
 *   refusal does — *and* exits nonzero, so it is a red run. A gate that let
 *   a close through because it broke would not be a gate (`CONTEXT.md`,
 *   "fail-open").
 */

/**
 * The only close reason that asserts anything was delivered.
 *
 * A close marked `not_planned` or `duplicate` is a decision not to do the
 * work, and there is nothing for a delivery record to be about. Scoping on
 * this is what lets the gate be absolute about the closes it does judge
 * without reopening every idea the owner drops from his phone. Read twice,
 * deliberately: `close-gate.yml`'s job-level `if` skips the runner entirely
 * (the estate is over its minutes cap, so a job that would decide "nothing
 * to do" should not start), and this constant is the second reader for a
 * local run and for the case where that condition is ever edited wrong.
 * `close-gate.test.ts` asserts the workflow file still names it.
 */
export const DELIVERY_CLOSE_REASON = "completed";

/**
 * The label an open refusal wears. **State, not history** (ADR-0023): a
 * refusal applies it and a passing re-close lifts it, so anything that
 * filters open work by it — a triage query, a wayfinder sweep — sees the
 * refusals that are still outstanding rather than every refusal there has
 * ever been. What happened is durable elsewhere and cannot be lifted: the
 * refusal comment stays on the issue, and the run stays in the log. Count
 * refusals from those; never from this.
 */
export const REFUSED_LABEL = "close-refused";

/**
 * Haiku, per `DESIGN.md` §3 and §09's cost line: high volume, zero
 * discretion, trivially reversible. The salvage stage renders no verdict —
 * it translates prose into the grammar and a deterministic checker judges
 * the result — so it is exactly the tier that table assigns.
 */
export const SALVAGE_MODEL = "claude-haiku-4-5-20251001";

const SALVAGE_PROMPT = fileURLToPath(new URL("salvage/prompt.md", import.meta.url));

/**
 * What the salvage stage returns: the record it wrote, and nothing else.
 * A single-key object rather than a bare string so the `<output>` contract
 * is the same shape every other stage in this repo uses.
 */
const SalvagedRecord = z.object({
  record: z.string().min(1),
});

/** The tracker's answer to `gh issue view --json body,comments,labels`. */
const IssueView = z.object({
  body: z.string().nullable().optional(),
  comments: z
    .array(z.object({ body: z.string().nullable().optional() }))
    .nullable()
    .optional(),
  labels: z
    .array(z.object({ name: z.string().nullable().optional() }))
    .nullable()
    .optional(),
});

export type OutcomeAction = "pass" | "refuse" | "degraded";

export interface Outcome {
  action: OutcomeAction;
  /** A stable slug, for the log and for whatever counts refusals later. */
  code: string;
  /** One line for the run log. Not what gets commented. */
  note: string;
  /** Whether a model was spent — §09 budgets one Haiku, only on salvage. */
  salvaged: boolean;
}

export interface GateInput {
  issueNumber: number;
  /** `github.event.issue.state_reason`. */
  stateReason: string | null | undefined;
  /** The Actions run, named in a refusal comment so it can be traced. */
  runUrl?: string;
  gh?: GhExec;
  exec?: StageExec;
  log?: (line: string) => void;
}

/**
 * Reads the issue the close landed on. Returns `null` rather than throwing
 * on a tracker that will not answer, because that is a degraded outcome
 * (fail closed, red run) and not a crash.
 */
function fetchIssue(
  gh: GhExec,
  issueNumber: number,
): { body: string; comments: IssueComment[]; labels: string[] } | null {
  let parsed: ReturnType<typeof IssueView.safeParse>;
  try {
    const raw = gh(["issue", "view", String(issueNumber), "--json", "body,comments,labels"]);
    // `JSON.parse` is inside the guard, not beside it: a `gh` that answers
    // with something unparseable is the same degraded outcome as a `gh` that
    // does not answer at all, and letting the parse throw past here would
    // crash the gate rather than fail it closed.
    parsed = IssueView.safeParse(JSON.parse(raw));
  } catch {
    return null;
  }
  if (!parsed.success) {
    return null;
  }
  return {
    body: parsed.data.body ?? "",
    comments: (parsed.data.comments ?? []).map((comment) => ({ body: comment.body ?? "" })),
    labels: (parsed.data.labels ?? []).map((label) => label.name ?? ""),
  };
}

/**
 * Spends the one Haiku: hands the issue to the salvage stage and returns
 * the record it wrote, already confirmed to *be* a record (it opens with
 * the heading). Throws on anything else — a stage that returned prose, a
 * malformed `<output>` block, a dead CLI — so the caller can report it as
 * degraded rather than mistaking it for a refusal.
 */
async function salvageRecord(exec: StageExec, issueNumber: number): Promise<string> {
  const raw = await runStage(SALVAGE_PROMPT, { ISSUE_NUMBER: String(issueNumber) }, exec, {
    model: SALVAGE_MODEL,
  });
  const salvaged = extractOutput(raw, SalvagedRecord);
  const marker = findMarkerText(salvaged.record);
  if (marker === null) {
    throw new Error(
      `the salvage stage returned text that does not begin with \`${RECORD_HEADING}\``,
    );
  }
  return marker;
}

/**
 * Reverses a close: reopens the issue with the reason attached, then labels
 * it. The comment rides on `issue reopen --comment` rather than a separate
 * `issue comment` call so a refusal can never half-land as a comment on a
 * still-closed issue.
 *
 * The label write is deliberately allowed to fail without taking the
 * refusal with it — the reopen is the refusal, and losing the whole gate
 * because a label was missing would be the fail-open shape this venue
 * exists to remove.
 */
function reverseClose(gh: GhExec, issueNumber: number, comment: string, log: (line: string) => void): void {
  gh(["issue", "reopen", String(issueNumber), "--comment", comment]);
  try {
    gh(["issue", "edit", String(issueNumber), "--add-label", REFUSED_LABEL]);
  } catch (err) {
    log(`could not apply \`${REFUSED_LABEL}\`: ${reason(err)}`);
  }
}

/**
 * Lifts `close-refused` from an issue whose close has just been accepted.
 * The mirror of `reverseClose`'s label write, and forgiving in the same way
 * and for the same reason: the pass is the verdict, and a label that will
 * not come off is worth a line in the log rather than a reversal of a close
 * the gate just verified.
 *
 * Conditional on the label actually being there, so the ordinary close —
 * which never had a refusal — spends no tracker write at all. That is what
 * keeps the pass path's "wrote nothing to the issue" assertion meaningful.
 */
function clearRefusal(
  gh: GhExec,
  issueNumber: number,
  labels: string[],
  log: (line: string) => void,
): void {
  if (!labels.includes(REFUSED_LABEL)) {
    return;
  }
  try {
    gh(["issue", "edit", String(issueNumber), "--remove-label", REFUSED_LABEL]);
  } catch (err) {
    log(`could not lift \`${REFUSED_LABEL}\`: ${reason(err)}`);
  }
}

function refusalComment(evaluation: Evaluation, runUrl: string | undefined, salvaged: boolean): string {
  const preamble = salvaged
    ? "**This close is refused.** No `## Closing record` was posted, so the gate read the issue " +
      "and whatever closed it and wrote the record itself — and that record does not clear the " +
      "bar either."
    : "**This close is refused.**";
  const trailer = runUrl ? `\n\n**Workflow run:** ${runUrl}` : "";
  return (
    `${preamble}\n\n` +
    `**Reason** (\`${evaluation.code}\`): ${evaluation.message}\n\n` +
    "Post a `## Closing record` comment that clears the grammar, then close this again. " +
    `The grammar is in [\`${GRAMMAR_DOC}\`](${GRAMMAR_DOC}).${trailer}`
  );
}

function degradedComment(detail: string, runUrl: string | undefined): string {
  const trailer = runUrl ? `\n\n**Workflow run:** ${runUrl}` : "";
  return (
    "**This close is refused because the gate could not verify it.**\n\n" +
    `**Reason:** ${detail}\n\n` +
    "This is the gate failing, not the close — a gate that let a close through because it broke " +
    "would not be a gate. The run is red; fix the cause and close this again." +
    trailer
  );
}

/**
 * The gate. Every write it makes goes through the injected `gh`, so a test
 * asserts "reopened exactly once, and nothing else was written" rather than
 * assuming it.
 */
export async function runCloseGate(input: GateInput): Promise<Outcome> {
  const gh = input.gh ?? execGh;
  const exec = input.exec ?? execClaude;
  const log = input.log ?? ((line: string) => console.log(line));
  const { issueNumber, stateReason, runUrl } = input;

  if (stateReason !== DELIVERY_CLOSE_REASON) {
    return {
      action: "pass",
      code: "not-a-delivery-claim",
      note: `closed as \`${stateReason ?? "unspecified"}\` — no delivery is claimed, nothing to verify.`,
      salvaged: false,
    };
  }

  const issue = fetchIssue(gh, issueNumber);
  if (issue === null) {
    const detail = `the tracker did not return a readable issue #${issueNumber}.`;
    reverseClose(gh, issueNumber, degradedComment(detail, runUrl), log);
    return { action: "degraded", code: "tracker-unreadable", note: detail, salvaged: false };
  }

  const criteriaCount = countCriteria(issue.body);
  const existing = mostRecentRecord(issue.comments);

  // A record that exists is judged as written. Spending a model to rewrite
  // one somebody actually posted would launder a bad record into a good
  // one, which is the opposite of what the model is here for.
  if (existing !== null) {
    const evaluation = evaluateRecord(existing, criteriaCount);
    if (evaluation.verdict === "allow") {
      clearRefusal(gh, issueNumber, issue.labels, log);
      return { action: "pass", code: evaluation.code, note: evaluation.message, salvaged: false };
    }
    reverseClose(gh, issueNumber, refusalComment(evaluation, runUrl, false), log);
    return { action: "refuse", code: evaluation.code, note: evaluation.message, salvaged: false };
  }

  // No record at all — the normal shape of a merge-keyword, phone or
  // web-UI close, and 78 of era 6's 125 refusals. One Haiku translates
  // whatever evidence exists into the grammar; the same evaluator above
  // judges what it wrote.
  let salvagedRecord: string;
  try {
    salvagedRecord = await salvageRecord(exec, issueNumber);
  } catch (err) {
    const detail = `no \`${RECORD_HEADING}\` was posted, and the salvage stage failed: ${reason(err)}`;
    reverseClose(gh, issueNumber, degradedComment(detail, runUrl), log);
    return { action: "degraded", code: "salvage-failed", note: detail, salvaged: false };
  }

  const evaluation = evaluateRecord(salvagedRecord, criteriaCount);
  if (evaluation.verdict === "deny") {
    reverseClose(gh, issueNumber, refusalComment(evaluation, runUrl, true), log);
    return { action: "refuse", code: evaluation.code, note: evaluation.message, salvaged: true };
  }

  // Post what the gate read, so the reasoning is durable and a later
  // re-close finds a record and costs no model at all.
  const body =
    `${RECORD_HEADING}\n${salvagedRecord}\n\n` +
    "*Written by the close gate: this issue was closed as completed with no closing record, so " +
    "the gate read the issue and what closed it and wrote one. The verdict above is the " +
    "deterministic grammar's, not the model's.*";
  try {
    gh(["issue", "comment", String(issueNumber), "--body", body]);
  } catch (err) {
    // The close already passed on evidence the gate verified. Losing the
    // receipt is worth a line in the log, not a reopen.
    log(`could not post the salvaged record: ${reason(err)}`);
  }
  clearRefusal(gh, issueNumber, issue.labels, log);
  return { action: "pass", code: evaluation.code, note: evaluation.message, salvaged: true };
}

async function main(): Promise<void> {
  const issueNumber = Number(process.env.ISSUE_NUMBER);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    console.error("ISSUE_NUMBER must be set to a positive integer");
    process.exit(1);
  }
  const outcome = await runCloseGate({
    issueNumber,
    stateReason: process.env.STATE_REASON || null,
    runUrl: process.env.RUN_URL || undefined,
  });
  console.log(`${outcome.action} (${outcome.code}): ${outcome.note}`);
  // A refusal is this gate working; only a degraded outcome is a red run.
  process.exit(outcome.action === "degraded" ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
