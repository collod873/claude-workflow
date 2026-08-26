import { sheetMarker } from "./marker";
import type { Sheet } from "./sheet-schema";

/**
 * The decision sheet as the owner reads it: five sections, in §01's order,
 * and no others.
 *
 * | Section | Cap |
 * |---|---|
 * | Restatement | ≤ 1 paragraph |
 * | Prior art | ≤ 3 lines, each a link plus why it bears on this idea |
 * | Decisions | ≤ 5, the recommended answer and the alternative rejected |
 * | Surviving refutations | ≤ 3 lines, **absent** when the refuter is silent |
 * | Route | 1 line |
 *
 * The caps are already applied by the time this runs (`sheet.ts`); this
 * renders what survived them. Two shapes here are load-bearing rather than
 * cosmetic:
 *
 * - **`none found` is a legal Prior art line, and `none` is not a legal
 *   refutation line.** §01 is explicit about the asymmetry. Prior art earns
 *   its funded space because it is the only section that can pre-empt the
 *   whole sheet, so its absence is worth a line saying so. A refuter that
 *   agreed has nothing to say, and a section saying it said nothing spends
 *   the owner's screen on furniture.
 * - **The mark renders as the thing that moves**, not as a warning glyph with
 *   prose after it (ADR-0028). What is on the page is the pointer, because
 *   the pointer is what the owner checks.
 */
export function renderSheet(sheet: Sheet): string {
  const sections = [
    `## Restatement\n\n${sheet.restatement}`,
    `## Prior art\n\n${renderPriorArt(sheet)}`,
    `## Decisions\n\n${renderDecisions(sheet)}`,
    ...renderSurvivors(sheet),
    `## Route\n\n${sheet.routeReason}`,
  ];

  return `${sections.join("\n\n")}\n\n${sheetMarker(sheet)}`;
}

function renderPriorArt(sheet: Sheet): string {
  if (sheet.priorArt.length === 0) {
    return "`none found`";
  }
  return sheet.priorArt
    .map((entry) => `- [${entry.ref}](${entry.url}) — ${entry.bearing}`)
    .join("\n");
}

function renderDecisions(sheet: Sheet): string {
  return sheet.decisions
    .map((decision, index) => {
      const mark = decision.mark === "" ? "" : `\n  **Moves if this flips:** ${decision.mark}`;
      return `**${index + 1}. ${decision.question}**\n  ${decision.recommendation}\n  *Rejected:* ${decision.rejected}${mark}`;
    })
    .join("\n\n");
}

/** An array so an empty one contributes no section at all, rather than an empty heading. */
function renderSurvivors(sheet: Sheet): string[] {
  if (sheet.survivors.length === 0) {
    return [];
  }
  const lines = sheet.survivors.map((line) => `- ${line}`).join("\n");
  return [`## Surviving refutations\n\n${lines}`];
}
