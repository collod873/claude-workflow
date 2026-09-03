import { readFileSync } from "node:fs";
import { reason } from "../shared/reason";

/**
 * The one spec-body contract every producer references rather than restates —
 * `docs/agents/spec-format.md`.
 *
 * Lane 02 has two stages that write a spec body: the author drafts one, and the reconciler
 * rewrites one. Both take the contract by injection as `{{SPEC_FORMAT}}`, the same way
 * `to-tickets.ts` injects `{{TICKET_FORMAT}}` into the slicer: an instruction to read a file is
 * something a model can decline, and `runStage`'s substitution throws on an uncovered `{{VAR}}`
 * before spending model time, which makes the contract a precondition rather than a request
 * (ADR-0044, ADR-0082).
 *
 * Until this existed the lane took nothing — no format doc, no validator call — so a spec the
 * cold door authored could land in a shape `bin/close-ticket --spec` had no command to close it
 * on. The session door (`/to-spec` → `~/bin/file-issue spec`) was already held to
 * `validate("spec", …)`; that asymmetry is what this closes on the read side, and
 * `publish.ts`'s `validateSpecBody` closes on the write side.
 */
const SPEC_FORMAT_PATH = "docs/agents/spec-format.md";

/**
 * `docs/agents/spec-format.md` cut to the core plus the `### Lane spec` variant — the only
 * variant these two stages ever produce. The session variant would cost tokens and teach the
 * wrong thing: it describes a body whose one criterion is a sentence the owner finishes on the
 * spot, and there is nobody in the room on a runner.
 *
 * Cuts at `## Variants` rather than at the first `### `, so the core keeps its own subsections
 * whatever heading depth the doc uses to organise them — the contract's rules are the part the
 * stage most needs and the part a depth-sensitive split silently drops.
 */
export function specFormat(): string {
  let page: string;
  try {
    page = readFileSync(SPEC_FORMAT_PATH, "utf8");
  } catch (err) {
    throw new Error(`the spec contract at ${SPEC_FORMAT_PATH} could not be read: ${reason(err)}`);
  }

  const [core, variants] = page.split(/^## Variants[ \t]*$/m);
  const laneSpec = variants
    ?.split(/^### /m)
    .find((section) => section.startsWith("Lane spec"));
  if (!core?.trim() || !laneSpec) {
    throw new Error(
      `${SPEC_FORMAT_PATH} has no "### Lane spec" variant under "## Variants" — the author's spec contract would be empty`,
    );
  }
  return `${core.trim()}\n\n## Variants\n\n### ${laneSpec.trim()}\n`;
}
