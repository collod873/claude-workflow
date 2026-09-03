import type { MarkedDecision } from "./open-questions";

/**
 * The spec author's contract — what it may reach, what it is handed, what it hands back — as a
 * leaf module. `spec.ts` orchestrates the lane and imports every sub-module (`sweep.ts`,
 * `reconcile.ts`, `publish.ts`, the collectors); those sub-modules need these three names and
 * nothing else from the orchestrator, so they read them here rather than from `spec.ts` and the
 * import graph stays a tree. `spec.ts` re-exports them, so the lane's door is unchanged.
 */

/**
 * The only three tools the spec author may reach, enforced by the CLI
 * (ADR-0060): it may read the repository without limit, but must reach no
 * second source of intent — no `Bash`, no web, no subagent spawner, nothing
 * that could see an issue tracker, a transcript, or someone else's spec but
 * the Decided context its collector assembled. `spec.test.ts` asserts this
 * list reaches the argv as `--allowedTools`, because a prompt-only
 * prohibition would leave nothing that looked different.
 */
export const SPEC_AUTHOR_ALLOWED_TOOLS = ["Read", "Grep", "Glob"];

/**
 * `CONTEXT.md`'s **Decided context**: the owner's words verbatim, the
 * decisions with their reasons, the rulings already filed, the boundaries,
 * and the guesses still open. One shape, however a trigger's collector
 * assembled it — the difference between triggers belongs in the collector,
 * never in the author (ADR-0058).
 */
export interface DecidedContext {
  /** The owner's own words, never paraphrased. */
  ownerWords: string;
  /** The decisions on record, each with its reason. */
  decisions: string;
  /** The rulings already filed — ADR paths and what they settled. */
  rulings: string;
  /** The boundaries already drawn for this idea. */
  boundaries: string;
  /** What is still open — guesses nobody has confirmed. */
  openGuesses: string;
}

/**
 * What the spec author hands back: a `PRD:` issue ready to post, plus what
 * it had to ask rather than invent. `openQuestions` is empty when nothing
 * needed guessing — `CONTEXT.md`'s **Open question**, numbered by position
 * when this is rendered.
 *
 * `decisions` is the *collector's*, not the model's: the sheet's own marked
 * decisions, riding out on the author's return value so that `runSpecAuthor`
 * can find its own unfiled marks — ADR-0061's arithmetic — without reading
 * the source issue a second time (a second read is a second chance for the
 * two to disagree). It is `[]` for every door that carries no marks — the
 * map collector, and a `DecidedContext` handed to `runSpecAuthor` already
 * assembled.
 */
export interface SpecAuthorOutput {
  title: string;
  body: string;
  openQuestions: string[];
  decisions: MarkedDecision[];
}
