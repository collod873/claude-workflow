import {
  PATH_LINE_RE,
  countCriteria,
  normalizeNewlines,
} from "../shared/ticket-shape";

/**
 * The closing-record grammar, and the arithmetic-and-regex judgement passed
 * over it. Ported from era 6's `hooks/close-gate.py`, which held the same
 * grammar for a PreToolUse hook on the workstation.
 *
 * **Nothing in this module knows where a close came from.** The hook it was
 * ported from spent most of its length on that question — which shell
 * command counts as a close, which `cd` moved the working directory first,
 * whether a `--comment` was single-quoted, double-quoted or a heredoc.
 * Moving the gate to `issues.closed` deletes all of it: the tracker hands
 * over the issue and its comments directly, so there is no command line to
 * parse and no way to phrase a close that this reader does not see. That
 * deletion is the whole point of the venue move, not a side effect of it.
 *
 * The grammar this parses, unchanged from era 6 so a record written for one
 * venue reads identically in the other:
 *
 *     ## Closing record
 *
 *     `<base>..<head>`
 *
 *     - <criterion text> — MET: `<path>:<line>`
 *     - <criterion text> — MET: `<command>` exit 0
 *     - <criterion text> — UNMET: <what's missing>
 *
 * The range stands on its own line, never as a list item: a leading `- `
 * would be miscounted as a bullet, and standing alone is also what lets
 * either side be any git revspec — a sha, a ref, a tag, a slashed branch
 * name — without stray prose inside a bullet passing for a range.
 *
 * `No diff.` may stand where the range does, for a close that carries no
 * commit. It excuses that line and nothing else: the bullets are still
 * counted against the issue's criteria and still have to carry verdicts and
 * shaped evidence (ADR-0022). It passes on its own only where the issue body
 * declares no criteria at all.
 *
 * **Declared ceiling, inherited intact.** A well-shaped lie passes. This
 * checks the record's structure only. Whether the evidence was truly
 * observed inside the declared range is outside it, and always was:
 * `unmet-criterion` fired exactly once in 558 era-6 rows, so this is an
 * active compliance mechanism and is not a correctness one. Nothing should
 * be built on a claim that it is.
 */

/** The heading a comment must open with to be read as a closing record. */
export const RECORD_HEADING = "## Closing record";

/**
 * A revspec: either side of the range. Widened from hex in era 6 because a
 * branch's base is a ref (`main..HEAD`) as often as a sha, and demanding
 * hex refused records written exactly as the grammar instructs. Safe only
 * because the range is anchored to its own line, so a stray `a..b` inside a
 * bullet cannot satisfy it.
 */
const REVSPEC = "[A-Za-z0-9._/@{}~^+-]+";

const RANGE_LINE_RE = new RegExp(
  `^[ \\t]*\`?(${REVSPEC})\\.\\.(${REVSPEC})\`?[ \\t]*$`,
  "m",
);

const BULLET_RE = /^[ \t]*-[ \t]+(.*)$/gm;

/**
 * The verdict, read from one slot and nowhere else: a separator, then the
 * verdict word, then a colon.
 *
 * Free-text search over the bullet was the older rule and was wrong in both
 * directions — it read `NOT MET` as the `MET` inside it, and it read a
 * bullet merely *referencing* a criterion whose own wording contains
 * `UNMET` as a failure. Anchoring to the slot closes both. The separator is
 * the em dash the template writes; a *spaced* hyphen is accepted too, since
 * a hyphen inside a path or a command is never spaced.
 */
const VERDICT_RE = /(?:—|–|(?<=\s)-{1,2}(?=\s))[ \t]*(NOT[ \t]+MET|UNMET|MET)[ \t]*:/g;

const EXIT_STATUS_RE = /\bexit(?:\s+(?:code|status))?\s+\d+\b/i;

/** Where a refused close is told to go to learn the shape it missed. */
export const GRAMMAR_DOC = ".Workflow/agent-workflows/close-gate/RECORD-GRAMMAR.md";

