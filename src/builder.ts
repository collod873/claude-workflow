import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { admission, doesNotBuild } from "./admit.ts";
import { capped, handedDiff, LIST_CAP, NO_EM_DASH, onDisk, TICKET_CAP } from "./brief.ts";
import { FULL_CHECK, UNFENCED } from "./fence.ts";
import { answered, type Asked, BUILDER_SPLIT, commentOnTicket, commentsRead, earlierDrift, faultOf, FOLLOW_UP_OF, FOREIGN, followUpBody, gh, ghRead, git, gitRead, MACHINE_REPO, machineBin, mark, NOTHING_MARKED, OWNER, post, postRefusals, prOfTicket, readOrStop, repairOf, RESOLVING, rewriteTicket, sessionLine, STUCK, ticketBranch, unread, WAITING } from "./post.ts";
import { CONTRACT, machineLogs, opened, setupRefusal, type Spent, treePathed } from "./stage.ts";
import { BUILDING, CHECKING } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { DONE_SENTENCES, quoted, why, whyChanged } from "./ticket-shape.ts";

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
          done: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
        },
        required: ["title", "why", "done"],
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
  done: string[];
}

interface Answer {
  outcome: "code" | "ticket" | "split" | "close" | "machine";
  reason: string;
  body?: string;
  tickets?: Piece[];
}

const stoppedAt = stopsOf({ unadmitted: "Build refused: the ticket's checks would run as shell with the App's token" });

export const splitInto = (ticket: string) => `@${OWNER} the builder split #${ticket} into`;
export const splitClosed = (ticket: string) => `Every ticket #${ticket} was split into has closed:`;
export const FILED = /\/issues\/(\d+)\s*$/;

interface Handed {
  ticket: string;
  body: string;
  red?: { failed: string; diff: string; gaps: string };
  contract?: string;
  capture?: string;
  woken?: string;
  commitlint?: boolean;
  foreign?: boolean;
}

type Round = { red?: string; ended?: number };

type Spend = (input: string, resume?: string) => Spent;

export const TAIL_CAP = 8 * 1024;
export const CONTRACT_CAP = 4 * 1024;
const CHECK = `${FULL_CHECK} --publish`;
const PASSED = /^check: ok\b/;
const LOGGED = /; log (.+?)\s*$/;
const FILED_IN = new RegExp(`^${sessionLine("([^`]+)")}\\s*$`, "m");

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

function tailOf(text: string, limit: number): string {
  const bytes = Buffer.from(text);
  return bytes.length <= limit ? text : bytes.subarray(bytes.length - limit).toString("utf8").replace(/^\uFFFD+/, "");
}

export function repaired(output: string): string {
  return [`\`${CHECK}\` is still red. The end of its output:`, tailOf(output, TAIL_CAP), "Make it pass.", ""].join("\n\n");
}

const RED_NAMES = /^check: red (.*?)(?:; |$)/;
const NEEDS = " (needs ";
const UNMET = new RegExp(`[^\\s,]+${NEEDS.replace("(", "\\(")}[^)]*\\)`, "g");

const onlyUnmet = (verdict: string) => {
  const named = RED_NAMES.exec(verdict)?.[1] ?? "";
  return named.includes(NEEDS) && named.replace(UNMET, "").replace(/[\s,]/g, "") === "";
};

function checkRed(): string {
  const { GITHUB_ACTIONS: _annotating, ...env } = process.env;
  const { stdout, stderr } = spawnSync("bash", ["-c", CHECK], { env: treePathed(env), encoding: "utf8" });
  const output = `${stdout}${stderr}`.trim();
  const verdict = stdout.trim().split("\n").at(-1) ?? "";
  if (PASSED.test(verdict) || (FOREIGN && onlyUnmet(verdict))) return "";
  const log = LOGGED.exec(verdict)?.[1];
  return [output, log === undefined ? "" : (onDisk(resolve(log)) ?? "")].join("\n");
}

const buildIt = (contract: string) => [
  "## Build it",
  "Build what the ticket's Why asks for until its `## Done when` holds.",
  "Call the Skill tool with `testing` before the first test: it is the standard for which tests are worth writing and what to do when an existing one goes red. Then work red before green, one slice at a time: write one failing test, see it fail, write only enough to pass it, repeat.",
  "Commit your own work, each message saying why. If the test count drops, give the reason on a line of its own: `Test count drop: <why>`; a test `testing` says to cut is reason enough.",
  `Run \`${FULL_CHECK}\` last: it runs every step of \`${CONTRACT}\` no receipt already covers, so running a step apart only repeats it. The steps stand in your tree as:`,
  ["```json", capped(contract, CONTRACT_CAP).trimEnd(), "```"].join("\n"),
];

