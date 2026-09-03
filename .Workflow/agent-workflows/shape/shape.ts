import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runEntrypoint } from "../shared/entrypoint";
import { execGh, type GhExec } from "../shared/gh";
import { handoffPath } from "../shared/handoff-path";
import { reason } from "../shared/reason";
import { execClaudeIn, runStage, type StageExec } from "../shared/stage";
import { REFUSAL_MARKER } from "../shared/marker";
import {
  renderChangeRequest,
  renderPriorArt,
  renderReadingList,
  renderReSweepAnswer,
  type Fetch,
} from "./prepared-context";
import { checkProbation } from "./probation";
import { refusalComment, refusalFor } from "./refusal";
import { renderSheet } from "./render-sheet";
import { applyGrammar, capDecisions, DECISION_CAP } from "./sheet";
import { REFUTER_OUTPUT, SHAPER_OUTPUT, type Refutations, type ShaperOutput, type ShaperSheet } from "../shared/sheet-schema";
import { SWEEP_OUTPUT, type Sweep } from "../shared/sweep-schema";
import { cappedComment, roundFor } from "./rounds";

const SWEEP_MODEL = "claude-haiku-4-5-20251001";

const SHAPER_MODEL = "claude-opus-5";

const REFUTER_MODEL = "claude-sonnet-5";

export const SHAPER_DENIED_TOOLS = [
  "Read",
  "Grep",
  "Glob",
  "Bash",
  "BashOutput",
  "Edit",
  "Write",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "Task",
  "TodoWrite",
];

export const SWEEP_DENIED_TOOLS = [
  "WebFetch",
  "WebSearch",
  "Task",
  "Edit",
  "Write",
  "NotebookEdit",
];

export const REFUSED_LABEL = "shape-refused";

export const NEEDS_LIVE_SESSION_LABEL = "needs-human";

export const LABELS_APPLIED = [REFUSED_LABEL, NEEDS_LIVE_SESSION_LABEL];

const PROMPTS = {
  sweep: ".Workflow/agent-workflows/shape/sweep/prompt.md",
  shaper: ".Workflow/agent-workflows/shape/shaper/prompt.md",
  refuter: ".Workflow/agent-workflows/shape/refuter/prompt.md",
};

function writeFailure(stage: string, detail: string): void {
  const path = handoffPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stage}: ${detail}\n`, "utf8");
}

export type Outcome =
  | { kind: "posted"; round: number; route: "short" | "long"; survivors: number }
  | { kind: "refused"; cause: string }
  | { kind: "needs-live-session"; decisions: number }
  | { kind: "capped" };

export interface ChainDeps {
  exec: StageExec;
  gh: GhExec;
  fetch: Fetch;
}

function readIdea(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  const parsed = JSON.parse(raw) as { title?: string; body?: string };
  return `**${parsed.title ?? ""}**\n\n${parsed.body ?? ""}`;
}

export function fetchRef(gh: GhExec, repoDir: string): Fetch {
  return (ref) => {
    try {
      if (/^#\d+$/.test(ref)) {
        const raw = gh(["issue", "view", ref.slice(1), "--json", "title,body"]);
        const parsed = JSON.parse(raw) as { title?: string; body?: string };
        return `**${parsed.title ?? ""}**\n\n${parsed.body ?? ""}`;
      }
      return readFileSync(resolve(repoDir, ref), "utf8");
    } catch {
      return undefined;
    }
  };
}

async function runSweep(
  deps: ChainDeps,
  issueNumber: number,
  idea: string,
  focus: string,
): Promise<Sweep> {
  return runStage(
    PROMPTS.sweep,
    {
      ISSUE_NUMBER: String(issueNumber),
      IDEA: idea,
      FOCUS: focus,
    },
    deps.exec,
    SWEEP_OUTPUT,
    { model: SWEEP_MODEL, disallowedTools: SWEEP_DENIED_TOOLS, stage: "sweep" },
  );
}

async function runShaper(
  deps: ChainDeps,
  idea: string,
  sweep: Sweep,
  changeRequest: string,
  reSweep: string,
): Promise<ShaperOutput> {
  return runStage(
    PROMPTS.shaper,
    {
      IDEA: idea,
      CHANGE_REQUEST: renderChangeRequest(changeRequest),
      CONTEXT_MD: deps.fetch("CONTEXT.md") ?? "",
      CODING_STANDARDS_MD: deps.fetch("CODING_STANDARDS.md") ?? "",
      READING_LIST: renderReadingList(sweep.readingList, deps.fetch),
      PRIOR_ART: renderPriorArt(sweep.priorArt),
      RESWEEP: reSweep,
    },
    deps.exec,
    SHAPER_OUTPUT,
    { model: SHAPER_MODEL, disallowedTools: SHAPER_DENIED_TOOLS, promptViaStdin: true, stage: "shaper" },
  );
}

async function runRefuter(deps: ChainDeps, shaped: ShaperSheet): Promise<Refutations> {
  return runStage(
    PROMPTS.refuter,
    {
      DECISIONS: JSON.stringify(shaped.decisions, null, 2),
      RESTATEMENT: shaped.restatement,
    },
    deps.exec,
    REFUTER_OUTPUT,
    { model: REFUTER_MODEL, stage: "refuter" },
  );
}

function comment(gh: GhExec, issueNumber: number, body: string): void {
  gh(["issue", "comment", String(issueNumber), "--body", body]);
}

function label(gh: GhExec, issueNumber: number, name: string): void {
  gh(["issue", "edit", String(issueNumber), "--add-label", name]);
}

export async function runChain(
  deps: ChainDeps,
  issueNumber: number,
  changeRequest: string,
): Promise<Outcome> {
  const round = roundFor(deps.gh, issueNumber);

  if (round.capped) {
    comment(deps.gh, issueNumber, cappedComment());
    return { kind: "capped" };
  }

  const idea = readIdea(deps.gh, issueNumber);
  let sweep = await runSweep(deps, issueNumber, idea, firstPassFocus(changeRequest));

  if (round.refusalApplies) {
    const refusal = refusalFor(sweep, issueNumber);
    if (refusal) {
      comment(deps.gh, issueNumber, `${refusalComment(refusal)}\n\n${REFUSAL_MARKER}`);
      label(deps.gh, issueNumber, REFUSED_LABEL);
      return { kind: "refused", cause: refusal.cause };
    }
  }

  let shaped = await runShaper(deps, idea, sweep, changeRequest, "");

  if (shaped.kind === "re-sweep") {
    const needs = shaped.needs;
    const second = await runSweep(deps, issueNumber, idea, reSweepFocus(shaped.needs, shaped.why));
    sweep = mergeSweeps(sweep, second);
    shaped = await runShaper(deps, idea, sweep, changeRequest, renderReSweepAnswer(needs));

    if (shaped.kind === "re-sweep") {
      throw new Error(
        `the shaper asked for a second re-sweep ("${shaped.needs}"), which ADR-0030 caps at one`,
      );
    }
  }

  const overflow = capDecisions(shaped);
  if (overflow) {
    comment(deps.gh, issueNumber, needsLiveSessionComment(overflow.count));
    label(deps.gh, issueNumber, NEEDS_LIVE_SESSION_LABEL);
    return { kind: "needs-live-session", decisions: overflow.count };
  }

  const refuted = await runRefuter(deps, shaped);
  const sheet = applyGrammar(shaped, refuted, round.round);
  comment(deps.gh, issueNumber, renderSheet(sheet));

  console.log(checkProbation(deps.gh));

  return {
    kind: "posted",
    round: sheet.round,
    route: sheet.route,
    survivors: sheet.survivors.length,
  };
}

function firstPassFocus(changeRequest: string): string {
  const trimmed = changeRequest.trim();
  if (trimmed === "") return "";
  return `## The owner has already seen a sheet on this

