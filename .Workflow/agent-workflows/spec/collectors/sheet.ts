import { issueComments, type GhExec } from "../../shared/gh";
import { issueBody } from "../../shared/issue-body";
import { readAcceptedMarker, readSheetMarker, type AcceptedPayload } from "../../shared/marker";
import type { Decision, Sheet } from "../../shared/sheet-schema";
import type { MarkedDecision } from "../open-questions";
import type { DecidedContext } from "../author-contract";

/**
 * Lane 02's collector for the accepted-sheet trigger (ADR-0058): reads one
 * *Decided context* — the same five-field shape every trigger's collector
 * assembles for the spec author — out of the idea issue `approved` just
 * fired on.
 *
 * **The accept's marker, never its prose.** §01 requires the spec author to
 * cite the rulings an accept filed rather than restate them, and the ADR
 * paths `bin/new-adr` assigns are decided at accept time — they appear
 * nowhere on the sheet itself. `marker.ts` carries that payload precisely so
 * this collector never has to parse `acceptComment`'s rendered markdown for
 * it; reaching for the prose instead would be the exact failure the marker
 * was built to prevent, arriving one comment later. So a payload that is
 * absent — including an old bare `<!-- shape-accepted:v1 -->` written before
 * this payload existed — is a collector failure, not a fallback.
 */


/**
 * Assembles the Decided context for one accepted idea, and hands back the
 * sheet's own decisions alongside it.
 *
 * **Two returns because the context flattens.** `context` is the five-field
 * `DecidedContext` every collector normalizes into, unchanged field for
 * field — and its own `decisions` field is *prose*, the sheet's decisions
 * rendered for a model to read. ADR-0061's arithmetic needs the marks
 * themselves: which decision carries a mark, and whether an ADR title was
 * ever drafted for it. Those survive the rendering nowhere, so widening
 * `DecidedContext` would either mean two meanings for one field name or a
 * sixth field the map collector has nothing to put in. The wrapper keeps the
 * shared shape shared and lets the sheet trigger carry the extra it alone
 * has.
 *
 * The decisions ride out here rather than being re-read downstream because a
 * second read of the same issue is a second chance for the two reads to
 * disagree.
 *
 * Throws when the idea carries no sheet, or the accept that fired this run
 * carries no readable payload — both are collector failures, because there
 * is no prose fallback for either (see the header comment above).
 */
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

/** The sheet's decisions, each with the reason it was made and what was rejected. */
function formatDecisions(decisions: Decision[]): string {
  if (decisions.length === 0) return "None recorded.";
  return decisions
    .map((decision) => `- ${decision.question}\n  ${decision.recommendation}\n  (Rejected: ${decision.rejected})`)
    .join("\n");
}

/**
 * The rulings already filed, cited by path — the payload's whole reason to
 * exist — plus the terms this accept coined, since both are the record an
 * accept leaves that the sheet itself does not carry.
 */
function formatRulings(payload: AcceptedPayload): string {
  const adrs =
    payload.adrPaths.length === 0
      ? "No rulings were filed."
      : payload.adrPaths.map((path) => `- ${path}`).join("\n");
  const terms =
    payload.coinedTerms.length === 0 ? "" : `\n\nCoined: ${payload.coinedTerms.join(", ")}`;
  return `${adrs}${terms}`;
}

/** What the refuter's survivors leave still open — the sheet's own account of what nobody resolved. */
function formatOpenGuesses(survivors: string[]): string {
  if (survivors.length === 0) return "None.";
  return survivors.map((survivor) => `- ${survivor}`).join("\n");
}
