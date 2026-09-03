import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { reason } from "../shared/reason";
import { execClaudeIn, type StageExec } from "../shared/stage";
import { readObservations } from "../shared/notes";
import { PROPOSED_LENS, type Observation } from "../shared/observation-schema";
import { filterByRatificationMemory, readRatificationRecords, writeRatificationNote } from "../shared/ratification";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "../shared/ratification-dispatch";
import {
  advanceRatifierRef,
  alignImmutableSetWithTrunk,
  changedFilesBetween,
  openRatifierPr,
  readRatifierBase,
  refuseImmutableSetBatch,
} from "./land";
import { ratifyBatch } from "./ratifier";
import { computeRatificationScope } from "../shared/ratification-scope";
import type { EslintExec } from "./rule-trial";

export function ratifierBranchName(head: string): string {
  return `ratify/${head.slice(0, 12)}`;
}

export interface RunRatifyOptions {
  git: GitExec;
  gh: GhExec;
  exec: StageExec;
  repoDir: string;
  head: string;
  prdClosed: boolean;
  prBase: string;
  eventAction: string | null | undefined;
  threshold?: number;
  remote?: string;
  eslint?: EslintExec;
  log?: (line: string) => void;
}

export type RatifyAction = "skipped" | "ran";

export interface RatifyOutcome {
  action: RatifyAction;
  code: string;
  releasedCount: number;
  prUrl?: string;
}

export async function runRatify(options: RunRatifyOptions): Promise<RatifyOutcome> {
  const { git, gh, exec, repoDir, head, prdClosed, prBase, eventAction, threshold } = options;
  const remote = options.remote ?? "origin";
  const log = options.log ?? ((line: string) => console.log(line));

  if (eventAction !== RATIFICATION_DUE_DISPATCH_ACTION) {
    return { action: "skipped", code: "not-a-ratification-dispatch", releasedCount: 0 };
  }

  const base = readRatifierBase(git, repoDir);
  const scope = computeRatificationScope({ git, repoDir, base, head, prdClosed, threshold });

  if (!scope.shouldRatify) {
    log(`not due: ${scope.releasedCount} released finding(s) in scope, no PRD close.`);
    return { action: "skipped", code: "not-due", releasedCount: scope.releasedCount };
  }

  const eligible = releasedObservations({ git, repoDir, base, head });
  const priorRatifications = readRatificationRecords({ git, repoDir, head });
  const surviving = filterByRatificationMemory({ observations: eligible, priorRatifications });

  if (surviving.length === 0) {
    advanceRatifierRef(git, repoDir, head);
    log("nothing survived ratification memory — bookmark advanced, no branch created.");
    return { action: "ran", code: "nothing-to-ratify", releasedCount: scope.releasedCount };
  }

  const batch = await ratifyBatch({
    git,
    exec,
    repoDir,
    head,
    observations: surviving,
    standards: readFileSync(join(repoDir, "CODING_STANDARDS.md"), "utf8"),
    readFile: (path) => readFileSync(join(repoDir, path), "utf8"),
    writeFile: (path, content) => writeFileSync(join(repoDir, path), content),
    eslint: options.eslint,
    log,
  });

  if (batch.declined.length > 0) {
    syncNotesRef({
      git,
      repoDir,
      ref: "ratifications",
      remote,
      apply: () => writeRatificationNote({ git, repoDir, commit: head, records: batch.declined }),
    });
  }

  let prUrl: string | undefined;
  if (batch.landed.length > 0) {
    const branch = ratifierBranchName(head);

    const changedFiles = changedFilesBetween(git, repoDir, head, batch.tip);
    refuseImmutableSetBatch(changedFiles);

    const tip = alignImmutableSetWithTrunk({ git, repoDir, tip: batch.tip, remote, trunk: prBase });
    git(["-C", repoDir, "push", remote, `${tip}:refs/heads/${branch}`]);
    prUrl = openRatifierPr({ gh, head: branch, base: prBase, landed: batch.landed, changedFiles });
  }

  advanceRatifierRef(git, repoDir, head);

  log(
    `ratified ${batch.landed.length}, declined ${batch.declined.length}, skipped ${batch.skipped.length}` +
      (prUrl ? ` — ${prUrl}` : " — no pull request opened"),
  );
  return {
    action: "ran",
    code: prUrl ? "opened" : "nothing-landed",
    releasedCount: scope.releasedCount,
    prUrl,
  };
}

function releasedObservations(options: {
  git: GitExec;
  repoDir: string;
  base?: string;
  head: string;
}): Observation[] {
  const notes = readObservations(options);
  const released = (note: { observations: Observation[] }) => note.observations.filter((entry) => entry.released);

  const [nearest] = notes;
  const proposed = nearest ? released(nearest).filter((entry) => entry.lens === PROPOSED_LENS) : [];

  const unfolded = new Map<string, Observation>();
  for (const note of notes) {
    for (const entry of released(note)) {
      if (entry.lens === PROPOSED_LENS) continue;
      const key = JSON.stringify([entry.finding, [...entry.sites].sort()]);
      if (!unfolded.has(key)) unfolded.set(key, entry);
    }
  }

  return [...proposed, ...unfolded.values()];
}

async function main(): Promise<void> {
  try {
    const head = process.env.HEAD_SHA;
    if (!head) throw new Error("HEAD_SHA must be set");

    const repoDir = process.env.TARGET_WORKSPACE || process.env.GITHUB_WORKSPACE || process.cwd();

    const outcome = await runRatify({
      git: execGit,
      gh: execGh,
      exec: execClaudeIn(repoDir),
      repoDir,
      head,
      prdClosed: process.env.PRD_CLOSED === "true",
      prBase: process.env.PR_BASE || "main",
      eventAction: process.env.EVENT_ACTION,
    });
    console.log(`${outcome.action} (${outcome.code}): released ${outcome.releasedCount}`);
  } catch (err) {
    console.error(`run-ratify failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
