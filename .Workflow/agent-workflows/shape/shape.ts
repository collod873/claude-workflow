import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { extractOutput } from "../shared/output-block";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { REFUSAL_MARKER } from "./marker";
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
import { Refutations, ShaperOutput, type ShaperSheet } from "./sheet-schema";
import { Sweep } from "./sweep-schema";
import { cappedComment, roundFor } from "./rounds";

/**
 * Lane 01 — Shape. Three serial model stages producing one decision sheet.
 *
 * Unlike lane 03, the whole chain runs inside **one** process rather than one
 * workflow step per stage. Lane 03's stages are independent — each reads the
 * last one's output off a file and nothing loops — so the workflow can drive
 * them. This chain has a loop in it: the shaper may spend one re-sweep
 * (ADR-0030), which re-runs stage 1 and then stage 2 again. A cap of one,
 * enforced across two workflow steps, would have to be recomputed from the
 * tracker on every entry; enforced in a single call stack it is a local
 * variable. Each `claude` spawn is still its own process with no memory of
 * the last, which is what `CONTEXT.md` means by a stage.
 *
 * The three model tiers are §3's, and they are named here because a stage
 * that does not say so silently costs whatever the CLI defaults to.
 */

/** §3: high volume, zero discretion, trivially reversible. */
const SWEEP_MODEL = "claude-haiku-4-5-20251001";

/** §3: being subtly wrong is expensive and invisible. Low volume, high consequence. */
const SHAPER_MODEL = "claude-opus-5";

/** §3: bounded by what is on the sheet — the ceiling is the sheet, not the model. */
const REFUTER_MODEL = "claude-sonnet-5";

/**
 * What the shaper may not do, enforced by the CLI rather than by its prompt
 * (ADR-0030). Every way this repo's stages reach the world is on this list:
 * the file readers, the searchers, `Bash` (which is how `gh` would be
 * reached), the web, and the subagent spawner that could hold any of them.
 * The write tools are here too — the shaper produces an `<output>` block and
 * nothing else, so a shaper that edited a file would be doing something no
 * part of this design asked for.
 *
 * `shape.test.ts` asserts this list reaches the argv, because a deny list
 * that silently stopped being passed would leave a prompt-only prohibition
 * behind and nothing would look different.
 */
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

/** Applied when stage 1 refuses. The evidence is in the comment; this is what a query can see. */
export const REFUSED_LABEL = "shape-refused";

/** Applied when the tree will not close under five decisions (ADR-0029). */
export const NEEDS_LIVE_SESSION_LABEL = "needs-human";

/**
 * Every label this chain applies. `wired.test.ts` reads it and asserts the
 * workflow creates each one, because `gh issue edit --add-label` fails on a
 * label that does not exist — and it fails at the moment the lane is trying
 * to report something, which is the worst moment available.
 */
export const LABELS_APPLIED = [REFUSED_LABEL, NEEDS_LIVE_SESSION_LABEL];

const DEFAULT_HANDOFF_PATH = ".Workflow/agent-workflows/handoff.txt";

const PROMPTS = {
  sweep: ".Workflow/agent-workflows/shape/sweep/prompt.md",
  shaper: ".Workflow/agent-workflows/shape/shaper/prompt.md",
  refuter: ".Workflow/agent-workflows/shape/refuter/prompt.md",
};

/**
 * Where a dying stage's reason lands, for `shape.yml`'s `if: failure()`
 * reporter. Resolved live rather than at import time so the runner and a
 * local debug run agree on one file — the same arrangement, and the same
 * reason, as `to-tickets.ts`'s. Not shared with it: extracting the seam is a
 * change to `shared/`, which this lane has no claim on, and the proposed
 * lens's two-site gate is exactly the mechanism that should surface it now
 * that a second site exists.
 */
export function handoffPath(): string {
  return process.env.FAILURE_REASON_PATH || DEFAULT_HANDOFF_PATH;
}

function writeFailure(stage: string, detail: string): void {
  const path = handoffPath();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${stage}: ${detail}\n`, "utf8");
}

/**
 * Where a stage's rejected raw response is kept — beside the handoff file,
 * named for the stage, and uploaded as an artifact by the workflow. #42 is
 * what its absence costs: a two-minute model run leaving one line about why
 * its answer was refused, and no way to see the answer.
 */
function rawResponsePath(stage: string): string {
  return join(dirname(handoffPath()), `${stage}-raw-response.txt`);
}

function preservingRaw<R>(stage: string, raw: string, work: () => R): R {
  try {
    return work();
  } catch (err) {
    const path = rawResponsePath(stage);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, raw, "utf8");
    throw new Error(`${reason(err)} — the model's raw response is saved at ${path}`);
  }
}

/**
 * The outcome of one chain run, returned rather than logged so the caller
 * decides the exit code and `shape.test.ts` can assert on it.
 *
 * **Only `failed` is a red run.** A refusal and a refuse-to-shape are this
 * lane working: §11's unfiled question 3 makes the sweep's kill rate a number
 * worth measuring, which means kills are the expected traffic, not incidents.
 * Painting the Actions tab red for the ordinary case is how a red stops
 * meaning anything — and both outcomes announce themselves where the owner
 * is actually looking, which is the issue.
 */
export type Outcome =
  | { kind: "posted"; round: number; route: "short" | "long"; survivors: number }
  | { kind: "refused"; cause: string }
  | { kind: "needs-live-session"; decisions: number }
  | { kind: "capped" };

export interface ChainDeps {
  exec: StageExec;
  gh: GhExec;
  /** Reads a reading-list ref. Injected so a test needs neither disk nor GitHub. */
  fetch: Fetch;
}

