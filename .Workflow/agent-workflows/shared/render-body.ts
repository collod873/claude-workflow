import type { Slice } from "./plan-schema";

/**
 * Renders one slice as a published ticket body: four fixed headings —
 * `Parent PRD`, `What to build`, `Acceptance criteria`, `Files claimed` — in
 * that order, followed by the seam manifest lines this slice consumes (if
 * any), which are prose it read, never a file it claims. Carries no
 * `Closes` directive: closing a ticket belongs to whatever implements it,
 * closing the PRD belongs to the merged PR.
 */
export function renderBody(slice: Slice, prdNumber: number): string {
  const criteria = slice.acceptanceCriteria.map((item) => `- [ ] ${item}`).join("\n");

  const files =
    slice.filesClaimed.length > 0
      ? slice.filesClaimed.map((path) => `- ${path}`).join("\n")
      : "- None — no files.";

  const seams =
    slice.seamsConsumed.length > 0
      ? `\n\n## Seams consumed\n\n${slice.seamsConsumed.join("\n")}`
      : "";

  return `## Parent PRD
#${prdNumber}

## What to build
${slice.whatToBuild}

## Acceptance criteria
${criteria}

## Files claimed
${files}${seams}
`;
}
