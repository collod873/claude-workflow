import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGit, type GitExec } from "../shared/git";
import { syncNotesRef } from "../shared/notes-sync";
import { reason } from "../shared/reason";
import { readRatificationRecords, writeRatificationNote } from "../shared/ratification";
import { loadEnabledRuleIds, scanForReverts } from "./revert-detector";
import { ESLINT_CONFIG } from "./rule-trial";
import { readStandards } from "./standards";

export interface RunRevertDetectorOptions {
  git: GitExec;
  repoDir: string;
  head: string;
  remote?: string;
  ruleIds?: Set<string>;
  log?: (line: string) => void;
}

export interface RevertDetectorOutcome {
  declinedCount: number;
}

export async function runRevertDetector(options: RunRevertDetectorOptions): Promise<RevertDetectorOutcome> {
  const { git, repoDir, head } = options;
  const remote = options.remote ?? "origin";
  const log = options.log ?? ((line: string) => console.log(line));

  const records = readRatificationRecords({ git, repoDir, head });
  const ruleIds = options.ruleIds ?? (await loadEnabledRuleIds(join(repoDir, ESLINT_CONFIG)));
  const scan = scanForReverts({
    records,
    standards: readStandards(repoDir),
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
