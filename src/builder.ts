import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { admission, doesNotBuild } from "./admit.ts";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, LIST_CAP, listedCapped, NO_EM_DASH, onDisk, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { PUBLISHED_CHECK } from "./checks.ts";
import { type ChecksWait, checkedRuns, checksNamed, waitedLine, withWait } from "./checks-wait.ts";
import { park, postedUnderOrigin } from "./issue-links.ts";
import { calledOwner, type Caller, commentOnTicket, commentsRead, endedRed, FILED, FOREIGN, fromLine, followUpBody, gh, ghRead, git, gitRead, MACHINE_REPO, mark, NOTHING_MARKED, OWNER, postRefusals, readOrStop, rewriteTicket, FILED_IN, Stopped, ticketBranch, unread, treePathed } from "./post.ts";
import { reviewedAndLanded } from "./reviewer.ts";
import { committed, commitlinted, CONTRACT, opened, setupRefusedIn, type Spent, stageLoop, unsetKeys } from "./stage.ts";
import { dedashed } from "./em-dash.ts";
import { BUILDING, SPEC, TICKET } from "./spelled.ts";
import { doneWhen, quoted, specProblem, specRefusals, why } from "./ticket-shape.ts";

export const OWNED_ANSWER = {
  repo: { type: "string", pattern: `^${OWNER}/[\\w.-]+$` },
  tickets: {
    type: "array",
    items: {
      type: "object",
      properties: {
        title: { type: "string", pattern: NO_EM_DASH },
        why: { type: "string", pattern: NO_EM_DASH },
        done: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
      },
      required: ["title", "why", "done"],
      additionalProperties: false,
    },
  },
};

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["code", "spec", "done", "close", "stuck", "machine", "owned", "waits"] },
    on: { type: "array", items: { type: "integer" } },
    checks: {
      type: "object",
      properties: {
        repo: { type: "string", pattern: "^[\\w.-]+/[\\w.-]+$" },
        count: { type: "integer", minimum: 1 },
        after: { type: "string", pattern: "^[\\w.-]+/[\\w.-]+@[0-9a-f]{7,40}$" },
      },
      required: ["repo", "count", "after"],
      additionalProperties: false,
    },
    reason: { type: "string", pattern: NO_EM_DASH },
    body: { type: "string", pattern: NO_EM_DASH },
    ...OWNED_ANSWER,
  },
  required: ["outcome", "reason"],
  additionalProperties: false,
};

export interface Piece {
  title: string;
  why: string;
  done: string[];
}

interface Answer {
  outcome: "code" | "spec" | "done" | "close" | "stuck" | "machine" | "owned" | "waits";
  on?: number[];
  checks?: { repo: string; count: number; after: string };
  reason: string;
  repo?: string;
  body?: string;
  tickets?: Piece[];
}

const builderCaller = (ticket: string): Caller => ({ who: "the builder", said: `fix: #${ticket} needs the owner` });

export const builderOf = (ticket: string) => `The builder of #${ticket}`;
const rewroteAsSpec = (ticket: string) => `${builderOf(ticket)} rewrote it as a spec, which the slicer cuts:`;
export const dependsOn = (ticket: string) => `${builderOf(ticket)} found it depends on`;
export const parkedBehind = (ticket: string, blockers: string[]) => `${builderOf(ticket)} parked it, blocked by ${blockers.join(", ")}:`;
export const handedStep = (ticket: string, repo: string, filed: string[]) => `${builderOf(ticket)} handed its first step to ${repo} and filed ${filed.join(", ")}.`;
const filedClosed = (ticket: string) => `Every ticket the builder of #${ticket} filed and waits on has closed:`;

interface Handed {
  ticket: string;
  body: string;
  capture?: string | undefined;
  alongside?: string;
  commitlint?: boolean;
  foreign?: boolean;
  unset?: string[];
}

type Round = { red?: string; ended?: number; body?: string };

type Spend = (input: string, resume?: string) => Promise<Spent>;

