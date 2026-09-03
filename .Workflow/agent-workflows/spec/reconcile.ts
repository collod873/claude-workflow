import { z } from "zod";
import { countCriteria } from "../shared/ticket-shape";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import type { Resolution } from "./critic";
import { SPEC_AUTHOR_ALLOWED_TOOLS } from "./author-contract";

/**
 * Lane 02's reconciler ([ADR-0100](../../../docs/adr/0100-the-critique-door-re-authors-the-spec-body-from-the-answered.md),
 * amended by the sweep-and-pen redesign): the stage that folds what lane 02
 * decided on its own authority back into the spec body, so the body is the
 * ledger rather than the comment thread.
 *
 * ADR-0085's warm door runs a critic and no author, so every ruling the
 * critic settled used to live in the comments and nowhere else. Lane 03
 * slices the *body*, and `affectedSlices` (`shared/affected-tests.ts`) diffs
 * a slice's test-named criteria against the body verbatim — so a criterion
 * that only ever existed in a comment is one lane 04's re-entry trigger
 * reads as lost forever. #189 went thirteen rounds through the old
 * owner-answers door and #190 shipped the re-export round nine had
 * explicitly ruled against, correctly, against the ticket it was given.
 *
 * **What it folds in changed; what it does with it did not.** It used to
 * fold in the owner's answers. It now folds in the critic's own
 * resolutions — "the critic decides each finding rather than posting it,
 * so the reconciler writes the decisions into the body as it already wrote
 * answers." Same writer, same contract, same guarantee, one less human in
 * the middle.
 *
 * **It revises; it does not re-invent.** The body it is handed is the
 * draft's own and the resolutions are the only licence it has to change a
 * word of it — it rewrites the criteria a resolution sharpened, adds a
 * stated assumption for each one, and leaves everything else alone.
 *
 * **The never-drop bound is arithmetic, not a promise in a prompt.** The
 * checkbox lines `ticket-shape.ts`'s `countCriteria` finds in the body it
 * was handed are counted, the checkbox lines in the body it returns are
 * counted, and a rewrite that comes back with fewer is refused before
 * anything is written — no edit, no label, no dispatch. A bound enforced
 * only by the prompt that states it is fail-open, and there is no longer an
 * owner reading the output to notice.
 */

/** §3: the same low-volume, high-consequence work the author and the critic already run on. */
export const SPEC_RECONCILE_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/reconcile/prompt.md";

/** The spec as it stands, and the resolutions that are about to be folded into it. */
export interface SpecReconcileInput {
  /** The spec's own title, shown for context — the reconciler never rewrites it. */
  title: string;
  /**
   * The published body, with its `spec-source:v1` trailer already stripped
   * (`publish.ts`'s `withoutSourceMarker`). The trailer is re-appended by the
   * write, so a body handed over carrying one would come back either duplicated
   * or deleted depending on how the model read it.
   */
  body: string;
  /**
   * What lane 02 decided on its own authority — the critic's resolutions,
   * and (`spec.ts`'s job to assemble) the sheet's own unfiled load-bearing
   * marks, each already carrying a decision and a reason. Never empty when
   * this stage is called — `spec.ts` guards the call on this list being
   * non-empty, the same shape ADR-0100 guarded on the answering-comment list.
   */
  resolutions: Resolution[];
}

/**
 * The rewritten body, and nothing else.
 *
 * `wrapIn` rather than an object schema: what this stage produces *is* a body,
 * and a one-field result type would make every call site unwrap a value that
 * was never a record. The wire shape is still object-rooted, which is the one
 * thing the API insists on.
 */
export const SPEC_RECONCILE_OUTPUT = structuredOutput(z.string().min(1), "body");

/** One resolution, formatted for the prompt as a decision and its reason. */
function formatResolution(resolution: Resolution): string {
  return `Decision: ${resolution.decision}\nReason: ${resolution.reason}`;
}

/** The heading the assumptions section is spelled with, wherever it is written or read. */
const ASSUMPTIONS_HEADING = "## Assumptions";

/** One resolution as the line the owner reads: what was decided, in bold, and why. */
function assumptionLine(resolution: Resolution): string {
  return `- **${resolution.decision}** ${resolution.reason}`;
}

/**
 * The body with everything under `## Assumptions` removed — the rest of the document untouched,
 * including a heading that follows the section.
 */
function withoutAssumptions(body: string): string[] {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === ASSUMPTIONS_HEADING);
  if (start === -1) return lines;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return [...lines.slice(0, start), ...(end === -1 ? [] : rest.slice(end))];
}

/**
 * Writes the assumptions section from the resolutions themselves, replacing whatever the model
 * wrote under that heading.
 *
 * **Why this is code and not the prompt.** `reconcile/prompt.md` asks for the section, and an
 * earlier draft of this stage stopped there. But the section is the whole safety mechanism of the
 * redesign — the owner reads this list *instead of* answering questions — and there is no longer
 * anyone reading the output to notice a model quietly left it out. That is the same argument the
 * never-drop bound below is built on, so it gets the same treatment: derived from the input, not
 * requested of a model. The prompt's copy stays, because a model that knows the section is coming
 * writes the criteria around it better than one surprised by it.
 *
 * It goes last, after the prose the model returned, so a resolution is never spliced between a
 * criterion and the heading it sits under.
 */
function withAssumptions(body: string, resolutions: Resolution[]): string {
  const kept = withoutAssumptions(body);
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") kept.pop();

  return [...kept, "", ASSUMPTIONS_HEADING, "", ...resolutions.map(assumptionLine)].join("\n");
}

/**
 * Runs the reconciler on one drafted or published spec and returns the body
 * it should now read as — after checking that the rewrite dropped no
 * acceptance criterion.
 *
 * On the author's own toolbelt (ADR-0060's `SPEC_AUTHOR_ALLOWED_TOOLS`, shared
 * rather than copied): this stage writes spec prose, so it needs the repository
 * for the same reason the author does and must reach no second source of intent
 * for the same reason too — the body and the resolutions it was handed are the
 * whole of what it may act on.
 *
 * On stdin, because a spec body plus every resolution on it has no upper bound
 * by construction.
 *
 * **The never-drop bound.** `countCriteria` (`shared/ticket-shape.ts`) counts
 * the checkbox lines in the body handed over and in the body that comes back;
 * a rewrite with fewer throws before this function returns, so no caller of
 * this stage ever writes a body that dropped a criterion.
 */
export async function runSpecReconciler(
  exec: StageExec,
  input: SpecReconcileInput,
): Promise<string> {
  const body = await runStage(
    PROMPT_PATH,
    {
      TITLE: input.title,
      BODY: input.body,
      RESOLUTIONS: input.resolutions.map(formatResolution).join("\n\n---\n\n"),
    },
    exec,
    SPEC_RECONCILE_OUTPUT,
    {
      model: SPEC_RECONCILE_MODEL,
      allowedTools: SPEC_AUTHOR_ALLOWED_TOOLS,
      promptViaStdin: true,
      stage: "reconcile",
    },
  );

  const before = countCriteria(input.body) ?? 0;
  const after = countCriteria(body) ?? 0;
  if (after < before) {
    throw new Error(
      `reconciler returned ${after} acceptance criteria, fewer than the ${before} it was handed — ` +
        "refusing to write a rewrite that dropped one",
    );
  }

  return withAssumptions(body, input.resolutions);
}