const howItFailed = ({ failed, diff, gaps }: NonNullable<Handed["red"]>) => [
  "## How it failed",
  tailOf(failed, TAIL_CAP) || "(nothing logged)",
  "## Diff from main",
  handedDiff(diff) || "(none)",
  "## Reviewer's gaps",
  capped(gaps, LIST_CAP) || "(none)",
];

const leftToItsCI = (foreign: boolean | undefined) =>
  foreign === true ? [`This repo's own CI judges its PR. A step the check names red only as \`<step>${NEEDS}<VAR>)\` is one this runner lacks what it needs for: the machine leaves it to that CI, so do not provide it yourself.`] : [];

const linted = (commitlint: boolean | undefined) =>
  commitlint === true ? ["This repo runs commitlint on every commit: write each message as `type: subject`, the type `feat`, `fix` or another conventional one, the subject lower-case, as the machine's own are."] : [];

const machineAtFault = (foreign: boolean | undefined) =>
  foreign === true
    ? `- \`machine\`: the machine is at fault, reviewer included; it lives in ${MACHINE_REPO}, not this tree, so change nothing here for it: file the fault as \`tickets\`, and this ticket waits on them.`
    : "- `machine`: the machine is at fault, reviewer included; fix it in a worktree off `origin/main`, commit naming this ticket, and `bin/land` it first.";

export function handedOn({ ticket, body, red, contract = "", capture, woken, commitlint, foreign }: Handed): string {
  return [
    `# Ticket #${ticket}`,
    capped(body, TICKET_CAP),
    ...(woken === undefined ? [] : ["## How its split ended", "Build what a piece closed unbuilt left, or rule it out:", capped(woken, LIST_CAP)]),
    ...filedIn(capture),
    ...(red === undefined ? buildIt(contract) : howItFailed(red)),
    ...leftToItsCI(foreign),
    ...linted(commitlint),
    "## You own it until it merges",
    "Every red on this ticket comes back to you until it merges. Read its Why first; `gh` reads any run. If the reason above names a merge conflict, merge main in and resolve it yourself, keeping the ticket's Why over main's conflicting change. Answer one outcome:",
    `- \`code\`: build or fix it, or change nothing on a flake; the machine commits, runs \`${CHECK}\`, hands back red, pushes green or reruns the red Check.`,
    "- `ticket`: its `## Done when` is wrong; return the ticket as `body`, Why byte-identical; nothing is pushed, and it waits for the owner.",
    `- \`split\`: too big for one build; file \`tickets\` that build at once, each with \`done\` as ${DONE_SENTENCES}. What must wait for them stays as \`body\`, Why byte-identical, and builds once they merge.`,
    "- `close`: the ticket should not exist as written, and nothing should replace it.",
    machineAtFault(foreign),
    "`reason`: one paragraph for the owner. Two rounds in a row that change nothing call them.",
    "",
  ].join("\n\n");
}

const builtBy = (ticket: string) => `Build #${ticket} as its builder`;
const COMMITLINT = /^(\.commitlintrc(\.\w+)?|commitlint\.config\.[cm]?[jt]s)$/;
const COMMITLINT_KEY = /"commitlint"\s*:/;
const commitlinted = () => readdirSync(process.cwd()).some((name) => COMMITLINT.test(name)) || COMMITLINT_KEY.test(onDisk(join(process.cwd(), "package.json")) ?? "");
const conventional = (type: string, message: string) => `${type}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;

function commitOf(ticket: string, repairing: boolean, commitlint: boolean): string {
  const message = repairing ? repairOf(ticket) : builtBy(ticket);
  return commitlint ? conventional(repairing ? "fix" : "feat", message) : message;
}

const head = () => gitRead(["rev-parse", "HEAD"], "the head of this branch could not be read");
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

function failure(ticket: string, logs: string, run: string): string {
  const logged = readdirSync(logs)
    .filter((name) => name.endsWith(`-${ticket}.log`))
    .sort()
    .map((name) => `### ${name}\n\n${readFileSync(join(logs, name), "utf8").trim()}`);
  const failedRun = ghRead(["run", "view", run, "--log-failed"], `the failed steps of run ${run} could not be read, ${NOTHING_MARKED}`);
  const ranRed = failedRun === "" ? [] : [`### run ${run}, its failed steps\n\n${failedRun}`];
  return [...logged, ...ranRed].join("\n\n");
}

