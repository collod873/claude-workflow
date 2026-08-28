import type { GhExec } from "../shared/gh";
import { numberedOpenQuestions } from "./open-questions";

/**
 * Lane 02's re-run loop (ADR-0062): a non-zero open-question count is the
 * only thing that reaches the owner, and his answering comment re-runs the
 * chain, which recomputes the count.
 *
 * Unlike lane 01's `roundFor` (`shape/rounds.ts`), this carries no cap field
 * at all — a structural absence, not a higher number. ADR-0062: *the
 * answering rounds are uncapped, and that is a deliberate departure from
 * §01. Lane 01 caps change requests at 2 because the owner is asking the
 * shaper to try again. Here the machine asked and the owner is answering,
 * and a cap would park a spec he is actively working on* — the
 * drain-onto-the-owner outcome ADR-0011 rules against, arriving from the
 * other direction.
 *
 * §1's substrate rule holds here too: the round is a fact about a work
 * item, recomputed from the issue's own comments on every run rather than
 * stored anywhere, which is what keeps it from ever going stale.
 */

const OPEN_QUESTIONS_MARKER = "<!-- spec-open-questions:v1 -->";

interface RawComment {
  body?: string;
}

function readComments(gh: GhExec, issueNumber: number): string[] {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  return (parsed.comments ?? []).map((comment) => comment.body ?? "");
}

/**
 * How many times lane 02 has posted its open questions on this spec —
 * recomputed from the issue's own comment list on every run, never stored.
 * There is no companion `capped` field: every round this counts is one the
 * chain is free to re-run.
 */
export function roundFor(gh: GhExec, issueNumber: number): number {
  return readComments(gh, issueNumber).filter((body) => body.includes(OPEN_QUESTIONS_MARKER)).length;
}

/**
 * The other side of the same list: every comment on the spec that is *not*
 * one of lane 02's own posted rounds — the owner's answers, in the order he
 * wrote them.
 *
 * The critic-only door (ADR-0085) reads these alongside the body. It has no
 * author behind it to redraft the spec, so without them a re-run would
 * re-report the same findings against unchanged text forever and the gate
 * count could never fall. Excluding this lane's own rounds is not tidiness:
 * feeding the critic its own previous findings back is how it would find them
 * again.
 */
export function answeringComments(gh: GhExec, issueNumber: number): string[] {
  return readComments(gh, issueNumber).filter((body) => !body.includes(OPEN_QUESTIONS_MARKER));
}

/**
 * The comment lane 02 posts when the gate count is non-zero — ADR-0062:
 * "a non-zero count is the only thing that reaches the owner." Nothing of
 * the draft's `body` rides along; the numbered questions are the whole
 * comment. Carries `OPEN_QUESTIONS_MARKER` so `roundFor` counts it as a
 * round the next run answers.
 */
export function openQuestionsComment(openQuestions: string[]): string {
  return `${numberedOpenQuestions(openQuestions)}\n\n${OPEN_QUESTIONS_MARKER}`;
}

/** Posts `openQuestionsComment`'s body to the spec issue. */
export function postOpenQuestions(gh: GhExec, issueNumber: number, openQuestions: string[]): void {
  gh(["issue", "comment", String(issueNumber), "--body", openQuestionsComment(openQuestions)]);
}
