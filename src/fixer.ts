import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { capped, onDisk } from "./brief.ts";
import { repaired, stillRed, TAIL_CAP, tailOf } from "./builder.ts";
import { UNFENCED } from "./fence.ts";
import { commentOnTicket, commentsOn, gh, git, OWNER, prNumber, rewriteTicket } from "./post.ts";
import { foundDrift, handedDiff, LIST_CAP, NO_EM_DASH, repairOf, TICKET_CAP } from "./reviewer.ts";
import { hired, machineLogs, type Spent } from "./stage.ts";
import { checks, claims, quoted } from "./ticket-shape.ts";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["code", "ticket", "close", "machine", "rerun"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    body: { type: "string", pattern: NO_EM_DASH },
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

interface Answer {
  outcome: "code" | "ticket" | "close" | "machine" | "rerun";
  reason: string;
  body?: string;
}

interface Handed {
  ticket: string;
  body: string;
  failed: string;
  diff: string;
  gaps: string;
}

type Round = { red?: string; ended?: number; body?: string };

type Spend = (input: string, resume?: string) => Spent;

const REDDENED_ON_MAIN = "It went red on main after its merge; its closing record on the ticket names the check.";

export function handedOn({ ticket, body, failed, diff, gaps }: Handed): string {
  return [
    `# Ticket #${ticket}`,
    capped(body, TICKET_CAP),
    "## How it failed",
    tailOf(failed, TAIL_CAP) || "(nothing logged)",
    "## Diff from main",
    handedDiff(diff, claims(body)) || "(none)",
    "## Reviewer's gaps",
    capped(gaps, LIST_CAP) || "(none)",
    "## You own it until it merges",
    "Every red on this ticket comes back to you until it merges. Read its Why first; `gh` reads any run. Answer one outcome:",
    "- `code`: fix it here; the machine commits, runs `bin/check` and the ticket's checks, hands back red, pushes green.",
    "- `ticket`: a criterion or test is wrong; fix the test, or return the ticket as `body`, Why byte-identical.",
    "- `close`: the ticket should not exist as written.",
    "- `machine`: the machine is at fault, reviewer included; fix it in a worktree off `origin/main`, commit naming this ticket, and `bin/land` it first.",
    "- `rerun`: an outage or flake; its failed jobs rerun.",
    "`reason`: one paragraph for the owner. A round that changes nothing calls the owner.",
    "",
  ].join("\n\n");
}

const mark = (ticket: string, label: string) => spawnSync(join(process.cwd(), "bin", "mark"), [ticket, label], { stdio: "ignore" });
const head = () => git(["rev-parse", "HEAD"]).stdout.trim();
const sessionFile = (ticket: string) => join(homedir(), ".claude", "fixer", ticket);

function main(): string {
  git(["fetch", "--quiet", "origin", "main"]);
  return git(["rev-parse", "origin/main"]).stdout.trim();
}

function savedSession(ticket: string): string | undefined {
  const saved = onDisk(sessionFile(ticket))?.trim();
  return saved === "" ? undefined : saved;
}

function keepSession(ticket: string, session: string | undefined): void {
  if (session === undefined) return;
  mkdirSync(dirname(sessionFile(ticket)), { recursive: true });
  writeFileSync(sessionFile(ticket), `${session}\n`);
}

function failure(ticket: string, logs: string, run: string | undefined): string {
  const logged = readdirSync(logs)
    .filter((name) => name.endsWith(`-${ticket}.log`))
    .sort()
    .map((name) => `### ${name}\n\n${readFileSync(join(logs, name), "utf8").trim()}`);
  if (run === undefined) return [...logged, REDDENED_ON_MAIN].join("\n\n");
  const failedRun = gh(["run", "view", run, "--log-failed"]);
  const ranRed = failedRun.status === 0 && failedRun.stdout.trim() !== "" ? [`### run ${run}, its failed steps\n\n${failedRun.stdout.trim()}`] : [];
  return [...logged, ...ranRed].join("\n\n");
}

function calledOwner(ticket: string, why: string): number {
  mark(ticket, "needs-human");
  commentOnTicket(ticket, `@${OWNER} the fixer of #${ticket} stopped and needs you: ${why}`, gh);
  console.error(`fix: #${ticket} needs the owner, ${why}`);
  return 1;
}

function closedUnbuilt(ticket: string, reason: string): number {
  const said = commentOnTicket(ticket, `The fixer closed #${ticket} unbuilt and kept its branch: ${reason}`, gh);
  if (said.refusals.length > 0) return calledOwner(ticket, `its closing reason was refused: ${quoted(said.refusals[0])}`);
  if (gh(["issue", "close", ticket, "--reason", "not planned"]).status !== 0) return calledOwner(ticket, "it ruled the ticket closed and the ticket would not close");
  gh(["pr", "close", `ticket/${ticket}`]);
  console.log(`fix: #${ticket} closed unbuilt: ${reason}`);
  return 0;
}

function rewritten(ticket: string, body: string, answer: Answer): Round {
  if (answer.body === undefined || answer.body.trim() === body.trim()) return {};
  const written = rewriteTicket(ticket, body, answer.body, gh);
  if (written.refusals.length > 0) return { red: `Your rewrite of the ticket was refused: ${quoted(written.refusals[0])}` };
  commentOnTicket(ticket, `The fixer rewrote the criteria of #${ticket}: ${answer.reason}`, gh);
  return { body: answer.body };
}

function landedOnMain(ticket: string, reason: string, before: string): Round {
  if (main() === before) return { red: "You answered `machine` and main has not moved: land the machine fix with `bin/land` before you answer." };
  commentOnTicket(ticket, `@${OWNER} the fixer of #${ticket} changed the machine: ${reason}`, gh);
  if (git(["merge", "--quiet", "--no-edit", "origin/main"]).status === 0) return {};
  git(["merge", "--abort"]);
  return { red: "origin/main, with your machine fix, does not merge cleanly into this branch: merge it and resolve the conflict." };
}

function rerun(run: string | undefined): Round {
  if (run === undefined) return { red: `You answered \`rerun\` and there is no failed run to rerun. ${REDDENED_ON_MAIN}` };
  const again = gh(["run", "rerun", run, "--failed"]);
  return again.status === 0 ? { ended: 0 } : { red: `The rerun of run ${run} was refused: ${quoted((again.stderr || again.stdout).trim().split("\n")[0])}` };
}

function answered(ticket: string, body: string, run: string | undefined, answer: Answer | undefined, mainBefore: string): Round {
  if (answer === undefined) return { red: "You gave no outcome. Answer one." };
  if (answer.outcome === "close") return { ended: closedUnbuilt(ticket, answer.reason) };
  if (answer.outcome === "rerun") return rerun(run);
  if (answer.outcome === "ticket") return rewritten(ticket, body, answer);
  if (answer.outcome === "machine") return landedOnMain(ticket, answer.reason, mainBefore);
  return {};
}

function committed(ticket: string): void {
  if (git(["status", "--porcelain"]).stdout.trim() === "") return;
  git(["add", "--all"]);
  git(["commit", "--quiet", "-m", repairOf(ticket)]);
}

function spentOn(spend: Spend, input: string, session: string | undefined): Spent {
  if (session === undefined) return spend(input);
  const resumed = spend(input, session);
  return resumed.refusal === undefined ? resumed : spend(input);
}

function saved(ticket: string, logs: string): string | undefined {
  const save = spawnSync(join(process.cwd(), "bin", "save"), [ticket], { encoding: "utf8" });
  if (save.status === 0) return undefined;
  return `Save could not push this branch or open its PR:\n\n${tailOf(onDisk(join(logs, `save-${ticket}.log`)) ?? save.stderr, TAIL_CAP)}`;
}

function redOrSaved(ticket: string, body: string, logs: string): string | undefined {
  const red = stillRed(checks(body).map(({ command }) => command));
  return red === "" ? saved(ticket, logs) : repaired(red);
}

function own(ticket: string, run: string | undefined): number {
  mark(ticket, "fixing");
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return calledOwner(ticket, "its ticket could not be read");
  let body = asked.stdout;
  const pr = prNumber(`ticket/${ticket}`, gh);
  const judged = pr === undefined ? [] : (commentsOn(pr, gh) ?? []);
  const spend = hired({ name: "fixer", transcript: join(logs, `fix-${ticket}.jsonl`), answers: ANSWER, gated: true, reach: UNFENCED });
  if (typeof spend === "string") return calledOwner(ticket, `the owner's hooks could not be read from ${spend}`);
  let session = savedSession(ticket);
  let input = handedOn({
    ticket,
    body,
    failed: failure(ticket, logs, run),
    diff: git(["diff", "origin/main...HEAD"]).stdout ?? "",
    gaps: judged.filter((said) => said.startsWith(foundDrift(ticket))).join("\n\n"),
  });
  for (;;) {
    const before = { head: head(), main: main() };
    const spent = spentOn(spend, input, session);
    session = spent.session ?? session;
    keepSession(ticket, session);
    if (spent.refusal !== undefined) return calledOwner(ticket, spent.refusal);
    const answer = spent.answer as Answer | undefined;
    const round = answered(ticket, body, run, answer, before.main);
    if (round.ended !== undefined) return round.ended;
    body = round.body ?? body;
    committed(ticket);
    if (head() === before.head && main() === before.main && round.body === undefined) return calledOwner(ticket, `a round changed nothing: ${round.red ?? answer?.reason ?? "it gave no outcome"}`);
    const red = round.red ?? redOrSaved(ticket, body, logs);
    if (red === undefined) {
      mark(ticket, "3-checking");
      console.log(`fix: #${ticket} is green and pushed, so its PR checks run again`);
      return 0;
    }
    input = red;
  }
}

if (import.meta.main) {
  const [ticket, run] = process.argv.slice(2);
  process.exit(own(ticket, run));
}
