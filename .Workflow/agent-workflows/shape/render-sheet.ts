import { sheetMarker } from "../shared/marker";
import type { Sheet } from "../shared/sheet-schema";

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
    .map((entry) => `- [${entry.ref}](${entry.url}): ${entry.bearing}`)
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

function renderSurvivors(sheet: Sheet): string[] {
  if (sheet.survivors.length === 0) {
    return [];
  }
  const lines = sheet.survivors.map((line) => `- ${line}`).join("\n");
  return [`## Surviving refutations\n\n${lines}`];
}
