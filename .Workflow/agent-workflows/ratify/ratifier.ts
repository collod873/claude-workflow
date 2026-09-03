import { fileURLToPath } from "node:url";
import type { GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { runStage, type StageExec } from "../shared/stage";
import { VIOLATION_LENS, type Observation } from "../shared/observation-schema";
import type { RatificationRecord } from "../shared/ratification-schema";
import { appendStandardEntry } from "./standards";
import { commitWorkingTree, restoreWorkingTree, type LandedFinding } from "./land";
import { runRuleTrial, type EslintExec, type RuleTrialOptions, type RuleTrialResult } from "./rule-trial";
import { RATIFIER_OUTPUT, type RatifierVerdict } from "./verdict-schema";

const RATIFIER_PROMPT_PATH = fileURLToPath(new URL("./prompt.md", import.meta.url));

const RATIFIER_MODEL = "opus";

export function runRatifierStage(exec: StageExec, vars: Record<string, string>): Promise<RatifierVerdict> {
  return runStage(RATIFIER_PROMPT_PATH, vars, exec, RATIFIER_OUTPUT, {
    model: RATIFIER_MODEL,
    promptViaStdin: true,
    stage: "ratifier",
  });
}

export function ratifierVars(options: {
  observation: Observation;
  batch: Observation[];
  standards: string;
}): Record<string, string> {
  const { observation, batch, standards } = options;
  return {
    STANDARDS: standards,
    LENS: observation.lens,
    FINDING: observation.finding,
    SITES: observation.sites.map((site) => `- ${site}`).join("\n"),
    BATCH: batch.map((entry) => `- [${entry.lens}] ${entry.finding}`).join("\n"),
  };
}

export interface RatifyBatchDeps {
  git: GitExec;
  exec: StageExec;
  repoDir: string;
  head: string;
  observations: Observation[];
  standards: string;
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  trial?: (options: RuleTrialOptions) => RuleTrialResult;
  eslint?: EslintExec;
  log?: (line: string) => void;
}

export interface RatifyBatchResult {
  tip: string;
  landed: LandedFinding[];
  declined: RatificationRecord[];
  skipped: string[];
}

const STANDARDS_FILE = "CODING_STANDARDS.md";

export async function ratifyBatch(deps: RatifyBatchDeps): Promise<RatifyBatchResult> {
  const { git, repoDir, observations } = deps;
  const log = deps.log ?? ((line: string) => console.log(line));

  let tip = deps.head;
  const landed: LandedFinding[] = [];
  const declined: RatificationRecord[] = [];
  const skipped: string[] = [];

  for (const observation of observations) {
    try {
      const outcome = await ratifyOne({ ...deps, log, observation, parent: tip });
      if (outcome.kind === "landed") {
        tip = outcome.commit;
        landed.push(outcome.finding);
        log(`ratified "${observation.finding}" as ${outcome.finding.landedAs} (${outcome.finding.verdict})`);
      } else if (outcome.kind === "declined") {
        declined.push(outcome.record);
        log(`declined "${observation.finding}": ${outcome.record.reason}`);
      } else {
        skipped.push(observation.finding);
        log(`skipped "${observation.finding}": ${outcome.why}`);
      }
    } catch (err) {
      restoreWorkingTree(git, repoDir);
      skipped.push(observation.finding);
      log(`skipped "${observation.finding}": ${reason(err)}`);
    }
  }

  return { tip, landed, declined, skipped };
}

type OneOutcome =
  | { kind: "landed"; commit: string; finding: LandedFinding }
  | { kind: "declined"; record: RatificationRecord }
  | { kind: "skipped"; why: string };

async function ratifyOne(
  deps: RatifyBatchDeps & { observation: Observation; parent: string; log: (line: string) => void },
): Promise<OneOutcome> {
  const { git, exec, repoDir, observation, parent, observations, standards, log } = deps;

  const verdict = await runRatifierStage(exec, ratifierVars({ observation, batch: observations, standards }));

  const isViolation = observation.lens === VIOLATION_LENS;
  if (isViolation !== (verdict.verdict === "violation-fix")) {
    restoreWorkingTree(git, repoDir);
    return {
      kind: "skipped",
      why: `a ${observation.lens} finding answered "${verdict.verdict}" — ` +
        `${VIOLATION_LENS} findings are fixed, never decided, and every other lens is decided, never fixed`,
    };
  }

  if (verdict.verdict === "reject") {
    restoreWorkingTree(git, repoDir);
    return {
      kind: "declined",
      record: {
        finding: observation.finding,
        sites: observation.sites,
        decision: "declined",
        reason: verdict.reason,
      },
    };
  }

  let landedAs = verdict.landedAs!;
  let kind: string = verdict.verdict;

  if (verdict.verdict === "mechanise") {
    const trial = (deps.trial ?? runRuleTrial)({
      git,
      repoDir,
      parent,
      ruleId: landedAs,
      sites: observation.sites,
      eslint: deps.eslint,
    });

    if (!trial.reproduced) {
      log(
        `demoted "${observation.finding}": rule ${landedAs} flagged none of ${trial.missed.join(", ")} ` +
          "on the pre-fix tree",
      );
      restoreWorkingTree(git, repoDir);
      deps.writeFile(
        STANDARDS_FILE,
        appendStandardEntry(deps.readFile(STANDARDS_FILE), verdict.fallback!.entry),
      );
      landedAs = verdict.fallback!.name;
      kind = "prose (demoted — the rule did not reproduce its own evidence)";
    }
  }

  const commit = commitWorkingTree(git, repoDir, parent, `Ratify: ${landedAs}`);
  if (commit === null) {
    return { kind: "skipped", why: `a ${verdict.verdict} verdict for ${landedAs} changed no file` };
  }

  return {
    kind: "landed",
    commit,
    finding: { observation, landedAs, reason: verdict.reason, verdict: kind },
  };
}
