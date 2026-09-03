import type { GhExec } from "../shared/gh";
import { readSheetMarker } from "../shared/marker";

export const SILENT_SHEET_THRESHOLD = 20;

const PROPOSAL_OPEN = "<!-- refuter-probation:v1 silent=";
const PROPOSAL_CLOSE = " -->";

const SHEET_SEARCH_TERM = "decision-sheet:v1";

interface SearchResult {
  number?: number;
}

interface RawComment {
  body?: string;
}

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

function repoSlug(gh: GhExec): string {
  return JSON.parse(gh(["repo", "view", "--json", "nameWithOwner"])).nameWithOwner as string;
}

function commentBodies(gh: GhExec, issueNumber: number): string[] {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "comments"]);
  const parsed = JSON.parse(raw) as { comments?: RawComment[] };
  return (parsed.comments ?? []).map((comment) => comment.body ?? "");
}

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
