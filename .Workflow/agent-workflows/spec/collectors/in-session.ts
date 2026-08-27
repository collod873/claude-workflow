import type { DecidedContext } from "../spec";

/**
 * Lane 02's collector for the in-session trigger (ADR-0058): the owner, in a
 * live grill, running `/to-spec`. Unlike the sheet and map collectors, this
 * one fetches nothing — the conversation the owner is already sitting in
 * **is** the Decided context, verbatim.
 *
 * ADR-0058 rejected serialising this trigger so a runner could read it back:
 * *"lossy compression that pays double tokens for less signal."* What
 * changes here is only that the local door stops being a second
 * implementation of the spec author — one prompt file, two callers, and this
 * caller passes the live conversation where the cloud caller passes a
 * collected payload. So this collector does not attempt to split the
 * conversation into five distinct fields the way a fetched sheet or map
 * naturally falls into sections; every field carries the same transcript,
 * because there is nothing else to normalize it out of.
 */
export function collectInSessionContext(conversation: string): DecidedContext {
  if (!conversation.trim()) {
    throw new Error("in-session collector: no conversation to collect the Decided context from");
  }

  const note = "Carried in the conversation above — nothing to normalize out of it.";
  return {
    ownerWords: conversation,
    decisions: note,
    rulings: note,
    boundaries: note,
    openGuesses: note,
  };
}
