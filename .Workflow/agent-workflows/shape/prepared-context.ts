import type { ReadingListItem, PriorArt } from "../shared/sweep-schema";

export type Fetch = (ref: string) => string | undefined;

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

export function renderPriorArt(priorArt: PriorArt[]): string {
  if (priorArt.length === 0) {
    return "_Nothing found. `none found` is a legal line on the sheet._";
  }
  return priorArt
    .map((entry) => `- **${entry.ref}** (${entry.verdict}) — ${entry.bearing}\n  ${entry.url}`)
    .join("\n");
}

export function renderChangeRequest(changeRequest: string): string {
  const trimmed = changeRequest.trim();
  if (trimmed === "") return "";

  return `## The owner's change request

He read the last sheet and said this. It is the reason you are running again — answer it in the sheet itself, not in prose around it.

> ${trimmed.split("\n").join("\n> ")}`;
}

export function renderReSweepAnswer(needs: string): string {
  return `## Your re-sweep came back

You asked for: ${needs}

Whatever the sweep found for it is on the reading list above — including nothing, if it found nothing. **This is your last pass.** Emit a sheet. If the gap is still open, mark the decision it affects, point the mark at the gap, and write the sheet anyway.`;
}
