import { z } from "zod";
import type { GhExec } from "../shared/gh";
import { parseIssueNumber } from "../shared/issue-url";
import type { GitExec } from "../shared/git";
import { writeNoteArray } from "../shared/notes-store";
import { syncNotesRef } from "../shared/notes-sync";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { countCriteria } from "../shared/ticket-shape";

/**
 * Lane 02's amendment path (ADR-0079): given a `spec/gap` issue naming one
 * criterion in a published `PRD:` issue, either clarifies that criterion's
 * wording in the PRD body in place, or refuses the amendment and files an
 * ordinary `idea` naming the slice that surfaced it — when only new scope
 * could repair the gap. ADR-0079's whole point is that a `spec/gap`
 * amendment may **never** add a criterion, only reword one the PRD already
 * carries; `clarify` below enforces that as arithmetic (the criteria count
 * before and after must match), not merely as a prompt instruction a model
 * could talk itself past.
 *
 * Lands straight to `main`, no PR — the same shape ADR-0053 rules for the
 * acceptance lane, applied here to the one thing this lane can commit: an
 * audit-trail note (`notes-store.ts`'s existing seam) recording what changed
 * and why. The PRD body itself is a GitHub issue (ADR-0001: "not in files"),
 * so there is no file to commit for it.
 *
 * **The write is a comment, never a body-overwriting `gh` call.** `intake.test.ts`
 * enforces, repo-wide, that nothing downstream rewrites an issue body — the
 * micro door's own words are read verbatim and never edited, and no second
 * writer exists to overwrite a PRD's either. So a clarified criterion lands
 * as a marked comment (`AMENDMENT_MARKER`, the same shape `rounds.ts`'s
 * `OPEN_QUESTIONS_MARKER` already uses for "the latest one is the current
 * state, recomputed rather than stored"), and the result's `prdBody` is this
 * function's own computed value of what the PRD now reads as — the text the
 * amendment comment describes, not a field GitHub was asked to overwrite.
 */

/** §3: a spec-gap amendment is exactly the low-volume, high-consequence case the author and critic already run on. */
export const SPEC_AMEND_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/amend/prompt.md";

/** The label every issue this lane files carries — `.github/ISSUE_TEMPLATE/idea.yml`'s own label. */
const IDEA_LABEL = "idea";

/** Marks a clarification comment as this lane's own — `rounds.ts`'s `OPEN_QUESTIONS_MARKER`, one ref over. */
const AMENDMENT_MARKER = "<!-- spec-amendment:v1 -->";

/** The notes ref the amendment's durable trace is written to (ADR-0053's shape: no PR, a direct push). */
const AMENDMENT_NOTES_REF = "spec-amendments";

/** One `spec/gap`, as much as `runSpecAmendment` needs to read — assembled by whatever collects a `spec/gap` issue's fields, not this module's job. */
export interface SpecGapReport {
  /** The PRD issue the gap was raised against. */
  prdIssueNumber: number;
  /** The PRD's current body — `criterion` must appear in it verbatim (ADR-0033's own rule, reused rather than re-derived). */
  prdBody: string;
  /** The exact criterion text the gap names, verbatim from the PRD body's `## Acceptance criteria`. */
  criterion: string;
  /** What the gap reported: the disagreement a red test found, or the silence a reviewer found (ADR-0034, ADR-0038). */
  gapReport: string;
  /** The slice (sub-issue) that surfaced the gap — named in the idea filed when the amendment is refused. */
  slice: string;
}

const AmendAnswer = z.object({
  /** `"clarified"` when a clearer wording repairs the gap; `"needs-scope"` when only a criterion the PRD never carried would. */
  verdict: z.enum(["clarified", "needs-scope"]),
  /** The criterion's new wording. Read only when `verdict` is `"clarified"`. */
  clarifiedCriterion: z.string(),
  /** Why — carried into the filed idea when `verdict` is `"needs-scope"`. */
  reason: z.string().min(1),
});
type AmendAnswer = z.infer<typeof AmendAnswer>;

export const SPEC_AMEND_OUTPUT = structuredOutput(AmendAnswer);

export type SpecAmendmentResult =
  | { verdict: "clarified"; prdBody: string }
  | { verdict: "refused"; ideaIssueNumber: number; reason: string };

export interface SpecAmendDeps {
  exec: StageExec;
  gh: GhExec;
  git: GitExec;
  /** The repo the audit-trail note is written into, threaded as `-C <repoDir>` (`notes-store.ts`'s own convention). */
  repoDir: string;
}

/**
 * Runs the amendment stage on one `spec/gap` report and carries out its
 * verdict.
 *
 * `"clarified"`: computes the PRD's new body (the criterion's old text
 * swapped for the new, everything else untouched), posts it as a marked
 * comment on the PRD issue — never a body overwrite, see this module's own
 * header — and records the change on
 * `refs/notes/spec-amendments`, pushed straight to `main` with no PR.
 * Throws, before any write, if the criteria count would change: that would
 * be adding one, which ADR-0079 refuses outright.
 *
 * `"needs-scope"`: writes nothing about the PRD at all. Files exactly one
 * `idea` issue naming `gap.slice` and the reason, and returns its number.
 */