function captureOf(body: string, captures: string | undefined): string | undefined {
  const session = FILED_IN.exec(body)?.[1];
  if (session === undefined || captures === undefined || !existsSync(captures)) return undefined;
  const name = readdirSync(captures)
    .filter((file) => file.endsWith(`-${session.slice(0, 8)}.md`))
    .sort()
    .at(-1);
  return name === undefined ? undefined : join(captures, name);
}

const filedIn = (capture: string | undefined) =>
  capture === undefined ? [] : [`The conversation that filed this ticket is captured at \`${capture}\`: what the owner ruled out, asked twice, or meant by a word, around the quotes in its Why. Read it before you build.`];

const PASSED = /^check: ok\b/;
const LOGGED = /; log (.+?)\s*$/;
const STEP_START = /^(?=--- \S+ \S.*? after [\d.]+s)/m;
const FAILED_STEP = /^--- \S+ (red|overdue|killed)\b/;

export type Red = {
  verdict: string;
  failed: string;
};

function failedSteps(log: string): string {
  const failed = log.split(STEP_START).filter((step) => FAILED_STEP.test(step));
  return failed.map((step) => tailOf(step.trim(), Math.floor(TAIL_CAP / failed.length))).join("\n\n");
}

const UNANNOTATED_GITHUB_ACTIONS = "unannotated";

function checkEnv(): NodeJS.ProcessEnv {
  const { GITHUB_ACTIONS: onGitHub, ...rest } = process.env;
  return treePathed(onGitHub === undefined ? rest : { ...rest, GITHUB_ACTIONS: UNANNOTATED_GITHUB_ACTIONS });
}

const ENDED_RERUNS = 3;
const ENDED_BY_SIGTERM = /^check: ended by SIGTERM\b/;
const endedBySigterm = (red: Red | undefined) => red !== undefined && ENDED_BY_SIGTERM.test(red.verdict);

const checkedOnce = (check: string) =>
  new Promise<Red | undefined>((resolved) => {
    execFile("bash", ["-c", check], { env: checkEnv(), encoding: "utf8", maxBuffer: Infinity }, (_error, stdout, stderr) => resolved(redOf(stdout, stderr)));
  });

export async function checkedBy(check: string): Promise<Red | undefined> {
  let red = await checkedOnce(check);
  for (let rerun = 0; rerun < ENDED_RERUNS && endedBySigterm(red); rerun++) red = await checkedOnce(check);
  return red;
}

function redOf(stdout: string, stderr: string): Red | undefined {
  const verdict = stdout.trim().split("\n").at(-1) ?? "";
  if (PASSED.test(verdict)) return undefined;
  const logPath = LOGGED.exec(verdict)?.[1];
  const log = stripVTControlCharacters((logPath === undefined ? undefined : onDisk(resolve(logPath))) || `${stdout}${stderr}`).trim();
  return { verdict, failed: failedSteps(log) || log };
}

const MACHINE_RAN_SHORT = "the machine ran short";
const STEPS_BLAMED = /^check: red (.*?)(?:; receipts not published .*)?; log \S+$/;

function starvedOnly(verdict: string): boolean {
  const blamed = STEPS_BLAMED.exec(verdict)?.[1];
  if (blamed === undefined) return false;
  const steps = blamed.split(/, (?![^(]*\))/);
  return steps.every((step) => step.includes(MACHINE_RAN_SHORT));
}

export function machineFault(red: Red | undefined): string | undefined {
  if (red === undefined) return undefined;
  const atFault = (what: string) => `the machine is at fault, not the code: ${what}: \`${red.verdict}\``;
  if (endedBySigterm(red)) return atFault(`SIGTERM ended \`${PUBLISHED_CHECK}\` on its first run and on all ${String(ENDED_RERUNS)} reruns, each picking up from the receipts the last kept`);
  return starvedOnly(red.verdict) ? atFault(`\`${PUBLISHED_CHECK}\` went red only on steps killed because ${MACHINE_RAN_SHORT}, after the check reran them once other work on the runner ended`) : undefined;
}

