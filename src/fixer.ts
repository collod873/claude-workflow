import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authoredTests, capped, yourChecks } from "./brief.ts";
import { redOutput, TAIL_CAP, tailOf } from "./builder.ts";
import { commentOnTicket, post, rewriteTicket, type Gh } from "./post.ts";
import { foundDrift, handedDiff, LIST_CAP, NO_EM_DASH } from "./reviewer.ts";
import { runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import { claims, quoted } from "./ticket-shape.ts";

const TOOK_ITS_TURN = "The fixer took its one turn on this ticket";
const COMMENTS = ["--json", "comments", "--jq", "[.comments[].body]"];

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["code", "ticket", "close"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    body: { type: "string", pattern: NO_EM_DASH },
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

interface Answer {
  outcome: "code" | "ticket" | "close";
  reason: string;
  body?: string;
}

interface Handed {
  briefed: string;
  body: string;
  failed: string;
  diff: string;
  gaps: string;
  commands: string[];
}

type Turn = { refusal: string } | { verdict: string; closing?: string };

const gh: Gh = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: Infinity });
const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", maxBuffer: Infinity });

function comments(on: string[]): string[] | undefined {
  const got = gh([...on, ...COMMENTS]);
  if (got.status !== 0) return undefined;
  try {
    const parsed: unknown = JSON.parse(got.stdout);
    return Array.isArray(parsed) ? parsed.filter((said): said is string => typeof said === "string") : undefined;
  } catch {
    return undefined;
  }
}

function failure({ ticket, logs, commands }: Opened): string {
  const logged = readdirSync(logs)
    .filter((name) => name.endsWith(`-${ticket}.log`))
    .sort()
    .map((name) => `### ${name}\n\n${readFileSync(join(logs, name), "utf8").trim()}`);
  return [...logged, redOutput(commands)].filter((text) => text !== "").join("\n\n");
}

export function handedOn({ briefed, body, failed, diff, gaps, commands }: Handed): string {
  return [
    briefed,
    "## How it failed",
    tailOf(failed, TAIL_CAP) || "(nothing logged)",
    "## Diff from main",
    handedDiff(diff, claims(body)) || "(none)",
    "## Reviewer's gaps",
    capped(gaps, LIST_CAP) || "(none)",
    "## Your one turn",
    `This ticket is stuck and you are its fixer. Read its Why before the failure, then answer one outcome. ${yourChecks(commands)}`,
    "- `code`: the ticket is right and the code is wrong; fix the code.",
    "- `ticket`: a criterion or a test is wrong; fix the test, or return the whole ticket as `body` with only its criteria changed and the Why byte-identical.",
    "- `close`: the ticket should not exist as written; it closes unbuilt.",
    "`reason` is one paragraph on why, posted for the owner to read later.",
    "",
  ].join("\n\n");
}

function fixedTicket(opened: Opened, answer: Answer, explain: (text: string) => { refusals: string[] }): Turn {
  const { ticket, body } = opened;
  const rewrite = answer.body !== undefined && answer.body.trim() !== body.trim() ? answer.body : undefined;
  if (rewrite === undefined && opened.wrote().length === 0) return { refusal: "the fixer said it fixed the ticket and changed nothing" };
  const rewritten = rewrite === undefined ? { refusals: [] } : rewriteTicket(ticket, body, rewrite, gh);
  if (rewritten.refusals.length > 0) return { refusal: `its rewrite of the ticket was refused: ${quoted(rewritten.refusals[0])}` };
  const said = explain(`The fixer fixed #${ticket} itself rather than its code: ${answer.reason}`);
  if (said.refusals.length > 0) return { refusal: `its reason was refused: ${quoted(said.refusals[0])}` };
  return { verdict: `fixed the ticket: ${quoted(answer.reason)}` };
}

function turn(opened: Opened, answer: Answer | undefined, explain: (text: string) => { refusals: string[] }): Turn {
  if (answer === undefined) return { refusal: "the fixer gave no outcome" };
  if (answer.outcome === "close") return { verdict: `closed unbuilt: ${quoted(answer.reason)}`, closing: answer.reason };
  if (answer.outcome === "ticket") return fixedTicket(opened, answer, explain);
  if (opened.wrote().length === 0) return { refusal: "the fixer said it fixed the code and changed nothing" };
  return { verdict: `fixed the code: ${quoted(answer.reason)}` };
}

function closedUnbuilt(ticket: string, reason: string): string | undefined {
  const said = commentOnTicket(ticket, `The fixer closed #${ticket} unbuilt and kept its branch: ${reason}`, gh);
  if (said.refusals.length > 0) return `its closing reason was refused: ${quoted(said.refusals[0])}`;
  return gh(["issue", "close", ticket, "--reason", "not planned"]).status === 0 ? undefined : `#${ticket} could not be closed`;
}

function fix(opened: Opened): Outcome {
  const { ticket, body } = opened;
  const branch = `ticket/${ticket}`;
  const turns = comments(["issue", "view", ticket]);
  if (turns === undefined) return { stop: "fixerEnds", refusals: [`the comments on #${ticket} could not be read, so no model was spent`] };
  if (turns.some((said) => said.startsWith(TOOK_ITS_TURN))) return { stop: "fixerEnds", refusals: [`the fixer already took its one turn on #${ticket}, so no model was spent`] };
  const marked = commentOnTicket(ticket, `${TOOK_ITS_TURN}.`, gh);
  if (marked.refusals.length > 0) return { stop: "fixerEnds", refusals: [`its marker was refused, so no model was spent: ${quoted(marked.refusals[0])}`] };
  const onPr = comments(["pr", "view", branch]);
  const explain = (text: string) => (onPr === undefined ? commentOnTicket(ticket, text, gh) : post({ kind: "judgement", pr: branch, text }, gh));
  const spent = opened.spend(
    handedOn({
      briefed: opened.briefed,
      body,
      failed: failure(opened),
      diff: git(["diff", "origin/main...HEAD"]).stdout ?? "",
      gaps: (onPr ?? []).filter((said) => said.startsWith(foundDrift(ticket))).join("\n\n"),
      commands: opened.commands,
    }),
  );
  const commit = { message: `Fix #${ticket} in the fixer's one turn`, branch: git(["branch", "--show-current"]).stdout.trim() === branch ? undefined : branch };
  const done = spent.refusal === undefined ? turn(opened, spent.answer as Answer | undefined, explain) : { refusal: spent.refusal };
  if ("refusal" in done) {
    const unclosed = closedUnbuilt(ticket, done.refusal);
    return { stop: "fixerEnds", refusals: [`${done.refusal}, so #${ticket} ${unclosed === undefined ? "was closed unbuilt" : "stays open"}`, ...(unclosed === undefined ? [] : [unclosed])], commit };
  }
  const unclosed = done.closing === undefined ? undefined : closedUnbuilt(ticket, done.closing);
  return unclosed === undefined ? { verdict: done.verdict, commit } : { stop: "fixerEnds", refusals: [unclosed], commit };
}

const FIXER: Stage = {
  name: "fixer",
  bin: "fix",
  undone: "nothing was fixed",
  clean: true,
  endsAt: "fixerEnds",
  answers: ANSWER,
  tests: { found: authoredTests },
  keeps: () => true,
  work: fix,
};

if (import.meta.main) process.exit(runStage(FIXER, process.argv[2]));
