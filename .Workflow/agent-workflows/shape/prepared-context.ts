import type { ReadingListItem, PriorArt } from "../shared/sweep-schema";

/**
 * The shaper's whole world, rendered.
 *
 * [ADR-0030](../../../docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md)
 * takes the shaper's tools away, which turns the reading list from a list of
 * places it could look into the only thing it will ever see. So the list is
 * **fetched here and injected in full** — a stage with no `Read` tool holding
 * a list of paths has a list of things it cannot open, which is the same as
 * having nothing.
 *
 * There is no count cap, per that ADR: the bound is relevance, and starving
 * this input causes §01's named failure — *a confident, coherent sheet
 * resting on a wrong premise* — rather than preventing it.
 */

/** Fetches one reading-list ref, or `undefined` when it cannot be read. */
export type Fetch = (ref: string) => string | undefined;

/**
 * Renders the reading list as the section the shaper's prompt injects.
 *
 * An item that cannot be fetched is **dropped with a line saying so**, rather
 * than silently or fatally. A sweep naming a path that does not exist has
 * made a mistake the shaper cannot fix and the owner should not pay for; but
 * a dropped item that vanished without trace would leave the shaper's context
 * quietly smaller than the run believes it to be, which is the one thing this
 * lane cannot afford to be wrong about.
 */
export function renderReadingList(items: ReadingListItem[], fetch: Fetch): string {
  if (items.length === 0) {
    return "_The sweep listed nothing. Everything you know is above._";
  }

  const rendered: string[] = [];
  for (const item of items) {
    const content = fetch(item.ref);
    if (content === undefined) {
      rendered.push(`### ${item.ref}\n\n_Could not be read; dropped from your context._`);
      continue;
    }
    rendered.push(`### ${item.ref}\n\n_On the list because: ${item.because}_\n\n${content}`);
  }
  return rendered.join("\n\n---\n\n");
}

/**
 * Renders what the sweep found, for the shaper to draw its own (capped) Prior
 * art section from. Carries the verdicts as well as the prose: a `related` hit
 * the gate let through is still something the shaper should weigh, and it is
 * the only signal it gets that the sweep looked at all.
 */
export function renderPriorArt(priorArt: PriorArt[]): string {
  if (priorArt.length === 0) {
    return "_Nothing found. `none found` is a legal line on the sheet._";
  }
  return priorArt
    .map((entry) => `- **${entry.ref}** (${entry.verdict}) — ${entry.bearing}\n  ${entry.url}`)
    .join("\n");
}

/**
 * Renders the owner's change request, or the empty string when this is the
 * first round. The empty string is load-bearing: the prompt template carries
 * this placeholder unconditionally, and a first-round sheet must not read as
 * though it were answering feedback nobody gave.
 */
export function renderChangeRequest(changeRequest: string): string {
  const trimmed = changeRequest.trim();
  if (trimmed === "") return "";

  return `## The owner's change request

He read the last sheet and said this. It is the reason you are running again — answer it in the sheet itself, not in prose around it.

> ${trimmed.split("\n").join("\n> ")}`;
}

/**
 * The second-pass instruction, when the shaper spent its one re-sweep
 * (ADR-0030). Named here rather than in the prompt file because the prompt is
 * one template used by both passes, and the difference between them is
 * exactly this paragraph.
 */
export function renderReSweepAnswer(needs: string): string {
  return `## Your re-sweep came back

You asked for: ${needs}

Whatever the sweep found for it is on the reading list above — including nothing, if it found nothing. **This is your last pass.** Emit a sheet. If the gap is still open, mark the decision it affects, point the mark at the gap, and write the sheet anyway.`;
}