export const repaired = ({ verdict, failed }: Red) =>
  [`\`${PUBLISHED_CHECK}\` ran on your answer and went red: \`${verdict}\`. What each red step printed, from the end of its part of that log:`, tailOf(failed, TAIL_CAP), "Make it pass, commit, and answer again.", ""].join("\n\n");

const alongsideSection = (alongside: string | undefined) =>
  alongside === undefined || alongside === "" ? [] : ["## Open tickets on the same files", "Each names a file this ticket names, and may already ask for part of its fix:", capped(alongside, LIST_CAP)];

const NAMED_FILE = /(?<![\w./-])(?:[\w.-]+\/)*([\w-][\w.-]*\.(?:tsx?|[cm]?js|jsx|json|md|ya?ml|py|sh|sql|toml|css|html))\b/g;
const filesNamed = (text: string) => new Set([...text.matchAll(NAMED_FILE)].map(([, file]) => file));

function onTheSameFiles(ticket: string, body: string): string {
  const named = filesNamed(body);
  if (named.size === 0) return "";
  const open = JSON.parse(ghRead(["issue", "list", "--state", "open", "--label", TICKET, "--limit", "200", "--json", "number,title,body"], `the open tickets could not be read, ${NOTHING_MARKED}`)) as { number: number; title: string; body: string }[];
  return open
    .filter((other) => String(other.number) !== ticket && [...filesNamed(other.body)].some((file) => named.has(file)))
    .map((other) => `- #${other.number} ${other.title}`)
    .join("\n");
}

const machineAtFault = (foreign: boolean | undefined) =>
  foreign === true
    ? `- \`machine\`: the machine is at fault; it lives in ${MACHINE_REPO}, not this tree, so change nothing here for it: file the fault as \`tickets\`, or name the machine tickets already open for it as \`on\`, filing none again, and this ticket waits on them.`
    : "- `machine`: the machine is at fault; fix it in a worktree off `origin/main`, commit naming this ticket as `Refs #<number>`, never after a closing word like `Fixes`, since that closes it before its own build lands, and `bin/land` it first.";

export function handedOn({ ticket, body, capture, alongside, commitlint, foreign, unset = [] }: Handed): string {
  return [
    `# Ticket #${ticket}`,
    capped(body, TICKET_CAP),
    ...alongsideSection(alongside),
    ...filedIn(capture),
    "## Build it",
    "Ship the Why whole with the smallest change that does it: its `## Done when` is the floor, and every path your change touches works for the Why, edge cases with it. Every open choice is yours: decide it as the senior engineer the owner hired, and say why in its commit. Call the Skill tool with `tdd` and follow it to the end.",
    ...(unset.length === 0 ? [] : [`This job lacks ${listedCapped(unset.map((key) => `\`${key}\``))}, which the repo's contract asks for: prove code that rests on one against a stand-in at that boundary, never a made-up value, and name in \`reason\` each one the owner should add as a repo secret.`]),
    "Where the work needs a step only the owner's own login, money or identity can take, once no tool here can take it, build everything else, prove the code at that boundary against a stand-in, never a made-up value, and answer `code`, naming the step in `reason`: your reviewer files it for the owner and the ticket still closes.",
    "Stop at the fast `check`: the full check runs once you answer, outside your time cap, so running it yourself only spends that cap.",
    "Commit your work, each message saying why, with no em dash and no closing keyword such as `Fixes #12`: `bin/land` refuses them.",
    ...(commitlint ? ["This repo runs commitlint on every commit: write each message as `type: subject`, the type `feat`, `fix` or another conventional one, the subject lower-case, as the machine's own are."] : []),
    "## Your answer",
    "Answer one outcome:",
    `- \`code\`: built; the machine commits whatever you left, runs \`${PUBLISHED_CHECK}\` and hands back each red until it passes, then a fresh reviewer reads your diff, fixes what it finds, and lands it with \`bin/land\`. Where its \`## Done when\` was wrong, give the ticket rewritten to hold its whole Why as \`body\`, Why byte-identical; it is posted on the ticket before the check.`,
    "- `spec`: too big for one build; give it rewritten as a spec in `body`, its Why byte-identical under `## Problem Statement`, its `## Done when` kept as the closing section, each line a '- [ ]' item; it is relabelled `spec` and the slicer cuts it.",
    "- `done`: main already does what it asks, as when an earlier run landed it and its close failed; it closes completed, and no one is called.",
    "- `close`: the ticket should not exist as written, and nothing should replace it, as for a gate you cannot make pass, since a gate is proven first.",
    "- `waits`: it depends on other open tickets here, as one another builder is still building: name them as `on`; or it measures what another repo's full checks show after a commit lands, and too few have run: name the repo, how many and the commit as `owner/repo@sha` in `checks`. It is marked `waiting` and builds once they all close or have run.",
    machineAtFault(foreign),
    "- `stuck`: a machine fault no `machine` answer ends; `reason` says why, and the ticket is marked `stuck`.",
    `- \`owned\`: its first step belongs in the one other repo that owns that kind of fix, such as \`${OWNER}/design-kit\` for a kit primitive or \`${OWNER}/agent-skills\` for a skill or shared tool: name it as \`repo\`, change nothing here for it, and file that step as \`tickets\`; this ticket waits on them and builds once they close. Not so for moving into the kit a name this tree already declares: design-kit's apps step would fail this tree while it still holds that name, so the kit half could never land first. Build that move here and answer \`code\`, running \`kit-land\` from this tree against the design-kit checkout at \`~/Claude Projects/design-kit\`, which lands the kit edit and deletes this tree's copy together.`,
    "`reason`: one paragraph for the owner; a `code` answer's goes to its reviewer, who fixes each gap it names and files each step only the owner can take.",
    "",
  ].join("\n\n");
}

