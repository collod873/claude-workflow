import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { reason } from "../shared/reason";
import { readRatificationRecords, writeRatificationNote } from "../observations/ratification";
import { loadEnabledRuleIds, scanForReverts } from "./revert-detector";
import { ESLINT_CONFIG } from "./rule-trial";

/**
 * The revert detector's connector: what runs on a push to `main` that touched
 * `CODING_STANDARDS.md` or `eslint.config.js` (`.github/workflows/decline-on-revert.yml`).
 *
 * The trigger is the one moment the answer can have changed. No other push
 * moves a standard in or out of the tree, so every other push is silent by
 * construction rather than by a filter — ADR-0046's rule, applied to the one
 * mechanism that replaces the release PR's checkbox.
 */

export interface RunRevertDetectorOptions {
  git: GitExec;
  /** The checkout the notes, the standards file and the eslint config all live in. */
  repoDir: string;
  /** The commit that was pushed — the range's head, and what the declined reason names. */
  head: string;
  /** The remote the ratifications ref is fetched from and pushed to. Defaults to `"origin"`. */
  remote?: string;
  /** Injected so a test drives the scan without importing a real eslint config. */
  ruleIds?: Set<string>;
  log?: (line: string) => void;
}

export interface RevertDetectorOutcome {
  /** How many `declined` records this run derived. `0` is the ordinary case. */
  declinedCount: number;
}

/**
 * Derives, writes and publishes. Writes nothing — and pushes nothing — when
 * every ratified standard is still in the tree, which is what makes the
 * detector free to run on every qualifying push.
 */
export async function runRevertDetector(options: RunRevertDetectorOptions): Promise<RevertDetectorOutcome> {
  const { git, repoDir, head } = options;
  const remote = options.remote ?? "origin";
  const log = options.log ?? ((line: string) => console.log(line));

  const records = readRatificationRecords({ git, repoDir, head });
  const ruleIds = options.ruleIds ?? (await loadEnabledRuleIds(join(repoDir, ESLINT_CONFIG)));
  const scan = scanForReverts({
    records,
    standards: readFileSync(join(repoDir, "CODING_STANDARDS.md"), "utf8"),
    ruleIds,
    sha: head,
  });

  if (scan.declined.length === 0) {
    log(`${scan.present.length} ratified standard(s) still in the tree — nothing was reverted.`);
    return { declinedCount: 0 };
  }

  syncNotesRef({
    git,
    repoDir,
    ref: "ratifications",
    remote,
    apply: () => writeRatificationNote({ git, repoDir, commit: head, records: scan.declined }),
  });

  log(`declined ${scan.declined.length}: ${scan.declined.map((record) => record.landedAs).join(", ")}`);
  return { declinedCount: scan.declined.length };
}

async function main(): Promise<void> {
  try {
    const head = process.env.GITHUB_SHA;
    if (!head) throw new Error("GITHUB_SHA must be set");

    // `TARGET_WORKSPACE` is the reusable workflow's target checkout, `GITHUB_WORKSPACE` the
    // pre-reusable one (ADR-0055; seam described at `missing-trailer-counter.ts`).
    const outcome = await runRevertDetector({
      git: execGit,
      repoDir: process.env.TARGET_WORKSPACE ?? process.env.GITHUB_WORKSPACE ?? process.cwd(),
      head,
    });
    console.log(`declined ${outcome.declinedCount}`);
  } catch (err) {
    console.error(`run-revert-detector failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