/** What `evaluateRecord` decided, and why, in words a comment can carry. */
export interface Evaluation {
  verdict: "allow" | "deny";
  /** A stable slug for the log and the counters — never prose. */
  code: string;
  /** One sentence naming what is wrong, addressed to whoever closed it. */
  message: string;
}

/**
 * The text of a comment that is a closing record, with the heading stripped
 * — or `null` when this comment is not one.
 *
 * The heading has to come first, not merely appear: a comment that quotes
 * the grammar while discussing it is not a record, and a gate that read one
 * as a record would be gameable by anyone describing the gate.
 */
export function findMarkerText(text: string | null | undefined): string | null {
  if (text === null || text === undefined) {
    return null;
  }
  const stripped = normalizeNewlines(text).trim();
  if (!stripped.startsWith(RECORD_HEADING)) {
    return null;
  }
  return stripped.slice(RECORD_HEADING.length).replace(/^\n+/, "");
}

/** One comment as the tracker returns it. */
export interface IssueComment {
  body?: string;
}

/**
 * The record that counts: most recent wins. `gh issue view` returns comments
 * oldest-first, so this scans from the end and takes the first one that
 * parses as a record.
 *
 * Most-recent rather than first is what makes a refusal clearable (ADR-0011):
 * someone who posts a corrected record after a refusal does not have to
 * delete the one that was refused.
 */
export function mostRecentRecord(comments: IssueComment[] | null | undefined): string | null {
  for (const comment of [...(comments ?? [])].reverse()) {
    const marker = findMarkerText(comment?.body);
    if (marker !== null) {
      return marker;
    }
  }
  return null;
}

/**
 * One bullet's verdict, normalised to `MET` or `UNMET`.
 *
 * `null` means there is no verdict in the slot the grammar defines for it —
 * the only place one counts. `"AMBIGUOUS"` means the bullet carries two that
 * disagree, which is refused rather than resolved: taking either one would
 * let a bullet lead with `MET` and bury its real verdict behind it. Two
 * slots that agree are not a contradiction and pass through.
 */
export function extractVerdict(bullet: string): "MET" | "UNMET" | "AMBIGUOUS" | null {
  const verdicts = new Set<string>();
  for (const match of bullet.matchAll(VERDICT_RE)) {
    verdicts.add(match[1].replace(/\s+/g, " ").toUpperCase() === "MET" ? "MET" : "UNMET");
  }
  if (verdicts.size === 0) {
    return null;
  }
  if (verdicts.size > 1) {
    return "AMBIGUOUS";
  }
  return [...verdicts][0] as "MET" | "UNMET";
}

/**
 * Judge one closing record against the criterion count the issue body
 * declares. Arithmetic and regex only, never judgement — see the ceiling
 * declared at the top of this file.
 */
