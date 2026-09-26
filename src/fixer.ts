import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { capped, onDisk } from "./brief.ts";
import { repaired, stillRed, TAIL_CAP, tailOf } from "./builder.ts";
import { UNFENCED } from "./fence.ts";
import { commentOnTicket, commentsOn, gh, git, OWNER, post, postRefusals, prNumber, rewriteTicket } from "./post.ts";
import { earlierDrift, FOLLOW_UP_OF, followUpBody, handedDiff, LIST_CAP, NO_EM_DASH, repairOf, TICKET_CAP } from "./reviewer.ts";
import { hired, machineLogs, type Spent } from "./stage.ts";
import { checks, claims, quoted, why, whyChanged } from "./ticket-shape.ts";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["code", "ticket", "split", "close", "machine"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    body: { type: "string", pattern: NO_EM_DASH },
    tickets: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string", pattern: NO_EM_DASH },
          why: { type: "string", pattern: NO_EM_DASH },
          criteria: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
          claimed: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
        },
        required: ["title", "why", "criteria", "claimed"],
        additionalProperties: false,
      },
    },
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

interface Piece {
  title: string;
  why: string;
  criteria: string[];
  claimed: string[];
}

interface Answer {
  outcome: "code" | "ticket" | "split" | "close" | "machine";
  reason: string;
  body?: string;
  tickets?: Piece[];
}

export const WAITING = "waiting";
export const splitInto = (ticket: string) => `@${OWNER} the fixer split #${ticket} into`;
const FILED = /\/issues\/(\d+)\s*$/;

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
    "- `code`: fix it, or change nothing on a flake; the machine commits, runs `bin/check` and the ticket's checks, hands back red, pushes green or reruns the red Check.",
    "- `ticket`: a criterion or test is wrong; fix the test, or return the ticket as `body`, Why byte-identical.",
    "- `split`: too big for one build; file `tickets` that build at once, each 1 to 3 `criteria` ending ` - check: `<command>`` and `claimed` files no other claims. What must wait for them stays as `body`, Why byte-identical, and builds once they merge.",
    "- `close`: the ticket should not exist as written, and nothing should replace it.",
    "- `machine`: the machine is at fault, reviewer included; fix it in a worktree off `origin/main`, commit naming this ticket, and `bin/land` it first.",
    "`reason`: one paragraph for the owner. Two rounds in a row that change nothing call them.",
    "",
  ].join("\n\n");
}

const mark = (ticket: string, label: string) => spawnSync(join(process.cwd(), "bin", "mark"), [ticket, label], { stdio: "ignore" });
const head = () => git(["rev-parse", "HEAD"]).stdout.trim();
const sessionFile = (ticket: string) => join(homedir(), ".claude", "fixer", ticket);