/** The idea as the owner filed it — title and body, never edited (§00). */
function readIdea(gh: GhExec, issueNumber: number): string {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  const parsed = JSON.parse(raw) as { title?: string; body?: string };
  return `**${parsed.title ?? ""}**\n\n${parsed.body ?? ""}`;
}

/** The real `Fetch`: a repo-relative path off disk, or an issue through `gh`. */
export function fetchRef(gh: GhExec): Fetch {
  return (ref) => {
    try {
      if (/^#\d+$/.test(ref)) {
        const raw = gh(["issue", "view", ref.slice(1), "--json", "title,body"]);
        const parsed = JSON.parse(raw) as { title?: string; body?: string };
        return `**${parsed.title ?? ""}**\n\n${parsed.body ?? ""}`;
      }
      return readFileSync(ref, "utf8");
    } catch {
      return undefined;
    }
  };
}

async function runSweep(deps: ChainDeps, issueNumber: number, focus: string): Promise<Sweep> {
  const raw = await runStage(
    PROMPTS.sweep,
    { ISSUE_NUMBER: String(issueNumber), FOCUS: focus },
    deps.exec,
    { model: SWEEP_MODEL },
  );
  return preservingRaw("sweep", raw, () => extractOutput(raw, Sweep));
}

async function runShaper(
  deps: ChainDeps,
  idea: string,
  sweep: Sweep,
  changeRequest: string,
  reSweep: string,
): Promise<ShaperOutput> {
  const raw = await runStage(
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
    // On stdin, because this is the one prompt in the estate that inlines
    // files: `CONTEXT.md`, `CODING_STANDARDS.md` and an uncapped reading list
    // clear the 128 KiB argv-element limit on any idea whose sweep listed a
    // long file. ADR-0030 rejected capping that list, so the transport has
    // to be the thing that gives.
    { model: SHAPER_MODEL, disallowedTools: SHAPER_DENIED_TOOLS, promptViaStdin: true },
  );
  return preservingRaw("shaper", raw, () => extractOutput(raw, ShaperOutput));
}

async function runRefuter(deps: ChainDeps, shaped: ShaperSheet): Promise<Refutations> {
  const raw = await runStage(
    PROMPTS.refuter,
    {
      DECISIONS: JSON.stringify(shaped.decisions, null, 2),
      RESTATEMENT: shaped.restatement,
    },
    deps.exec,
    { model: REFUTER_MODEL },
  );
  return preservingRaw("refuter", raw, () => extractOutput(raw, Refutations));
}

/**
 * The one place this lane writes to the tracker, so a test asserting "refused
 * before any write" has a single thing to watch.
 */
function comment(gh: GhExec, issueNumber: number, body: string): void {
  gh(["issue", "comment", String(issueNumber), "--body", body]);
}

function label(gh: GhExec, issueNumber: number, name: string): void {
  gh(["issue", "edit", String(issueNumber), "--add-label", name]);
}

/**
 * Runs the chain end to end for one idea.
 *
 * The order is §01's, and every early return is a place the design says the
 * chain stops rather than a shortcut this implementation took.
 */
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
  let sweep = await runSweep(deps, issueNumber, firstPassFocus(changeRequest));

  if (round.refusalApplies) {
    const refusal = refusalFor(sweep);
    if (refusal) {
      comment(deps.gh, issueNumber, `${refusalComment(refusal)}\n\n${REFUSAL_MARKER}`);
      label(deps.gh, issueNumber, REFUSED_LABEL);
      return { kind: "refused", cause: refusal.cause };
    }
  }

  let shaped = await runShaper(deps, idea, sweep, changeRequest, "");

  // ADR-0030's one re-sweep. The cap is this branch not being a loop.
  if (shaped.kind === "re-sweep") {
    const needs = shaped.needs;
    const second = await runSweep(deps, issueNumber, reSweepFocus(shaped.needs, shaped.why));
    sweep = mergeSweeps(sweep, second);
    shaped = await runShaper(deps, idea, sweep, changeRequest, renderReSweepAnswer(needs));

    if (shaped.kind === "re-sweep") {
      // The prompt's second pass says in as many words that this is the last
      // one and to mark the gap instead. A stage that asks again has not
      // produced an output this lane can post, and there is no repair path.
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

/**
 * The sweep's focus paragraph on the first pass. A change request is the
 * owner saying the last run got something wrong, and the sweep is the stage
 * best placed to go and find what it missed — §01 calls a change request a
 * re-run of the shaper, and re-running the cheap stage ahead of it costs
 * cents and removes the alternative, which is carrying the last run's sweep
 * across a runner boundary in a file nothing owns.
 */
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

Find it, and put whatever bears on it on the reading list. If it does not exist, return an empty \`readingList\` — saying so is a real answer, and the shaper will mark the decision and write the sheet anyway.`;
}

/** Union of two sweeps, second pass last, deduplicated by ref. */
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

/**
 * §01's *"needs a live session"* — the honest refusal, and the same instinct
 * as §02's *a spec with zero open questions is suspect*, pointed the other
 * way. It costs no new number: the sheet's own five-decision cap is the
 * condition (ADR-0029).
 */
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

  const deps: ChainDeps = { exec: execClaude, gh: execGh, fetch: fetchRef(execGh) };

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

// Built through pathToFileURL rather than a `file://` template because
// import.meta.url is percent-encoded and this repo's own path has a space in
// it — a naive comparison silently never matches and main() never runs.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((err: unknown) => {
    const detail = reason(err);
    console.error(`shape failed: ${detail}`);
    writeFailure("shape", detail);
    process.exitCode = 1;
  });
}