export function evaluateRecord(recordText: string, criteriaCount: number | null): Evaluation {
  const record = normalizeNewlines(recordText);

  /**
   * `No diff.` excuses the **range** and nothing else (ADR-0022, #60).
   *
   * It used to be the first branch here and returned `allow` outright, before a
   * bullet, a criterion or a verdict was read. #55's drill A closed an issue with
   * seven criteria and no delivery on exactly that: the salvage stage did its job,
   * found no evidence and wrote seven failing bullets, and this function threw them
   * away on the strength of the record's first two words. `unmet-criterion` was
   * unreachable whenever `No diff.` was present — which the salvage prompt made the
   * *likely* shape for an undelivered issue rather than an edge case, since an issue
   * nobody delivered carries no commit by definition.
   *
   * A close carrying no commit is a real thing; a close carrying no evidence is not.
   * So the declaration now stands in for the range only, and every check below it
   * applies either way.
   */
  const declaresNoDiff = record.trimStart().startsWith("No diff.");

  if (!declaresNoDiff && !RANGE_LINE_RE.test(record)) {
    return {
      verdict: "deny",
      code: "no-range-or-no-diff",
      message:
        "the closing record declares neither `No diff.` nor a `base..head` range standing " +
        "alone on its own line — a range written as a bullet doesn't count.",
    };
  }

  if (criteriaCount === null) {
    // The one place `No diff.` still passes on its own: with no heading there is
    // nothing for bullets to correspond to, so there is nothing left to check.
    if (declaresNoDiff) {
      return {
        verdict: "allow",
        code: "no-diff",
        message: "`No diff.` declared, and the issue body has no criteria to correspond to.",
      };
    }
    return {
      verdict: "deny",
      code: "missing-acceptance-criteria",
      message:
        "the issue body has no `## Acceptance criteria` heading, so there is nothing for the " +
        "record's bullets to correspond to. If this issue truly carries no commit, post a " +
        "`## Closing record` comment declaring `No diff.` and close it again.",
    };
  }

  if (criteriaCount === 0) {
    return {
      verdict: "deny",
      code: "missing-acceptance-criteria",
      message:
        "the issue body's `## Acceptance criteria` heading has no `- [ ]` items. Plain `- ` " +
        "bullets don't count — only `- [ ]` checkbox items do. `No diff.` does not stand in " +
        "for criteria that were never written: give the issue the criteria this close claims " +
        "to have met, or drop the heading if it truly has none.",
    };
  }

  const bullets = [...record.matchAll(BULLET_RE)]
    .map((match) => match[1].trim())
    .filter((bullet) => bullet.length > 0);

  if (bullets.length !== criteriaCount) {
    return {
      verdict: "deny",
      code: "criteria-count-mismatch",
      message:
        `${criteriaCount} acceptance criteria in the body but ${bullets.length} bullets in the ` +
        "closing record — one bullet per criterion, in the body's own order.",
    };
  }

  for (const bullet of bullets) {
    const verdict = extractVerdict(bullet);
    if (verdict === null) {
      return {
        verdict: "deny",
        code: "missing-verdict",
        message:
          "a bullet carries no verdict where the grammar puts one — expected `— MET:` or " +
          `\`— UNMET:\` after the criterion reference: ${JSON.stringify(bullet)}`,
      };
    }
    if (verdict === "AMBIGUOUS") {
      return {
        verdict: "deny",
        code: "ambiguous-verdict",
        message:
          "a bullet carries both a MET and an UNMET verdict — the gate refuses to pick one; " +
          `give each criterion its own bullet, one verdict apiece: ${JSON.stringify(bullet)}`,
      };
    }
    if (verdict === "UNMET") {
      return {
        verdict: "deny",
        code: "unmet-criterion",
        message: `a criterion is UNMET: ${JSON.stringify(bullet)}`,
      };
    }
    if (!PATH_LINE_RE.test(bullet) && !EXIT_STATUS_RE.test(bullet)) {
      return {
        verdict: "deny",
        code: "bad-evidence-shape",
        message:
          "a bullet's evidence isn't shaped like evidence — a `path:line`, or a command with " +
          `an exit status: ${JSON.stringify(bullet)}`,
      };
    }
  }

  return {
    verdict: "allow",
    code: "met",
    message: "all criteria MET with shaped evidence.",
  };
}

/**
 * The whole judgement from an issue body and its comments: find the most
 * recent record, count the body's criteria, and evaluate one against the
 * other.
 *
 * `null` — no record at all — is returned rather than denied, because it is
 * the one outcome this venue answers differently from era 6's. On a
 * workstation the closer was an agent that could be told to write a record
 * first; on the tracker a close arrives from a merge keyword, a phone or a
 * browser, and having no record is the normal shape of those rather than
 * defiance. What happens next is `close-gate.ts`'s decision, not the
 * grammar's.
 */
export function judge(body: string, comments: IssueComment[]): Evaluation | null {
  const record = mostRecentRecord(comments);
  if (record === null) {
    return null;
  }
  return evaluateRecord(record, countCriteria(body));
}
