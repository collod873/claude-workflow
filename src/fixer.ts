import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { authoredTests, capped, yourChecks } from "./brief.ts";
import { redOutput, TAIL_CAP, tailOf } from "./builder.ts";
import { repairOf, takeTurn, turnOn } from "./fixer-turn.ts";
import { commentOnTicket, gh, git, openPr, post, prNumber, rewriteTicket } from "./post.ts";
import { handedDiff, LIST_CAP, NO_EM_DASH } from "./reviewer.ts";
import { runStage, type Opened, type Outcome, type Stage } from "./stage.ts";
import { rowStopped } from "./stops.ts";
import { claims, quoted } from "./ticket-shape.ts";

const JOB_LINK = /\/runs\/(\d+)\/job\/(\d+)/;

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

function failedChecks(branch: string): string[] {
  const listed = gh(["pr", "checks", branch, "--required", "--json", "name,bucket,link"]);
  let checks: unknown;
  try {
    checks = JSON.parse(listed.stdout);
  } catch {
    return [];
  }
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((check: { name?: unknown; bucket?: unknown; link?: unknown }) => {
    const job = typeof check.link === "string" ? JOB_LINK.exec(check.link) : null;
    if (check.bucket !== "fail" || job === null) return [];
    const log = gh(["run", "view", job[1], "--job", job[2], "--log-failed"]);
    return log.status === 0 && log.stdout.trim() !== "" ? [`### failed required check: ${String(check.name)}\n\n${log.stdout.trim()}`] : [];
  });
}

function failure({ ticket, logs, commands }: Opened, branch: string): string {
  const logged = readdirSync(logs)
    .filter((name) => name.endsWith(`-${ticket}.log`))
    .sort()
    .map((name) => `### ${name}\n\n${readFileSync(join(logs, name), "utf8").trim()}`);
  return [...logged, redOutput(commands), ...failedChecks(branch)].filter((text) => text !== "").join("\n\n");
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

function closedUnbuilt(ticket: string, reason: string, row: string | undefined, pr: string | undefined): string | undefined {
  const note = `The fixer closed #${ticket} unbuilt and kept its branch: ${reason}${row === undefined ? "" : `, stopped at: ${row}`}${pr === undefined ? "" : `; its open PR: ${pr}`}`;
  const said = commentOnTicket(ticket, note, gh);
  if (said.refusals.length > 0) return `its closing reason was refused: ${quoted(said.refusals[0])}`;
  return gh(["issue", "close", ticket, "--reason", "not planned"]).status === 0 ? undefined : `#${ticket} could not be closed`;
}

function fix(opened: Opened): Outcome {
  const { ticket, body, logs } = opened;
  const branch = `ticket/${ticket}`;
  const onBranch = prNumber(branch, gh);
  const record = turnOn(ticket, onBranch, gh);
  if (record === undefined) return { stop: "fixerEnds", refusals: [`the comments on #${ticket} or its PR could not be read, so no model was spent`] };
  if (record.taken) return { stop: "fixerEnds", refusals: [`the fixer already took its one turn on #${ticket}, so no model was spent`] };
  const marked = takeTurn(ticket, gh);
  if (marked.refusals.length > 0) return { stop: "fixerEnds", refusals: [`its marker was refused, so no model was spent: ${quoted(marked.refusals[0])}`] };
  const explain = (text: string) => (onBranch === undefined ? commentOnTicket(ticket, text, gh) : post({ kind: "judgement", pr: branch, text }, gh));
  const spent = opened.spend(
    handedOn({
      briefed: opened.briefed,
      body,
      failed: failure(opened, branch),
      diff: git(["diff", "origin/main...HEAD"]).stdout ?? "",
      gaps: record.earlier,
      commands: opened.commands,
    }),
  );
  const commit = { message: repairOf(ticket), branch: git(["branch", "--show-current"]).stdout.trim() === branch ? undefined : branch };
  const ownCallFailed = spent.refusal !== undefined;
  const done = ownCallFailed ? { refusal: spent.refusal as string } : turn(opened, spent.answer as Answer | undefined, explain);
  const row = rowStopped(ticket, logs);
  if ("refusal" in done) {
    const pr = openPr(ticket, gh);
    if (pr !== undefined || ownCallFailed) {
      const because = pr === undefined ? "its own model call failed" : `its PR stays open: ${pr}`;
      const said = commentOnTicket(ticket, `The fixer's turn on #${ticket} ended red, stopped at: ${row ?? "an unlogged row"}; ${because}; ${done.refusal}`, gh);
      const stays = pr === undefined ? "stays open, its own model call failed" : "stays open with its PR";
      return { stop: "fixerEnds", refusals: [`${done.refusal}, so #${ticket} ${stays}`, ...(said.refusals.length > 0 ? [`its comment was refused: ${quoted(said.refusals[0])}`] : [])], commit };
    }
    const unclosed = closedUnbuilt(ticket, done.refusal, row, undefined);
    return { stop: "fixerEnds", refusals: [`${done.refusal}, so #${ticket} ${unclosed === undefined ? "was closed unbuilt" : "stays open"}`, ...(unclosed === undefined ? [] : [unclosed])], commit };
  }
  const unclosed = done.closing === undefined ? undefined : closedUnbuilt(ticket, done.closing, row, openPr(ticket, gh));
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
