import { parseGrammarFindings } from "./grammar";

export interface ViolationLensInput {
  standards: string;
  diff: string;
  spine: string;
}

export function violationPrompt(input: ViolationLensInput): string {
  const { standards, diff, spine } = input;
  return `You are the VIOLATION lens, one pass over one session's own commits.

## Ratified standards

Every already-ratified entry in \`CODING_STANDARDS.md\`. Each states a ruling, the red flag that
spots a violation, and why it exists. Nothing here is a suggestion — every entry already went
through standards-pass and was ratified. Your only job is finding where the diff below violates one
of them; you never propose a new entry, and a rule a linter already enforces is not yours to repeat.

${standards}

## Session spine

The session's own words — what it was trying to do. Context for the diff, not something to grade on
its own.

${spine}

## Diff

The session's own commit range, restricted to the paths its transcript names. This is the only code
you grade.

${diff}

## What to do

Read every ratified entry above, then read the diff. For each site in the diff that violates a
ratified entry's red flag, note it. Say nothing about an entry the diff never touches — a lens that
speaks about code it wasn't shown is worse than a lens that finds nothing.

## Output

One block per violation, in exactly this form, repeated for each:

Finding: <the ratified entry it violates, quoted, and why the red flag fires here>
Site: <file:line where this run saw it — a path and a line number, nothing else. No function name,
no parenthetical, no "~line". A reader resolves this as a path, so anything past it is lost.>

Output only these two labels, once per violation, and nothing else — no other labeled field. If the
diff violates no ratified entry, say so plainly and stop — an empty pass is a valid pass.
`;
}

export interface ViolationFinding {
  finding: string;
  site: string;
}

export function parseViolationFindings(raw: string): ViolationFinding[] {
  return parseGrammarFindings(raw);
}
