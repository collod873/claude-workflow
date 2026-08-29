import { z } from "zod";
import { runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import { SPEC_AUTHOR_ALLOWED_TOOLS } from "./spec";

/**
 * Lane 02's reconciler ([ADR-0100](../../../docs/adr/0100-the-critique-door-re-authors-the-spec-body-from-the-answered.md)):
 * the stage that folds the critique door's settled rounds back into the spec
 * body, so the body is the ledger rather than the comment thread.
 *
 * ADR-0085's warm door runs a critic and no author, so every ruling the critic
 * and the owner settled between them used to live in the comments and nowhere
 * else. Lane 03 slices the *body*, and `affectedSlices`
 * (`shared/affected-tests.ts`) diffs a slice's test-named criteria against the
 * body verbatim — so a criterion that only ever existed in a comment is one
 * lane 04's re-entry trigger reads as lost forever. #189 went thirteen rounds
 * through that door and #190 shipped the re-export round nine had explicitly
 * ruled against, correctly, against the ticket it was given.
 *
 * **It revises; it does not re-invent.** The body it is handed is the owner's
 * and the answers are the only licence it has to change a word of it — it
 * rewrites the criteria the rounds changed, adds the ones the rounds added,
 * and leaves everything else alone. A stage free to redraft the spec would put
 * text in front of lane 03 that nobody ever cleared, on a run that no longer
 * has a round left to argue it in.
 */

/** §3: the same low-volume, high-consequence work the author and the critic already run on. */
export const SPEC_RECONCILE_MODEL = "claude-opus-5";

const PROMPT_PATH = ".Workflow/agent-workflows/spec/reconcile/prompt.md";

/** The spec as it stands, and the answers that are about to be folded into it. */
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
  /** The owner's answering comments, in the order he wrote them — `rounds.ts`'s `answeringComments`. */
  answers: string[];
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

/**
 * Runs the reconciler on one answered spec and returns the body it should now
 * read as.
 *
 * On the author's own toolbelt (ADR-0060's `SPEC_AUTHOR_ALLOWED_TOOLS`, shared
 * rather than copied): this stage writes spec prose, so it needs the repository
 * for the same reason the author does and must reach no second source of intent
 * for the same reason too — the body and the owner's answers are the whole of
 * what it may act on.
 *
 * On stdin, because a spec body plus every comment on it has no upper bound by
 * construction.
 */
export async function runSpecReconciler(
  exec: StageExec,
  input: SpecReconcileInput,
): Promise<string> {
  return runStage(
    PROMPT_PATH,
    {
      TITLE: input.title,
      BODY: input.body,
      ANSWERS: input.answers.join("\n\n---\n\n"),
    },
    exec,
    SPEC_RECONCILE_OUTPUT,
    {
      model: SPEC_RECONCILE_MODEL,
      allowedTools: SPEC_AUTHOR_ALLOWED_TOOLS,
      promptViaStdin: true,
    },
  );
}
