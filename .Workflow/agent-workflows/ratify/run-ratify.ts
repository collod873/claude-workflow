import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { reason } from "../shared/reason";
import { execClaudeIn, type StageExec } from "../shared/stage";
import { readObservations } from "../observations/notes";
import { PROPOSED_LENS, type Observation } from "../observations/observation-schema";
import { filterByRatificationMemory, readRatificationRecords, writeRatificationNote } from "../observations/ratification";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "./dispatch";
import {
  advanceRatifierRef,
  alignImmutableSetWithTrunk,
  changedFilesBetween,
  openRatifierPr,
  readRatifierBase,
  refuseImmutableSetBatch,
} from "./land";
import { ratifyBatch } from "./ratifier";
import { computeRatificationScope } from "./scope";
import type { EslintExec } from "./rule-trial";

/**
 * The ratifier lane's entrypoint (#296): what runs on a `ratification-due`
 * dispatch, at the one venue ADR-0002 allows.
 *
 * It reads where the last run stopped, asks whether a run is due and what it
 * covers, reads that scope's released observations, drops whatever
 * ratification memory says stays declined, and hands the survivors to the
 * decision loop one at a time. What survives that loop lands as **one** pull
 * request through the door every implementation pull request already uses —
 * judged by lane 06, merged by lane 08, reviewed after the fact by lane 07.
 * There is no checkbox anywhere in it: ratified is merged, and the owner
 * declines by reverting.
 */

/** The branch a batch lands on — one per run, named for the head it scoped through. */
export function ratifierBranchName(head: string): string {
  return `ratify/${head.slice(0, 12)}`;
}

export interface RunRatifyOptions {
  git: GitExec;
  gh: GhExec;
  /** The injected executor each finding's stage spawn runs through. */
  exec: StageExec;
  /** The checkout the stage edits, the notes live in, and the bookmark ref is read from. */
  repoDir: string;
  /** The last commit in scope — also where the bookmark lands. */
  head: string;
  /** True when a PRD close is what fired this run. */
  prdClosed: boolean;
  /** The branch the pull request merges into. */
  prBase: string;
  /** `github.event.action` on the dispatch that triggered this run. */
  eventAction: string | null | undefined;
  /** Forwarded to the scope evaluation. Defaults to its own threshold. */
  threshold?: number;
  /** The remote notes and the branch are pushed to. Defaults to `"origin"`. */
  remote?: string;
  eslint?: EslintExec;
  log?: (line: string) => void;
}

export type RatifyAction = "skipped" | "ran";

export interface RatifyOutcome {
  action: RatifyAction;
  /** A stable slug, for the log — mirrors `run-watchdog.ts`'s `Outcome.code`. */
  code: string;
  /** How many observations in scope had cleared the two-site gate. `0` on every skip. */
  releasedCount: number;
  /** The pull request this run opened, when it opened one. */
  prUrl?: string;
}

/**
 * The lane. Returns rather than throws for every "nothing to do" — a run with
 * no findings in scope is not a broken lane — and lets a genuine failure
 * (a stage that cannot spawn, a push that is refused) propagate, so
 * `ratify.yml`'s `if: failure()` escalation is what speaks for it.
 */
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
    // The bookmark still advances: a run that read the scope and found every finding already
    // decided has covered that scope, and re-reading it next time would only re-filter it.
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

    // Read before the alignment below and reused after it, so what the pull request claims to
    // change — and what lane 06 is dispatched to judge — stays the batch's own work rather than
    // growing whatever trunk moved underneath it.
    const changedFiles = changedFilesBetween(git, repoDir, head, batch.tip);
    refuseImmutableSetBatch(changedFiles);

    const tip = alignImmutableSetWithTrunk({ git, repoDir, tip: batch.tip, remote, trunk: prBase });
    git(["-C", repoDir, "push", remote, `${tip}:refs/heads/${branch}`]);
    prUrl = openRatifierPr({ gh, head: branch, base: prBase, landed: batch.landed, changedFiles });
  }

  // Advance on every completed run, not only on a pull request opening — see `LAST_RATIFIER_REF`.
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

/**
 * The observations in scope that cleared the two-site gate.
 *
 * The two lenses are read differently because only one of them is folded
 * forward. PROPOSED is read from the nearest note alone, because every note
 * already holds that lens's full merged state
 * (`run-observations.ts`'s `loadPriorFindings`), so a union across the range
 * would only re-add site lists that note has already superseded. Nothing
 * folds VIOLATION forward: each audit run parses violations out of its own
 * session's diff alone, so the union across the range is the whole of what
 * is in scope. Any lens added later reads as VIOLATION does, because losing
 * a finding is the worse of the two failures.
 *
 * This has to be the same set the trigger counted (`scope.ts`'s
 * `computeRatificationScope`), because `advanceRatifierRef` moves the
 * bookmark past the whole range either way: a released finding this batch
 * does not see is gone for good (#324).
 *
 * A finding decided in an earlier window cannot resurface here: this range
 * starts at the bookmark, which is the previous run's own head.
 */
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

  // `readObservations` hands notes back newest first, so the first sighting of a finding-and-sites
  // pair is the newest note's — the one whose `released` flag the trigger counted.
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

    // `TARGET_WORKSPACE` is set only by the reusable workflow (#315, ADR-0055): the machine
    // checkout this script runs from is a different directory than the checkout whose standards,
    // notes and bookmark it reads and writes once a caller's own checkout is a separate step — the
    // same seam `shape.ts`, `run-audit.ts` and `run-accept.ts` already read for the same reason.
    // `GITHUB_WORKSPACE` is the checkout's own path, set by every Actions runner without this
    // workflow needing to name it in `env:`, and still covers the pre-reusable shape where the one
    // checkout was both; falling back further to `process.cwd()` is what lets a local run (or a
    // test driving this file as a real subprocess against a throwaway fixture repo) hand in a
    // different one without needing to run from inside it too.
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