export async function runSpecAmendment(
  deps: SpecAmendDeps,
  gap: SpecGapReport,
): Promise<SpecAmendmentResult> {
  const answer = await runStage(
    PROMPT_PATH,
    {
      PRD_BODY: gap.prdBody,
      CRITERION: gap.criterion,
      GAP_REPORT: gap.gapReport,
    },
    deps.exec,
    SPEC_AMEND_OUTPUT,
    { model: SPEC_AMEND_MODEL, promptViaStdin: true, stage: "amend" },
  );

  if (answer.verdict === "needs-scope" || answer.clarifiedCriterion.trim() === "") {
    return fileIdea(deps.gh, gap, answer);
  }

  return clarify(deps, gap, answer);
}

function clarify(deps: SpecAmendDeps, gap: SpecGapReport, answer: AmendAnswer): SpecAmendmentResult {
  if (!gap.prdBody.includes(gap.criterion)) {
    throw new Error(
      `criterion not found verbatim in PRD #${gap.prdIssueNumber}'s body: ${JSON.stringify(gap.criterion)}`,
    );
  }

  const newBody = gap.prdBody.replace(gap.criterion, answer.clarifiedCriterion);

  // ADR-0079: clarifying, never adding. Arithmetic rather than trust — a
  // wording change that quietly grew a second checkbox is the one shape
  // this lane may never let through, whatever the model said about it.
  const before = countCriteria(gap.prdBody);
  const after = countCriteria(newBody);
  if (before !== after) {
    throw new Error(
      `refusing to land an amendment that changes PRD #${gap.prdIssueNumber}'s criteria count from ${before} to ${after} — a spec/gap amendment may clarify a criterion, never add one (ADR-0079)`,
    );
  }

  deps.gh(["issue", "comment", String(gap.prdIssueNumber), "--body", amendmentComment(gap, answer)]);
  recordAmendment(deps, gap, answer);

  return { verdict: "clarified", prdBody: newBody };
}

/**
 * The comment `clarify` posts — the whole write the PRD issue sees. Carries
 * `AMENDMENT_MARKER` so a later reader can find "the latest clarification"
 * the same way `rounds.ts`'s `roundFor` finds "the latest round," by
 * scanning comments rather than trusting a stored pointer.
 */
function amendmentComment(gap: SpecGapReport, answer: AmendAnswer): string {
  return [
    "## Spec amendment",
    "",
    `- ${gap.criterion}`,
    `+ ${answer.clarifiedCriterion}`,
    "",
    answer.reason,
    "",
    AMENDMENT_MARKER,
  ].join("\n");
}

function fileIdea(gh: GhExec, gap: SpecGapReport, answer: AmendAnswer): SpecAmendmentResult {
  const title = `Idea: ${gap.slice} needs new scope to close a spec gap on #${gap.prdIssueNumber}`;
  const body = ideaBody(gap, answer.reason);
  const created = gh(["issue", "create", "--title", title, "--body", body, "--label", IDEA_LABEL]);
  const ideaIssueNumber = parseIssueNumber(created, title);
  return { verdict: "refused", ideaIssueNumber, reason: answer.reason };
}

function ideaBody(gap: SpecGapReport, reason: string): string {
  return [
    `A \`spec/gap\` on #${gap.prdIssueNumber} named a criterion that no clarification can repair — only new scope would:`,
    "",
    `> ${gap.criterion}`,
    "",
    `Surfaced by ${gap.slice}. ${gap.gapReport}`,
    "",
    `## Why this is new scope, not a clarification`,
    reason,
  ].join("\n");
}

/** One amendment's audit-trail record — what changed on the PRD, and why. */
const AmendmentRecord = z.object({
  prdIssueNumber: z.number(),
  criterion: z.string(),
  clarifiedCriterion: z.string(),
  reason: z.string(),
});
type AmendmentRecord = z.infer<typeof AmendmentRecord>;

/**
 * Records a clarified amendment on `refs/notes/spec-amendments`, keyed to
 * `HEAD`, and pushes it straight to `main` — no PR, `notes-sync.ts`'s own
 * fetch-apply-push-retry so two amendments landing close together race the
 * same way any other notes writer in this tree already does.
 */
function recordAmendment(deps: SpecAmendDeps, gap: SpecGapReport, answer: AmendAnswer): void {
  const record: AmendmentRecord = {
    prdIssueNumber: gap.prdIssueNumber,
    criterion: gap.criterion,
    clarifiedCriterion: answer.clarifiedCriterion,
    reason: answer.reason,
  };

  syncNotesRef({
    git: deps.git,
    repoDir: deps.repoDir,
    ref: AMENDMENT_NOTES_REF,
    apply: () =>
      writeNoteArray({
        git: deps.git,
        repoDir: deps.repoDir,
        ref: AMENDMENT_NOTES_REF,
        commit: "HEAD",
        records: [record],
        schema: AmendmentRecord,
      }),
  });
}