const builtBy = (ticket: string) => `Build #${ticket} as its builder`;
const sessionFile = (ticket: string) => join(homedir(), ".claude", "builder", ticket);

function fetchedMain(): string {
  gitRead(["fetch", "--quiet", "origin", "main"], "origin/main could not be fetched");
  return gitRead(["rev-parse", "origin/main"], "origin/main could not be read");
}

function savedSession(ticket: string): string | undefined {
  const saved = onDisk(sessionFile(ticket))?.trim();
  return saved === "" ? undefined : saved;
}

function keepSession(ticket: string, session: string | undefined): void {
  if (session === undefined) return;
  const file = sessionFile(ticket);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${session}\n`);
}

function closedAs(ticket: string, reason: "completed" | "not planned", said: string): number {
  const posted = commentOnTicket(ticket, said, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return calledOwner(ticket, builderCaller(ticket), `its closing reason was refused: ${quoted(refusal)}`);
  if (gh(["issue", "close", ticket, "--reason", reason]).status !== 0) return calledOwner(ticket, builderCaller(ticket), "it ruled the ticket closed and the ticket would not close");
  console.log(`fix: #${ticket} closed ${reason}: ${said}`);
  return 0;
}

function specRefused(body: string, spec: string | undefined): string[] {
  if (spec === undefined) return ["a `spec` answer gives the spec as `body`"];
  const said = why(body).trim();
  return [...(said !== "" && specProblem(spec).includes(said) ? [] : ["its Problem Statement does not carry the ticket's Why byte-identical"]), ...specRefusals(spec)];
}

function rewrittenAsSpec(ticket: string, body: string, answer: Answer): Round {
  const refused = specRefused(body, answer.body);
  if (refused.length > 0 || answer.body === undefined) return { red: ["Your spec was refused, and nothing changed:", ...refused.map((refusal) => `- ${refusal}`)].join("\n") };
  const written = gh(["issue", "edit", ticket, "--body", dedashed(answer.body)]);
  if (written.status !== 0) return { ended: calledOwner(ticket, builderCaller(ticket), `its spec would not save: ${quoted((written.stderr || written.stdout).trim().split("\n")[0] ?? "")}`) };
  commentOnTicket(ticket, `${rewroteAsSpec(ticket)} ${answer.reason}`, gh);
  git(["reset", "--quiet", "--hard", "origin/main"]);
  git(["push", "--quiet", "origin", "--delete", ticketBranch(ticket)]);
  const relabelled = gh(["issue", "edit", ticket, "--remove-label", TICKET, "--remove-label", BUILDING, "--add-label", SPEC]);
  if (relabelled.status !== 0) return { ended: calledOwner(ticket, builderCaller(ticket), `its spec saved and its labels would not swap to \`${SPEC}\`: ${quoted((relabelled.stderr || relabelled.stdout).trim().split("\n")[0] ?? "")}`) };
  console.log(`fix: #${ticket} rewritten as a spec`);
  return { ended: 0 };
}

