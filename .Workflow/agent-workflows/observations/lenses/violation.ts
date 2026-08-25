/**
 * Everything the VIOLATION lens's prompt is built from. The spawned call it
 * feeds runs sandboxed with `--tools ""` (auditor.ts) — no tool access — so
 * every input the lens reads has to already be text here; there is nothing
 * on the other end to read a file with.
 */
export interface ViolationLensInput {
  /** Ratified `CODING_STANDARDS.md` text, verbatim — every entry the diff is checked against. */
  standards: string;
  /** The session's own scoped diff (`observations/diff.ts`'s `sessionRangeDiff`). */
  diff: string;
  /** The session's captured conversation spine (capture's own format, spec #36 slice 1) — context for what the diff was trying to do. */
  spine: string;
}

/**
 * Builds the VIOLATION lens's prompt: the one lens the auditor runs (spec
 * #36 slice 3; PROPOSED is a separate pass, not built here). VIOLATION
 * checks a diff against `CODING_STANDARDS.md` entries already ratified —
 * the only enforcement a prose standard gets, since an entry a linter can
 * express leaves the file by becoming mechanised (`CODING_STANDARDS.md`'s
 * own header) and stops being VIOLATION's job. It never proposes a new
 * entry, and it never repeats a standard the diff doesn't touch — a lens
 * that speaks about code it wasn't shown is the failure mode this exists to
 * avoid.
 */
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

One finding per violated entry: the file and line, the entry it violates (quoted), and why the red
flag fires there. If the diff violates no ratified entry, say so plainly and stop — an empty pass is
a valid pass.
`;
}