He asked for a change, in these words. Sweep with it as an explicit target — if he is pointing at something the last pass missed, finding it is this pass's job.

> ${trimmed.split("\n").join("\n> ")}`;
}

function reSweepFocus(needs: string, why: string): string {
  return `## This is a second pass, with one target

The shaper read your first sweep and could not decide without this:

> **Needs:** ${needs}
> **Why:** ${why}

Find it, and put whatever bears on it on the reading list. If it does not exist, return an empty \`readingList\` — saying so is a real answer, and the shaper will mark the decision and write the sheet anyway.

**Prior art is settled.** Job 1 ran on the first pass and its verdicts already cleared; that answer stands and anything you return for it now is discarded. Return an empty \`priorArt\` and spend this pass on the reading list.`;
}

function mergeSweeps(first: Sweep, second: Sweep): Sweep {
  const seen = new Set(first.readingList.map((item) => item.ref));
  return {
    priorArt: first.priorArt,
    readingList: [
      ...first.readingList,
      ...second.readingList.filter((item) => !seen.has(item.ref)),
    ],
  };
}

function needsLiveSessionComment(count: number): string {
  return `**This needs a live session.** The decision tree did not close under ${DECISION_CAP} decisions — the shaper found ${count}.

That is not a verdict on the idea. It is the shaper saying it cannot state this as work without asking you things a sheet cannot ask.

Grill it at the desk, then re-file what comes out of that as an idea the tree can close on. Nothing was posted, and the shaper was not asked to compress ${count} decisions into ${DECISION_CAP} to fit.`;
}

function usage(): never {
  console.error("usage: shape.ts --issue <n>");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const issueFlagIndex = args.indexOf("--issue");
  const issueNumber = issueFlagIndex === -1 ? undefined : Number(args[issueFlagIndex + 1]);

  if (issueNumber === undefined || !Number.isInteger(issueNumber)) {
    usage();
  }

  const targetWorkspace = process.env.TARGET_WORKSPACE || process.cwd();
  const deps: ChainDeps = { exec: execClaudeIn(targetWorkspace), gh: execGh, fetch: fetchRef(execGh, targetWorkspace) };

  try {
    const outcome = await runChain(deps, issueNumber, process.env.CHANGE_REQUEST ?? "");
    console.log(`shape: ${JSON.stringify(outcome)}`);
  } catch (err) {
    const detail = reason(err);
    console.error(`shape failed: ${detail}`);
    writeFailure("shape", detail);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runEntrypoint("shape", main);
}
