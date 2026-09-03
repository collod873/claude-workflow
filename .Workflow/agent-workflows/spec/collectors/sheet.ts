import { issueComments, type GhExec } from "../../shared/gh";
import { issueBody } from "../../shared/issue-body";
import { readAcceptedMarker, readSheetMarker, type AcceptedPayload } from "../../shared/marker";
import type { Decision, Sheet } from "../../shared/sheet-schema";
import type { MarkedDecision } from "../open-questions";
import type { DecidedContext } from "../author-contract";

export function collectSheetContext(
  gh: GhExec,
  issueNumber: number,
): { context: DecidedContext; decisions: MarkedDecision[] } {
  const bodies = issueComments(gh, issueNumber);

  const sheets = bodies.map(readSheetMarker).filter((each): each is Sheet => each !== undefined);
  const sheet = sheets.at(-1);
  if (!sheet) {
    throw new Error(`sheet collector: issue #${issueNumber} carries no decision sheet`);
  }

  const payloads = bodies
    .map(readAcceptedMarker)
    .filter((each): each is AcceptedPayload => each !== undefined);
  const payload = payloads.at(-1);
  if (!payload) {
    throw new Error(
      `sheet collector: issue #${issueNumber} carries no accept payload — reading the rendered ` +
        `comment prose instead is exactly what the marker's payload exists to prevent (ADR-0058)`,
    );
  }

  return {
    context: {
      ownerWords: issueBody(gh, issueNumber),
      decisions: formatDecisions(sheet.decisions),
      rulings: formatRulings(payload),
      boundaries: `Route: \`${payload.route}\` — ${sheet.routeReason}`,
      openGuesses: formatOpenGuesses(sheet.survivors),
    },
    decisions: sheet.decisions,
  };
}

function formatDecisions(decisions: Decision[]): string {
  if (decisions.length === 0) return "None recorded.";
  return decisions
    .map((decision) => `- ${decision.question}\n  ${decision.recommendation}\n  (Rejected: ${decision.rejected})`)
    .join("\n");
}

function formatRulings(payload: AcceptedPayload): string {
  const adrs =
    payload.adrPaths.length === 0
      ? "No rulings were filed."
      : payload.adrPaths.map((path) => `- ${path}`).join("\n");
  const terms =
    payload.coinedTerms.length === 0 ? "" : `\n\nCoined: ${payload.coinedTerms.join(", ")}`;
  return `${adrs}${terms}`;
}

function formatOpenGuesses(survivors: string[]): string {
  if (survivors.length === 0) return "None.";
  return survivors.map((survivor) => `- ${survivor}`).join("\n");
}
