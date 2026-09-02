import { fileURLToPath } from "node:url";
import type { GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { runStage, type StageExec } from "../shared/stage";
import { VIOLATION_LENS, type Observation } from "../observations/observation-schema";
import type { RatificationRecord } from "../observations/ratification-schema";
import { appendStandardEntry } from "./standards";
import { commitWorkingTree, restoreWorkingTree, type LandedFinding } from "./land";
import { runRuleTrial, type EslintExec, type RuleTrialOptions, type RuleTrialResult } from "./rule-trial";
import { RATIFIER_OUTPUT, type RatifierVerdict } from "./verdict-schema";

/**
 * The ratifier stage: one full-tool spawn per finding, deciding it in the
 * forced order `verdict-schema.ts` names and authoring whatever that verdict
 * lands, in the checkout it was handed.
 *
 * **One finding per spawn, not one per batch.** The rule trial has to run the
 * authored rule against the tree *before* that finding's site fixes, and a
 * demotion has to be able to throw one finding's edits away without touching
 * the ones already accepted. Both are only tractable if each finding's work
 * sits on its own commit — so the loop below decides, tries, and commits one
 * finding at a time, and the batch's shared artifact is the pull request, not
 * the spawn.
 */

const RATIFIER_PROMPT_PATH = fileURLToPath(new URL("./prompt.md", import.meta.url));

/**
 * The model this stage spends. The work is authoring a lint rule and
 * refactoring every site it flags — the most demanding thing any lane here
 * asks for — and the trial refuses a rule that got it wrong, so a cheaper
 * model's failures cost a whole batch rather than a retry.
 */
const RATIFIER_MODEL = "opus";

/** Runs the decision stage for one finding and returns its verdict, unapplied. */
export function runRatifierStage(exec: StageExec, vars: Record<string, string>): Promise<RatifierVerdict> {
  return runStage(RATIFIER_PROMPT_PATH, vars, exec, RATIFIER_OUTPUT, {
    model: RATIFIER_MODEL,
    // The prompt inlines `CODING_STANDARDS.md` and the whole batch, neither of which has an upper
    // bound by construction — the same reason lane 01's shaper needs it (`shared/stage.ts`).
    promptViaStdin: true,
    stage: "ratifier",
  });
}

/** The prompt vars one finding's spawn is handed. */
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
  /** The injected executor each finding's stage spawn runs through. */
  exec: StageExec;
  /** The checkout the stage edits and this loop commits from. */
  repoDir: string;
  /** The commit the batch's first finding is committed onto. */
  head: string;
  /** The findings in scope, already filtered through ratification memory. */
  observations: Observation[];
  /** `CODING_STANDARDS.md`'s current text — read once, for the prompt. */
  standards: string;
  /** Reads a repo-relative file; injected so the demotion's append is testable without a tree. */
  readFile: (path: string) => string;
  /** Writes a repo-relative file. */
  writeFile: (path: string, content: string) => void;
  /**
   * The rule trial itself, injected so this loop's own decisions — commit, demote, skip — are
   * testable without staging a worktree and spawning eslint. Defaults to the real one.
   */
  trial?: (options: RuleTrialOptions) => RuleTrialResult;
  /** Forwarded to the default trial; ignored when `trial` is injected. */
  eslint?: EslintExec;
  log?: (line: string) => void;
}

/** What one batch's decision loop hands back. */
export interface RatifyBatchResult {
  /** The last commit made — `head` itself when nothing landed. */
  tip: string;
  /** One entry per finding that reached a commit, in decision order. */
  landed: LandedFinding[];
  /** `declined` records for every rejected finding — written by the caller, at this run's head. */
  declined: RatificationRecord[];
  /** Findings whose stage refused, crashed, or landed nothing. They re-batch at the next trigger. */
  skipped: string[];
}

/** Where a prose entry lands. Repo-relative, the way every path this lane handles is. */
const STANDARDS_FILE = "CODING_STANDARDS.md";

/**
 * Decides every finding in the batch, one spawn at a time, and reports what
 * landed.
 *
 * A finding that throws — a refused structured output, a lint run that could
 * not start, a stage that died — costs that finding and nothing else: the
 * working tree is restored to the last accepted commit and the loop moves on.
 * The finding writes no record, so it re-batches at the next trigger, which
 * is the correct failure mode: no memory is written about a decision nobody
 * actually made.
 */
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

  // The one rule the schema cannot carry, because it is about the *finding* rather than the
  // answer: a VIOLATION of an already-ratified standard is a defect with a deterministic fix, so
  // it is the only verdict that lens may answer with — and the only one a PROPOSED finding may not.
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
      // The demotion, enforced by code: a rule that cannot flag the very sites the observation
      // collected has not reproduced its own evidence, so the rule and every fix it justified go
      // back, and the fallback entry the verdict already carried lands instead.
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
