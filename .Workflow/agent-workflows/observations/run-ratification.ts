import { pathToFileURL } from "node:url";
import { execGh } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { normalizeNewlines } from "../shared/ticket-shape";
import { parseFindingMarker } from "../shared/finding-marker";
import type { RatificationRecord } from "../shared/ratification-schema";
import { writeRatificationNote } from "../shared/ratification";

export interface EntrypointInput {
  prNumber?: number;
  merged: boolean;
  body: string | null | undefined;
  commit: string;
  repoDir: string;
  git?: GitExec;
  log?: (line: string) => void;
}

export interface EntrypointOutcome {
  ran: boolean;
  recordCount?: number;
}

export function parseLandedFindings(body: string, prNumber: number | undefined): RatificationRecord[] {
  const records: RatificationRecord[] = [];

  for (const line of normalizeNewlines(body).split("\n")) {
    const marker = parseFindingMarker(line);
    if (!marker?.landedAs) continue;

    records.push({
      finding: marker.finding,
      sites: marker.sites,
      decision: "ratified",
      reason: `landed as "${marker.landedAs}" in ratifier PR #${prNumber ?? "?"}`,
      landedAs: marker.landedAs,
    });
  }

  return records;
}

export function runRatification(input: EntrypointInput): EntrypointOutcome {
  const git = input.git ?? execGit;
  const log = input.log ?? ((line: string) => console.log(line));
  const { merged, commit, repoDir, prNumber } = input;

  if (!merged) {
    log(`#${prNumber ?? "?"} closed without merging; nothing was ratified.`);
    return { ran: false };
  }

  const records = parseLandedFindings(input.body ?? "", prNumber);

  if (records.length === 0) {
    log(`#${prNumber ?? "?"} merged with no landed findings to record.`);
    return { ran: true, recordCount: 0 };
  }

  syncNotesRef({
    git,
    repoDir,
    ref: "ratifications",
    apply: () => writeRatificationNote({ git, repoDir, commit, records }),
  });

  log(`#${prNumber ?? "?"} ratified ${records.length} finding(s) at ${commit}.`);
  return { ran: true, recordCount: records.length };
}

interface MergedPullRequest {
  number: number;
  body: string | null;
  mergedAt: string | null;
  mergeCommit: { oid: string } | null;
}

function readMergedPr(pr: string): MergedPullRequest {
  return JSON.parse(execGh(["pr", "view", pr, "--json", "number,body,mergedAt,mergeCommit"])) as MergedPullRequest;
}

async function main(): Promise<void> {
  const pr = process.env.PR;
  if (!pr) {
    console.error("PR must be set: the ratifier-merged dispatch names the pull request that merged");
    process.exit(1);
  }

  const view = readMergedPr(pr);
  const merged = view.mergedAt !== null;
  const commit = view.mergeCommit?.oid ?? "";

  if (merged && !commit) {
    console.error(`${pr} reads as merged but GitHub names no merge commit for it`);
    process.exit(1);
  }

  const outcome = runRatification({
    prNumber: view.number,
    merged,
    body: view.body,
    commit,
    repoDir: process.env.TARGET_WORKSPACE ?? process.cwd(),
  });

  console.log(
    outcome.ran ? `ran (records=${outcome.recordCount ?? 0})` : "PR closed without merging; nothing ratified",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