function fetchedMain(): string {
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

function closedUnbuilt(ticket: string, said: string): number {
  const posted = commentOnTicket(ticket, said, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return calledOwner(ticket, `its closing reason was refused: ${quoted(refusal)}`);
  if (gh(["issue", "close", ticket, "--reason", "not planned"]).status !== 0) return calledOwner(ticket, "it ruled the ticket closed and the ticket would not close");
  gh(["issue", "edit", ticket, "--remove-label", "fixing"]);
  gh(["pr", "close", `ticket/${ticket}`]);
  console.log(`fix: #${ticket} closed unbuilt: ${said}`);
  return 0;
}

const pieceBody = (ticket: string, parentWhy: string, { why: piece, criteria, claimed }: Piece): string =>
  followUpBody(
    [
      `${FOLLOW_UP_OF}${ticket}: its fixer split it, since it does not fit one build.`,
      "",
      `> ${piece}`,
      "",
      `The Why of #${ticket}, of which this builds only the part above:`,
      "",
      ...parentWhy.split("\n").map((line) => `> ${line}`.trimEnd()),
    ],
    criteria,
    claimed,
  );

function splitRefusals(body: string, answer: Answer, postings: { title: string; text: string }[]): string[] {
  if (why(body).includes(FOLLOW_UP_OF)) return ["this ticket is itself a follow-up, so it is not split again"];
  if (postings.length === 0) return ["a split files at least one ticket in `tickets`"];
  const claimed = (answer.tickets ?? []).flatMap((piece) => piece.claimed);
  const twice = [...new Set(claimed.filter((path, at) => claimed.indexOf(path) !== at))];
  return [
    ...twice.map((path) => `\`${path}\` is claimed by more than one ticket, and they build at once`),
    ...(answer.body === undefined ? [] : [...whyChanged(body, answer.body), ...postRefusals({ kind: "ticket", title: "what waits", text: answer.body })].map((refusal) => `the ticket's rewrite: ${refusal}`)),
    ...postings.flatMap((posting) => postRefusals({ kind: "ticket", ...posting }).map((refusal) => `${posting.title}: ${refusal}`)),
  ];
}

function split(ticket: string, body: string, answer: Answer): Round {
  const postings = (answer.tickets ?? []).map((piece) => ({ title: piece.title, text: pieceBody(ticket, why(body), piece) }));
  const refused = splitRefusals(body, answer, postings);
  if (refused.length > 0) return { red: ["Your split was refused, and nothing was filed:", ...refused.map((refusal) => `- ${refusal}`)].join("\n") };
  const filed = postings.map((posting) => ({ title: posting.title, ...post({ kind: "ticket", ...posting }, gh) }));
  const numbers = filed.flatMap(({ said }) => FILED.exec(said)?.slice(1) ?? []);
  const named = numbers.map((number) => `#${number}`).join(", ");
  if (numbers.length < filed.length) return { ended: calledOwner(ticket, `its split filed ${numbers.length} of ${filed.length} tickets${named === "" ? "" : `, ${named}`}: ${quoted(filed.find(({ said }) => !FILED.test(said))?.refusals[0] ?? "")}`) };
  if (answer.body === undefined) return { ended: closedUnbuilt(ticket, `${splitInto(ticket)} ${named}, which build themselves, and closed it: ${answer.reason}`) };
  const written = gh(["issue", "edit", ticket, "--body", answer.body]);
  if (written.status !== 0) return { ended: calledOwner(ticket, `it filed ${named} and its rewrite of what waits would not save: ${quoted((written.stderr || written.stdout).trim().split("\n")[0] ?? "")}`) };
  commentOnTicket(ticket, `${splitInto(ticket)} ${named}, which build themselves. #${ticket} keeps what must wait for them, labelled \`${WAITING}\`, and builds once they all merge: ${answer.reason}`, gh);
  gh(["issue", "edit", ticket, "--add-label", WAITING, "--remove-label", "fixing"]);
  gh(["pr", "close", `ticket/${ticket}`, "--delete-branch"]);
  console.log(`fix: #${ticket} split into ${named}; it waits for them`);
  return { ended: 0 };
}

function rewritten(ticket: string, body: string, answer: Answer): Round {
  if (answer.body === undefined || answer.body.trim() === body.trim()) return {};
  const written = rewriteTicket(ticket, body, answer.body, gh);
  const [refusal] = written.refusals;
  if (refusal !== undefined) return { red: `Your rewrite of the ticket was refused: ${quoted(refusal)}` };
  commentOnTicket(ticket, `The fixer rewrote the criteria of #${ticket}: ${answer.reason}`, gh);
  return { body: answer.body };
}

function landedOnMain(ticket: string, reason: string, before: string): Round {
  if (fetchedMain() === before) return { red: "You answered `machine` and main has not moved: land the machine fix with `bin/land` before you answer." };
  commentOnTicket(ticket, `@${OWNER} the fixer of #${ticket} changed the machine: ${reason}`, gh);
  if (git(["merge", "--quiet", "--no-edit", "origin/main"]).status === 0) return {};
  git(["merge", "--abort"]);
  return { red: "origin/main, with your machine fix, does not merge cleanly into this branch: merge it and resolve the conflict." };
}

function answered(ticket: string, body: string, answer: Answer | undefined, mainBefore: string): Round {
  if (answer === undefined) return { red: "You gave no outcome. Answer one." };
  if (answer.outcome === "close") return { ended: closedUnbuilt(ticket, `@${OWNER} the fixer closed #${ticket} unbuilt and kept its branch: ${answer.reason}`) };
  if (answer.outcome === "split") return split(ticket, body, answer);
  if (answer.outcome === "ticket") return rewritten(ticket, body, answer);
  if (answer.outcome === "machine") return landedOnMain(ticket, answer.reason, mainBefore);
  return {};
}

function committed(ticket: string): void {
  if (git(["status", "--porcelain"]).stdout.trim() === "") return;
  git(["add", "--all"]);
  git(["commit", "--quiet", "-m", repairOf(ticket)]);
}

function spentOn(spend: Spend, input: string, session: string | undefined, opening: string): Spent {
  const fresh = () => spend(input === opening ? input : [opening, input].join("\n\n"));
  if (session === undefined) return fresh();
  const resumed = spend(input, session);
  return resumed.refusal === undefined ? resumed : fresh();
}

function saveRefusal(ticket: string, logs: string): string | undefined {
  const save = spawnSync(join(process.cwd(), "bin", "save"), [ticket], { encoding: "utf8" });
  if (save.status === 0) return undefined;
  return `Save could not push this branch or open its PR:\n\n${tailOf(onDisk(join(logs, `save-${ticket}.log`)) ?? save.stderr, TAIL_CAP)}`;
}

function redOrSaved(ticket: string, body: string, logs: string): string | undefined {
  const red = stillRed(checks(body).map(({ command }) => command));
  return red === "" ? saveRefusal(ticket, logs) : repaired(red);
}

const ranAs = (run: string | undefined) =>
  run === undefined ? "" : gh(["run", "view", run, "--json", "workflowName,headSha,attempt", "--jq", '.workflowName + " " + .headSha + " " + (.attempt | tostring)']).stdout.trim();

function checkingAgain(ticket: string, run: string | undefined): number {
  const ran = ranAs(run);
  if (ran.startsWith(`Check ${head()} `)) {
    if (ran !== `Check ${head()} 1`) return calledOwner(ticket, "its red Check already reran once, and it is green here unchanged");
    const again = gh(["run", "rerun", String(run), "--failed"]);
    if (again.status !== 0) return calledOwner(ticket, `it is green unchanged and the rerun of its red Check was refused: ${quoted((again.stderr || again.stdout).trim().split("\n")[0] ?? "")}`);
  }
  mark(ticket, "3-checking");
  console.log(`fix: #${ticket} is green and pushed, so its PR checks run again`);
  return 0;
}

function ownRedTicket(ticket: string, run: string | undefined): number {
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
  const opening = handedOn({
    ticket,
    body,
    failed: failure(ticket, logs, run),
    diff: git(["diff", "origin/main...HEAD"]).stdout ?? "",
    gaps: earlierDrift(ticket, judged),
  });
  let input = opening;
  let idle = false;
  for (;;) {
    const before = { head: head(), main: fetchedMain() };
    const spent = spentOn(spend, input, session, opening);
    session = spent.session ?? session;
    keepSession(ticket, session);
    if (spent.refusal !== undefined) return calledOwner(ticket, spent.refusal);
    const answer = spent.answer as Answer | undefined;
    const round = answered(ticket, body, answer, before.main);
    if (round.ended !== undefined) return round.ended;
    body = round.body ?? body;
    committed(ticket);
    const changed = head() !== before.head || fetchedMain() !== before.main || round.body !== undefined;
    const red = round.red ?? redOrSaved(ticket, body, logs);
    if (red === undefined) return checkingAgain(ticket, run);
    if (!changed && idle) return calledOwner(ticket, `two rounds in a row changed nothing: ${round.red ?? answer?.reason ?? "it gave no outcome"}`);
    idle = !changed;
    input = red;
  }
}

if (import.meta.main) {
  const [ticket, run] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  process.exit(ownRedTicket(ticket, run));
}