function calledOwner(ticket: string, why: string): number {
  mark(ticket, STUCK);
  commentOnTicket(ticket, `@${OWNER} the builder of #${ticket} stopped and needs you: ${why}`, gh);
  console.error(`fix: #${ticket} needs the owner, ${why}`);
  return 1;
}

function closedUnbuilt(ticket: string, said: string): number {
  const posted = commentOnTicket(ticket, said, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return calledOwner(ticket, `its closing reason was refused: ${quoted(refusal)}`);
  if (gh(["issue", "close", ticket, "--reason", "not planned"]).status !== 0) return calledOwner(ticket, "it ruled the ticket closed and the ticket would not close");
  gh(["pr", "close", ticketBranch(ticket)]);
  console.log(`fix: #${ticket} closed unbuilt: ${said}`);
  return 0;
}

const pieceBody = (ticket: string, parentWhy: string, { why: piece, done }: Piece): string =>
  followUpBody(
    [
      `${FOLLOW_UP_OF}${ticket}${BUILDER_SPLIT}, since it does not fit one build.`,
      "",
      `> ${piece}`,
      "",
      `The Why of #${ticket}, of which this builds only the part above:`,
      "",
      ...parentWhy.split("\n").map((line) => `> ${line}`.trimEnd()),
    ],
    done,
  );

function splitRefusals(body: string, answer: Answer, postings: { title: string; text: string }[]): string[] {
  if (why(body).includes(FOLLOW_UP_OF)) return ["this ticket is itself a follow-up, so it is not split again"];
  if (postings.length === 0) return ["a split files at least one ticket in `tickets`"];
  return [
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
  commentOnTicket(ticket, `${splitInto(ticket)} ${named}, which build themselves. #${ticket} keeps what must wait for them, labelled \`${WAITING}\`, and builds once they all close: ${answer.reason}`, gh);
  mark(ticket, WAITING);
  gh(["pr", "close", ticketBranch(ticket), "--delete-branch"]);
  console.log(`fix: #${ticket} split into ${named}; it waits for them`);
  return { ended: 0 };
}

function rewritten(ticket: string, body: string, answer: Answer): Round {
  if (answer.body === undefined || answer.body.trim() === body.trim()) return { red: "Your `ticket` answer returned the ticket unchanged: return it rewritten as `body`, or answer another outcome." };
  const written = rewriteTicket(ticket, body, answer.body, gh);
  const [refusal] = written.refusals;
  if (refusal !== undefined) return { red: `Your rewrite of the ticket was refused: ${quoted(refusal)}` };
  commentOnTicket(ticket, `@${OWNER} the builder of #${ticket} rewrote what done looks like and pushed nothing. #${ticket} waits for you, labelled \`${WAITING}\`: take the label off to build it as rewritten. ${answer.reason}`, gh);
  mark(ticket, WAITING);
  console.log(`fix: #${ticket} rewritten; it waits for the owner`);
  return { ended: 0 };
}

const faultBody = (ticket: string, { why: fault, done }: Piece): string =>
  followUpBody([faultOf(`${process.env.GH_REPO ?? ""}#${ticket}`), "", `> ${fault}`], done);

const inMachineRepo = (args: string[]) => gh([...args, "--repo", MACHINE_REPO]);

function filedForMachine(ticket: string, answer: Answer): Round {
  const postings = (answer.tickets ?? []).map((piece) => ({ title: piece.title, text: faultBody(ticket, piece) }));
  const refused = postings.length === 0 ? ["a `machine` answer from a tree that is not the machine's files the machine's fault as one ticket or more in `tickets`"] : postings.flatMap((posting) => postRefusals({ kind: "ticket", ...posting }).map((refusal) => `${posting.title}: ${refusal}`));
  if (refused.length > 0) return { red: ["Your `machine` answer was refused, and nothing was filed:", ...refused.map((refusal) => `- ${refusal}`)].join("\n") };
  const filed = postings.map((posting) => post({ kind: "ticket", ...posting }, inMachineRepo).said.trim());
  if (filed.some((said) => !FILED.test(said))) return { ended: calledOwner(ticket, `it found the machine at fault and filed ${filed.filter((said) => FILED.test(said)).length} of ${filed.length} tickets in ${MACHINE_REPO}`) };
  commentOnTicket(ticket, `@${OWNER} the builder of #${ticket} found the machine at fault and filed ${filed.join(", ")}. #${ticket} waits on it, labelled \`${WAITING}\`: take the label off once it merges. ${answer.reason}`, gh);
  mark(ticket, WAITING);
  console.log(`fix: #${ticket} waits on the machine's fault, filed as ${filed.join(", ")}`);
  return { ended: 0 };
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
  if (answer.outcome === "close") return { ended: closedUnbuilt(ticket, `@${OWNER} the builder closed #${ticket} unbuilt and kept its branch: ${answer.reason}`) };
  if (answer.outcome === "split") return split(ticket, body, answer);
  if (answer.outcome === "ticket") return rewritten(ticket, body, answer);
  if (answer.outcome === "machine" && FOREIGN) return filedForMachine(ticket, answer);
  if (answer.outcome === "machine") return landedOnMain(ticket, answer.reason, mainBefore);
  return {};
}

function committed(message: string): void {
  if (gitRead(["status", "--porcelain"], "what the builder changed could not be read") === "") return;
  git(["add", "--all"]);
  git(["commit", "--quiet", "-m", message]);
}

function spentOn(ticket: string, spend: Spend, input: string, session: string | undefined, opening: string): Spent {
  const fresh = () => spend(input === opening ? input : [opening, input].join("\n\n"));
  if (session === undefined) return fresh();
  const resumed = spend(input, session);
  if (resumed.refusal === undefined) return resumed;
  console.error(`fix: #${ticket} could not resume its builder's session ${session}, so it starts fresh: ${resumed.refusal}`);
  return fresh();
}

const REPO_FAULT = 3;

function unconflicted(ticket: string): Round {
  fetchedMain();
  if (answered(git(["merge-tree", "--write-tree", "--quiet", "origin/main", "HEAD"]), `whether the PR of #${ticket} conflicts with main could not be read, so it is not handed back`)) return {};
  return { red: `The PR of #${ticket} is open in conflict with main, so no check runs on it: merge origin/main into this branch, resolve the conflict, and answer \`code\`.` };
}

function saved(ticket: string, logs: string): Round {
  const save = spawnSync(machineBin("save"), [ticket], { encoding: "utf8" });
  if (save.status === 0) return unconflicted(ticket);
  if (save.status === REPO_FAULT) return { ended: calledOwner(ticket, save.stderr.trim()) };
  return { red: `Save could not push this branch or open its PR:\n\n${tailOf(onDisk(join(logs, `save-${ticket}.log`)) ?? save.stderr, TAIL_CAP)}` };
}

function redOrSaved(ticket: string, logs: string): Round {
  if (gitRead(["rev-list", "--count", "origin/main..HEAD"], "the commits past main could not be read, so nothing is pushed") === "0") return { red: "You answered `code`, and this branch has no commits past main, so there is nothing to push: build the ticket, or answer `close` if main already does what it asks." };
  const red = checkRed();
  return red === "" ? saved(ticket, logs) : { red: repaired(red) };
}

const ranAs = (run: string | undefined) =>
  run === undefined ? "" : ghRead(["run", "view", run, "--json", "event,headSha,attempt,workflowName", "--jq", '.event + " " + .headSha + " " + (.attempt | tostring) + " " + .workflowName'], `the workflow, head and attempt of run ${run} could not be read, so it is not marked checking`);

function checkingAgain(ticket: string, run: string | undefined, start: string, opensPr: boolean): number {
  const [event, at, attempt, ...named] = ranAs(run).split(" ");
  const workflow = named.join(" ");
  if (head() !== start || opensPr) mark(ticket, CHECKING);
  else if (event === "issues" || at !== head()) return calledOwner(ticket, "it is green unchanged and pushed nothing new, with no red check run of this head to rerun, so no check runs again");
  else {
    if (attempt !== "1") return calledOwner(ticket, `its red ${workflow} already reran once, and it is green here unchanged`);
    const again = gh(["run", "rerun", String(run), "--failed"]);
    if (again.status !== 0) return calledOwner(ticket, `it is green unchanged and the rerun of its red ${workflow} was refused: ${quoted((again.stderr || again.stdout).trim().split("\n")[0] ?? "")}`);
    mark(ticket, CHECKING, "--untry");
    console.log(`fix: #${ticket} is green unchanged, so its red ${workflow} reruns`);
    return 0;
  }
  console.log(`fix: #${ticket} is green and pushed, so its PR checks run again`);
  return 0;
}

function failedAs(ticket: string, logs: string, run: string | undefined): string | undefined {
  const reason = process.env.REASON ?? "";
  if (reason !== "") return reason;
  return run === undefined ? undefined : failure(ticket, logs, run);
}

function owned(ticket: string, run: string | undefined, asked: Asked) {
  const refused = admission(ticket, NOTHING_MARKED);
  if (refused !== undefined) return stoppedAt("unadmitted", `fix: ${doesNotBuild(ticket, refused)}`);
  const logs = machineLogs();
  const failed = failedAs(ticket, logs, run);
  const pr = prOfTicket(ticket, ["number"], gh);
  const judged = pr === "none" ? [] : commentsRead(String(pr.number), `the comments on PR #${pr.number} could not be read, ${NOTHING_MARKED}`, gh);
  const onTicket = commentsRead(ticket, `the comments on #${ticket} could not be read, ${NOTHING_MARKED}`, gh);
  const diff = failed === undefined ? "" : gitRead(["diff", "origin/main...HEAD"], `the diff from main could not be read, ${NOTHING_MARKED}`);
  return { carrying: { logs, failed, judged, onTicket, diff, opensPr: pr === "none" }, tried: failed !== undefined, unmarked: failed !== undefined && asked.labels.has(RESOLVING) };
}

function ownTicket(ticket: string, run: string | undefined): number {
  const owning = opened({
    stage: "fix",
    issue: ticket,
    state: BUILDING,
    stoppedAt,
    hire: { name: "builder", answers: ANSWER, skills: ["testing"], gated: true, reach: UNFENCED },
    ready: (asked) => owned(ticket, run, asked),
  });
  if (typeof owning !== "object") return exitFor(owning);
  const { asked, spend } = owning;
  const { logs, failed, judged, onTicket, diff, opensPr } = owning.carried;
  const body = asked.body;
  let session = savedSession(ticket);
  if (session === undefined && failed !== undefined) console.error(`fix: #${ticket} has no session of its builder saved, so it starts fresh`);
  const contract = onDisk(join(process.cwd(), CONTRACT)) ?? "";
  const unready = setupRefusal(contract);
  if (unready !== undefined) return calledOwner(ticket, `its tree's setup failed: ${quoted(unready)}`);
  const commitlint = commitlinted();
  const opening = handedOn({
    ticket,
    body,
    red: failed === undefined ? undefined : { failed, diff, gaps: earlierDrift(ticket, judged) },
    contract,
    commitlint,
    foreign: FOREIGN,
    capture: captureOf(body, process.env.SESSION_CAPTURES),
    woken: onTicket.filter((said) => said.startsWith(splitClosed(ticket))).at(-1),
  });
  let input = opening;
  let idle = false;
  const start = head();
  for (;;) {
    const before = { head: head(), main: fetchedMain() };
    const spent = spentOn(ticket, spend, input, session, opening);
    session = spent.session ?? session;
    keepSession(ticket, session);
    if (spent.refusal !== undefined) return calledOwner(ticket, spent.refusal);
    const answer = spent.answer as Answer | undefined;
    const round = outcomeOf(ticket, body, answer, before.main);
    if (round.ended !== undefined) return round.ended;
    committed(commitOf(ticket, failed !== undefined, commitlint));
    const changed = head() !== before.head || fetchedMain() !== before.main;
    const verdict = round.red === undefined ? redOrSaved(ticket, logs) : { red: round.red };
    if (verdict.ended !== undefined) return verdict.ended;
    const { red } = verdict;
    if (red === undefined) return checkingAgain(ticket, run, start, opensPr);
    if (!changed && idle) return calledOwner(ticket, `two rounds in a row changed nothing: ${round.red ?? answer?.reason ?? "it gave no outcome"}`);
    idle = !changed;
    input = red;
  }
}

if (import.meta.main) {
  const [ticket, run] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  const ended = readOrStop("fix", () => ownTicket(ticket, run));
  process.exit(typeof ended === "number" ? ended : 1);
}