const answeredWait = ({ repo, count, after }: NonNullable<Answer["checks"]>): ChecksWait => {
  const [afterRepo = "", sha = ""] = after.split("@");
  return { repo, count, afterRepo, sha };
};

function checksRefusal(wait: ChecksWait): string | undefined {
  try {
    const runs = checkedRuns(wait);
    return runs.length < wait.count ? undefined : `Your \`waits\` answer was refused: they have run already, so build on them. ${waitedLine(wait, runs.slice(0, wait.count))}`;
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    return `Your \`waits\` answer was refused: ${error.message}.`;
  }
}

function waitedOn(ticket: string, body: string, answer: Answer): Round {
  const on = [...new Set((answer.on ?? []).map(String))].filter((number) => number !== ticket);
  const wait = answer.checks === undefined ? undefined : answeredWait(answer.checks);
  if (on.length === 0 && wait === undefined) return { red: "Your `waits` answer was refused: it names the open tickets this one depends on as `on`, or the full checks it measures as `checks`." };
  const read = on.map((number) => {
    const [state = "", url = ""] = ghRead(["issue", "view", number, "--json", "state,url", "--jq", '.state + " " + .url'], `the state of #${number} could not be read, ${NOTHING_MARKED}`).split(" ");
    return { number, open: state === "OPEN", pull: url.includes("/pull/") };
  });
  const pulls = read.filter(({ pull }) => pull).map(({ number }) => `#${number}`);
  if (pulls.length > 0) return { red: `Your \`waits\` answer was refused: ${pulls.join(", ")} is a pull request, and a ticket waits only on issues. Wait for it here (\`gh pr checks <n> --watch\`) and build once it merges, or name the issue it closes.` };
  const closed = read.filter(({ open }) => !open).map(({ number }) => number);
  if (closed.length > 0) return { red: `Your \`waits\` answer was refused: ${closed.map((number) => `#${number}`).join(", ")} is closed already, so build on what it left.` };
  const ran = wait === undefined ? undefined : checksRefusal(wait);
  if (ran !== undefined) return { red: ran };
  const here = process.env.GH_REPO ?? "";
  const named = [...on.map((number) => `${here}#${number}`), ...(wait === undefined ? [] : [checksNamed(wait)])];
  if (wait !== undefined) {
    const written = gh(["issue", "edit", ticket, "--body", withWait(body, wait)]);
    if (written.status !== 0) return { ended: calledOwner(ticket, builderCaller(ticket), `the full checks it waits on would not save to the ticket: ${quoted((written.stderr || written.stdout).trim().split("\n")[0] ?? "")}`) };
  }
  park(ticket, on.map((number) => ({ repo: here, number: Number(number) })));
  commentOnTicket(ticket, `${parkedBehind(ticket, named)} ${answer.reason}`, gh);
  console.log(`fix: #${ticket} waits on ${named.join(", ")}`);
  return { ended: 0 };
}

function rewritten(ticket: string, body: string, answer: Answer): Round {
  if (answer.body === undefined || answer.body.trim() === body.trim()) return {};
  const written = rewriteTicket(ticket, body, answer.body, gh);
  const [refusal] = written.refusals;
  if (refusal !== undefined) return { red: `Your rewrite of the ticket was refused: ${quoted(refusal)}` };
  commentOnTicket(ticket, `${builderOf(ticket)} rewrote what done looks like against its Why, and builds it as rewritten in this run: ${answer.reason}\n\n## Done when\n\n${doneWhen(answer.body)}`, gh);
  console.log(`fix: #${ticket} rewritten; it builds as rewritten`);
  return { body: answer.body };
}

interface Handing {
  repo: string;
  filedFrom: (origin: string) => string;
  unfiled: string;
}

const FILED_NUMBER = /\/issues\/(\d+)$/;



export function ownedRefusal(repo: string | undefined, own: string | undefined, of: string): string | undefined {
  if (repo === undefined) return "Your `owned` answer was refused, and nothing was filed: it names the repo that owns its first step as `repo`.";
  if (repo === own) return `Your \`owned\` answer was refused, and nothing was filed: ${repo} is this ${of}'s own repo, so build its first step here.`;
  return undefined;
}

export function filedInRepo(repo: string, origin: string, outcome: string, unfiled: string, pieces: Piece[] | undefined): { red: string } | { filed: string[]; all: boolean } {
  const postings = (pieces ?? []).map(({ title, why: step, done }) => ({ title, text: followUpBody([origin, "", `> ${step}`], done) }));
  const refused = postings.length === 0 ? [unfiled] : postings.flatMap((posting) => postRefusals({ kind: "ticket", ...posting }).map((refusal) => `${posting.title}: ${refusal}`));
  if (refused.length > 0) return { red: [`Your \`${outcome}\` answer was refused, and nothing was filed:`, ...refused.map((refusal) => `- ${refusal}`)].join("\n") };
  const inRepo = (args: string[]) => gh([...args, "--repo", repo]);
  const said = postings.map((posting) => postedUnderOrigin({ kind: "ticket", ...posting }, inRepo).said.trim());
  return { filed: said.filter((one) => FILED.test(one)), all: said.every((one) => FILED.test(one)) };
}

const isOpen = (url: string, so: string) => ghRead(["issue", "view", url, "--json", "state", "--jq", ".state"], `the state of ${url} could not be read, ${so}`) === "OPEN";

function filedToWaitOn(ticket: string, answer: Answer, { repo, filedFrom, unfiled }: Handing, named: number[] = []): Round {
  const handed = named.length > 0 && (answer.tickets ?? []).length === 0 ? { filed: [], all: true } : filedInRepo(repo, filedFrom(`${process.env.GH_REPO ?? ""}#${ticket}`), answer.outcome, unfiled, answer.tickets);
  if ("red" in handed) return { red: handed.red };
  const { filed, all } = handed;
  if (!all) return { ended: calledOwner(ticket, builderCaller(ticket), `it filed ${filed.length} of ${answer.tickets?.length ?? 0} tickets in ${repo} to wait on`) };
  const numbers = [...named, ...filed.map((url) => Number(FILED_NUMBER.exec(url)?.[1]))];
  park(ticket, numbers.map((number) => ({ repo, number })));
  commentOnTicket(ticket, `${parkedBehind(ticket, numbers.map((number) => `${repo}#${number}`))} ${answer.reason}`, gh);
  const open = filed.filter((url) => isOpen(url, `so #${ticket} stays waiting`));
  if (open.length === 0 && named.length === 0) return closedBeforeParked(ticket, filed);
  console.log(`fix: #${ticket} waits on ${numbers.map((number) => `${repo}#${number}`).join(", ")}`);
  return { ended: 0 };
}

function closedBeforeParked(ticket: string, filed: string[]): Round {
  mark(ticket, BUILDING);
  commentOnTicket(ticket, `${filedClosed(ticket)} ${filed.join(", ")} closed before #${ticket} was parked, so no close was left to wake it. #${ticket} builds now.`, gh);
  console.log(`fix: #${ticket} builds on, ${filed.join(", ")} closed before it was parked`);
  return { red: `Every ticket you filed to wait on, ${filed.join(", ")} is closed already, so build on what it left and answer again.` };
}

function filedForMachine(ticket: string, answer: Answer): Round {
  const named = [...new Set(answer.on ?? [])];
  const closed = named.filter((number) => !isOpen(`https://github.com/${MACHINE_REPO}/issues/${number}`, NOTHING_MARKED));
  if (closed.length > 0) return { red: `Your \`machine\` answer was refused, and nothing was filed: ${closed.map((number) => `${MACHINE_REPO}#${number}`).join(", ")} is closed already, so build on what it left.` };
  return filedToWaitOn(ticket, answer, { repo: MACHINE_REPO, filedFrom: (origin) => fromLine(origin, "fault"), unfiled: "a `machine` answer from a tree that is not the machine's files the machine's fault as one ticket or more in `tickets`, or names the open machine tickets it waits on as `on`" }, named);
}

function handedToItsRepo(ticket: string, answer: Answer): Round {
  const { repo } = answer;
  const refused = ownedRefusal(repo, process.env.GH_REPO, "ticket");
  if (refused !== undefined || repo === undefined) return { red: refused ?? "" };
  return filedToWaitOn(ticket, answer, { repo, filedFrom: (origin) => fromLine(origin, "first-step"), unfiled: "an `owned` answer files its first step as one ticket or more in `tickets`" });
}

function landedOnMain(ticket: string, reason: string, before: string): Round {
  if (fetchedMain() === before) return { red: "You answered `machine` and main has not moved: land the machine fix with `bin/land` before you answer." };
  commentOnTicket(ticket, `@${OWNER} the builder of #${ticket} changed the machine: ${reason}`, gh);
  if (git(["merge", "--quiet", "--no-edit", "origin/main"]).status === 0) return { red: "main now carries your machine fix, merged into this branch: build the ticket on it, and answer `code` once it is done." };
  git(["merge", "--abort"]);
  return { red: "origin/main, with your machine fix, does not merge cleanly into this branch: merge it and resolve the conflict." };
}

function outcomeOf(ticket: string, body: string, answer: Answer | undefined, mainBefore: string): Round {
  if (answer === undefined) return { red: "You gave no outcome. Answer one." };
  if (answer.outcome === "done") return { ended: closedAs(ticket, "completed", `${builderOf(ticket)} found its work already on main and closed it: ${answer.reason}`) };
  if (answer.outcome === "close") return { ended: closedAs(ticket, "not planned", `@${OWNER} the builder closed #${ticket} unbuilt and kept its branch: ${answer.reason}`) };
  if (answer.outcome === "stuck") return { ended: calledOwner(ticket, builderCaller(ticket), answer.reason) };
  if (answer.outcome === "spec") return rewrittenAsSpec(ticket, body, answer);
  if (answer.outcome === "waits") return waitedOn(ticket, body, answer);
  if (answer.outcome === "machine" && FOREIGN) return filedForMachine(ticket, answer);
  if (answer.outcome === "owned") return handedToItsRepo(ticket, answer);
  if (answer.outcome === "machine") return landedOnMain(ticket, answer.reason, mainBefore);
  return rewritten(ticket, body, answer);
}

export async function spentOn(said: string, spend: Spend, input: string, session: string | undefined, opening: string): Promise<Spent> {
  const fresh = () => spend(input === opening ? input : [opening, input].join("\n\n"));
  if (session === undefined) return fresh();
  const resumed = await spend(input, session);
  if (resumed.refusal === undefined) return resumed;
  console.error(`${said} could not resume its builder's session ${session}, so it starts fresh: ${resumed.refusal}`);
  return fresh();
}

const PAST_MAIN_UNREAD = "the commits past main could not be read, so nothing is reviewed";

function cleanMergeOf(parents: string): string | undefined {
  const merged = git(["merge-tree", "--write-tree", ...parents.split(" ")]);
  if (merged.status === 1) return undefined;
  return merged.status === 0 ? merged.stdout.split("\n")[0] : unread(PAST_MAIN_UNREAD);
}

function mergesCarryingWork(): string[] {
  const merges = gitRead(["log", "--merges", "--format=%h%x09%T%x09%P%x09%s", "origin/main..HEAD"], PAST_MAIN_UNREAD);
  return merges === ""
    ? []
    : merges
        .split("\n")
        .map((line) => line.split("\t"))
        .filter(([, tree = "", parents = ""]) => cleanMergeOf(parents) !== tree)
        .map(([short = "", , , subject = ""]) => `${short} ${subject}`);
}

async function judged(ticket: string): Promise<Round> {
  if (gitRead(["rev-list", "--count", "origin/main..HEAD"], PAST_MAIN_UNREAD) === "0") return { red: "You answered `code`, and this branch has no commits past main, so there is nothing to land: build the ticket, or answer `done` if main already does what it asks." };
  const lost = mergesCarryingWork();
  if (lost.length > 0) return { red: `You answered \`code\`, and a rebase drops merge commits, so these past main would land without the work they carry beyond a clean merge of their parents: ${lost.join(", ")}. Leave that work out of merge commits and add its work as plain commits on top of main, such as with \`git reset --soft origin/main\` and a fresh commit.` };
  const red = await checkedBy(PUBLISHED_CHECK);
  const fault = machineFault(red);
  if (fault !== undefined) return { ended: calledOwner(ticket, builderCaller(ticket), fault) };
  return red === undefined ? {} : { red: repaired(red) };
}

function owned(ticket: string, body: string) {
  const refused = admission(ticket, NOTHING_MARKED);
  if (refused !== undefined) return endedRed(`fix: ${doesNotBuild(ticket, refused)}`);
  return { carrying: { onTicket: commentsRead(ticket, `the comments on #${ticket} could not be read, ${NOTHING_MARKED}`, gh), alongside: onTheSameFiles(ticket, body) } };
}

async function ownTicket(ticket: string, app: AppKey | undefined): Promise<number> {
  const owning = opened({
    stage: "fix",
    issue: ticket,
    state: BUILDING,
    hire: { name: "builder", model: "opus", effort: "medium", answers: ANSWER },
    ready: (asked) => owned(ticket, asked.body),
  });
  if (typeof owning !== "object") return owning;
  const { asked, spend } = owning;
  let body = asked.body;
  const unready = await setupRefusedIn(process.cwd(), onDisk(join(process.cwd(), CONTRACT)) ?? "");
  if (unready !== undefined) return calledOwner(ticket, builderCaller(ticket), `its tree's setup failed: ${quoted(unready)}`);
  const opening = handedOn({
    ticket,
    body,
    alongside: owning.carried.alongside,
    commitlint: commitlinted(),
    foreign: FOREIGN,
    capture: captureOf(body, process.env.SESSION_CAPTURES),
    unset: unsetKeys(),
  });
  const said: string[] = [];
  let mainBefore = "";
  const looped = await stageLoop<number>({
    spend: async (handed, carried) => {
      mainBefore = fetchedMain();
      const spent = await spentOn(`fix: #${ticket}`, spend, handed, carried, opening);
      keepSession(ticket, spent.session ?? carried);
      return spent;
    },
    input: opening,
    session: savedSession(ticket),
    stops: [],
    judged: async (spent) => {
      if (app !== undefined) freshAppToken(app, gh, `so the build of #${ticket} is not acted on`);
      if (spent.refusal !== undefined) return { done: calledOwner(ticket, builderCaller(ticket), spent.refusal) };
      const answer = spent.answer as Answer | undefined;
      if (answer?.outcome === "code") said.push(answer.reason);
      const round = outcomeOf(ticket, body, answer, mainBefore);
      if (round.ended !== undefined) return { done: round.ended };
      body = round.body ?? body;
      committed(builtBy(ticket), "feat");
      const judgedRound = round.red === undefined ? await judged(ticket) : round;
      if (judgedRound.ended !== undefined) return { done: judgedRound.ended };
      const { red } = judgedRound;
      if (red === undefined) return { done: await reviewedAndLanded(ticket, { body, alongside: owning.carried.alongside, said: said.join("\n\n") }, app) };
      return { refused: red, handBack: red };
    },
  });
  return "done" in looped ? looped.done : calledOwner(ticket, builderCaller(ticket), looped.refused);
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  const app = takenAppKey();
  const ended = await readOrStop("fix", () => ownTicket(ticket, app));
  process.exit(ended);
}
