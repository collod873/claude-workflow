import type { GhExec } from "../shared/gh";
import { readSheetMarker } from "./marker";

/**
 * The refuter's probation, as a count.
 *
 * [ADR-0031](../../../docs/adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md):
 * at the **20th sheet posted with zero surviving refutations**, this files an
 * issue proposing the refuter's deletion. It files an issue and never deletes
 * the stage — §6's rule is that every lens and counter produces issues and
 * never notifications, so the refuter's death arrives as work the owner rules
 * on rather than as an automatic amputation.
 *
 * This is what discharges §6's backwards question for this lane, and it is
 * the only registration lane 01 gets: *everything that claims to catch
 * something is asked whether it ever did.* A third agent asked "do these look
 * good?" answers yes almost always, which is why the refuter is asked to
 * **kill** instead — and why silence being the good outcome is exactly what
 * made a firing condition necessary that silence alone could not satisfy
 * forever.
 *
 * **The count is recomputed, never stored** (§6), so nothing it says can go
 * stale. Its one ceiling is that it reads GitHub's issue-comment search
 * index, which lags a write by seconds to minutes: a run that posts the 20th
 * silent sheet may count 19 and propose on the next one instead. A counter
 * that fires one sheet late is a counter; a stored tally that drifts is the
 * defect §6 names.
 */

/** ADR-0031's threshold. N=20 has precedent here — ADR-0017 releases on 20 unreleased findings. */
export const SILENT_SHEET_THRESHOLD = 20;

/** The trailer a proposal carries, so the next count can see what was already proposed at. */
const PROPOSAL_OPEN = "<!-- refuter-probation:v1 silent=";
const PROPOSAL_CLOSE = " -->";

/** The marker text the comment search looks for — the sheet trailer's own prefix. */
const SHEET_SEARCH_TERM = "decision-sheet:v1";

interface SearchResult {
  number?: number;
}

interface RawComment {
  body?: string;
}

/**
 * How many sheets have been posted carrying no surviving refutation, across
 * every issue that has ever had one.
 *
 * Found by searching comment bodies for the sheet trailer rather than by
 * walking the tracker, because a sheet outlives the `idea` label that
 * produced it — `parked` drops the label and `killed` closes the issue, and
 * both of those sheets still count.
 */
export function countSilentSheets(gh: GhExec): number {
  let silent = 0;
  for (const issueNumber of issuesCarryingSheets(gh)) {
    for (const body of commentBodies(gh, issueNumber)) {
      const sheet = readSheetMarker(body);
      if (sheet && sheet.survivors.length === 0) silent += 1;
    }
  }
  return silent;
}

function issuesCarryingSheets(gh: GhExec): number[] {
  const raw = gh([
    "search",
    "issues",
    SHEET_SEARCH_TERM,
    "--match",
    "comments",
    "--repo",
    repoSlug(gh),
    "--limit",
    "100",
    "--json",
    "number",
  ]);
  const results = JSON.parse(raw) as SearchResult[];
  return results.map((result) => result.number).filter((n): n is number => n !== undefined);
}

/**
 * `gh search issues` is the one call in this lane that will not resolve its
 * own repository from the working directory's remote — it searches the whole
 * of GitHub without `--repo` — so the slug is read back explicitly rather
 * than assumed. A search that quietly went estate-wide would count another
 * repo's sheets toward this repo's probation.
 */
function repoSlug(gh: GhExec): string {
  return JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner as string;
}

function commentBodies(gh: GhExec, issueNumber: number): string[] {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  return (parsed.comments ?? []).map((comment) => comment.body ?? "");
}

/**
 * The highest silent-sheet count any existing proposal was filed at, or 0
 * when none has been.
 *
 * ADR-0031: *a declined proposal re-proposes only when the count has grown*,
 * inheriting ADR-0019's two-site gate, so the counter cannot nag. Closed
 * proposals are read as well as open ones — a proposal the owner declined by
 * closing it is precisely the one this must not re-file at the same number.
 * That is why no `--state` is passed: `gh search issues` takes only
 * `open|closed` there, and its default is both, which is what this needs.
 */
export function highestProposedAt(gh: GhExec): number {
  const raw = gh([
    "search",
    "issues",
    PROPOSAL_OPEN.trim(),
    "--match",
    "body",
    "--repo",
    repoSlug(gh),
    "--limit",
    "50",
    "--json",
    "body",
  ]);
  const results = JSON.parse(raw) as Array<{ body?: string }>;

  let highest = 0;
  for (const result of results) {
    const at = readProposalMarker(result.body ?? "");
    if (at !== undefined && at > highest) highest = at;
  }
  return highest;
}

function readProposalMarker(body: string): number | undefined {
  const open = body.indexOf(PROPOSAL_OPEN);
  if (open === -1) return undefined;
  const close = body.indexOf(PROPOSAL_CLOSE, open + PROPOSAL_OPEN.length);
  if (close === -1) return undefined;
  const parsed = Number(body.slice(open + PROPOSAL_OPEN.length, close));
  return Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * Runs the probation check after a sheet has posted. Files at most one issue
 * and returns what it did, so the caller can log it — this is a counter, and
 * a counter that acted without saying so in the run log is the mechanism #41
 * names.
 */
export function checkProbation(gh: GhExec): string {
  const silent = countSilentSheets(gh);
  if (silent < SILENT_SHEET_THRESHOLD) {
    return `refuter probation: ${silent}/${SILENT_SHEET_THRESHOLD} silent sheets`;
  }

  const proposedAt = highestProposedAt(gh);
  if (silent <= proposedAt) {
    return `refuter probation: ${silent} silent sheets, already proposed at ${proposedAt} — not re-proposing until the count grows`;
  }

  gh([
    "issue",
    "create",
    "--title",
    `Lane 01's refuter has surfaced no survivor in ${silent} sheets`,
    "--body",
    proposalBody(silent),
  ]);
  return `refuter probation: filed a deletion proposal at ${silent} silent sheets`;
}

function proposalBody(silent: number): string {
  return `## What to decide

Lane 01's refuter (Sonnet, stage 3) has now been spent on **${silent} sheets that carried no surviving refutation**. \
[ADR-0031](../docs/adr/0031-a-probation-held-to-an-event-that-may-never-happen-becomes-a.md) sets that count as \
its firing condition: at ${SILENT_SHEET_THRESHOLD}, the counter proposes the stage's deletion.

This proposes it. Nothing is deleted by this issue — [ADR-0064](../docs/adr/0064-a-counter-names-an-event-a-count-an-issue-and-an-action-and.md) \
rules that a counter files an issue and never acts.

**What the refuter costs:** one Sonnet stage per sheet, inside a chain budgeted at under a dollar per idea.

**What killing it costs:** the sheet loses its only adversarial pass, and lane 01's named failure — a confident, \
coherent sheet resting on a wrong premise — is left to the assumption marks alone.

**The argument for keeping it anyway:** silence is the *good* outcome for a stage asked to kill rather than to \
approve, which is exactly why ADR-0031 gave it a firing condition silence alone could not satisfy forever. A run \
of ${silent} is evidence; it is not proof.

## Acceptance criteria

- [ ] The refuter is kept or deleted, and an ADR records which
- [ ] If it is deleted, that ADR records what replaces its coverage of lane 01's named failure
- [ ] If it is kept, this issue names what would fire next

${PROPOSAL_OPEN}${silent}${PROPOSAL_CLOSE}`;
}
