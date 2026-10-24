import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { admission, doesNotBuild } from "./admit.ts";
import { type AppKey, freshAppToken, takenAppKey } from "./app-token.ts";
import { capped, LIST_CAP, NO_EM_DASH, onDisk, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { PUBLISHED_CHECK } from "./checks.ts";
import { BUILDER_SPLIT, commentOnTicket, commentsRead, ENROLLED_CALLER, faultOf, firstStepOf, FOLLOW_UP_OF, FOREIGN, followUpBody, gh, ghRead, git, gitRead, MACHINE_REPO, mark, MISSING, NOTHING_MARKED, OWNER, post, postRefusals, readOrStop, rewriteTicket, FILED_IN, STUCK, ticketBranch, unread, WAITING } from "./post.ts";
import { reviewedAndLanded } from "./reviewer.ts";
import { calledOwner, committed, commitlinted, CONTRACT, opened, setupRefusal, type Spent, treePathed } from "./stage.ts";
import { BUILDING, TICKET } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { doneWhen, quoted, why, whyChanged } from "./ticket-shape.ts";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["code", "split", "done", "close", "stuck", "machine", "owned"] },
    reason: { type: "string", pattern: NO_EM_DASH },
    repo: { type: "string", pattern: `^${OWNER}/[\\w.-]+$` },
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
  outcome: "code" | "split" | "done" | "close" | "stuck" | "machine" | "owned";
  reason: string;
  repo?: string;
  body?: string;
  tickets?: Piece[];
}

const stoppedAt = stopsOf({ unadmitted: "Build refused: the ticket's checks would run as shell with the App's token" });

export const splitInto = (ticket: string) => `@${OWNER} the builder split #${ticket} into`;
export const splitClosed = (ticket: string) => `Every ticket #${ticket} was split into has closed:`;
export const LABELLED_WAITING = `labelled \`${WAITING}\``;
const wokenByTheCloser = (ticket: string) => `#${ticket} waits on it, ${LABELLED_WAITING}, and the closer wakes it once every one of them closes:`;
export const waitsOnFault = (ticket: string, filed: string[]) => `The builder of #${ticket} found the machine at fault and filed ${filed.join(", ")}. ${wokenByTheCloser(ticket)}`;
const handedStep = (ticket: string, repo: string, filed: string[]) => `The builder of #${ticket} handed its first step to ${repo} and filed ${filed.join(", ")}.`;
export const waitsOnStep = (ticket: string, repo: string, filed: string[]) => `${handedStep(ticket, repo, filed)} ${wokenByTheCloser(ticket)}`;
const waitsUnheard = (ticket: string, repo: string, filed: string[]) => `${handedStep(ticket, repo, filed)} #${ticket} waits on it, ${LABELLED_WAITING}. @${OWNER} ${repo} carries no caller file, so nothing hears it close: take \`${WAITING}\` off #${ticket} once every one of them closes:`;
export const filedClosed = (ticket: string) => `Every ticket the builder of #${ticket} filed and waits on has closed:`;
const FILED = /\/issues\/(\d+)\s*$/;

interface Handed {
  ticket: string;
  body: string;
  capture?: string;
  woken?: string;
  alongside?: string;
  commitlint?: boolean;
  foreign?: boolean;
}

type Round = { red?: string; ended?: number; body?: string };

type Spend = (input: string, resume?: string) => Spent;

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

export function checkedBy(check: string): Red | undefined {
  const { GITHUB_ACTIONS: _annotating, ...env } = process.env;
  const { stdout, stderr } = spawnSync("bash", ["-c", check], { env: treePathed(env), encoding: "utf8" });
  const verdict = stdout.trim().split("\n").at(-1) ?? "";
  if (PASSED.test(verdict)) return undefined;
  const logPath = LOGGED.exec(verdict)?.[1];
  const log = stripVTControlCharacters((logPath === undefined ? undefined : onDisk(resolve(logPath))) || `${stdout}${stderr}`).trim();
  return { verdict, failed: failedSteps(log) || log };
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
    ? `- \`machine\`: the machine is at fault; it lives in ${MACHINE_REPO}, not this tree, so change nothing here for it: file the fault as \`tickets\`, and this ticket waits on them.`
    : "- `machine`: the machine is at fault; fix it in a worktree off `origin/main`, commit naming this ticket, and `bin/land` it first.";

export function handedOn({ ticket, body, capture, woken, alongside, commitlint, foreign }: Handed): string {
  return [
    `# Ticket #${ticket}`,
    capped(body, TICKET_CAP),
    ...(woken === undefined ? [] : ["## How its split ended", "Build what a piece closed unbuilt left, or rule it out:", capped(woken, LIST_CAP)]),
    ...alongsideSection(alongside),
    ...filedIn(capture),
    "## Build it",
    "Ship the Why whole with the smallest change that does it: its `## Done when` is the floor, and every path your change touches works for the Why, edge cases with it. Every open choice is yours: decide it as the senior engineer the owner hired, and say why in its commit. Call the Skill tool with `tdd` and follow it to the end.",
    "Stop at the fast `check`: the full check runs once you answer, outside your time cap, so running it yourself only spends that cap.",
    "Commit your work, each message saying why, with no em dash and no closing keyword such as `Fixes #12`: `bin/land` refuses them.",
    ...(commitlint ? ["This repo runs commitlint on every commit: write each message as `type: subject`, the type `feat`, `fix` or another conventional one, the subject lower-case, as the machine's own are."] : []),
    "## Your answer",
    "Answer one outcome:",
    `- \`code\`: built; the machine commits whatever you left, runs \`${PUBLISHED_CHECK}\` and hands back each red until it passes, then a fresh reviewer reads your diff, fixes what it finds, and lands it with \`bin/land\`. Where its \`## Done when\` was wrong, give the ticket rewritten to hold its whole Why as \`body\`, Why byte-identical; it is posted on the ticket before the check.`,
    "- `split`: too big for one build; file `tickets` that build at once, each with `done` as the sentences true once it is built. What must wait for them stays as `body`, Why byte-identical, and builds once they merge.",
    "- `done`: main already does what it asks, as when an earlier run landed it and its close failed; it closes completed, and no one is called.",
    "- `close`: the ticket should not exist as written, and nothing should replace it, as for a gate you cannot make pass, since a gate is proven first.",
    "- `stuck`: you cannot build it, even rewritten; `reason` says why, and the ticket is marked `stuck`.",
    machineAtFault(foreign),
    `- \`owned\`: its first step belongs in the one other repo that owns that kind of fix, such as \`${OWNER}/design-kit\` for a kit primitive or \`${OWNER}/agent-skills\` for a skill or shared tool: name it as \`repo\`, change nothing here for it, and file that step as \`tickets\`; this ticket waits on them and builds once they close.`,
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
  if (refusal !== undefined) return calledOwner(ticket, "builder", `its closing reason was refused: ${quoted(refusal)}`);
  if (gh(["issue", "close", ticket, "--reason", reason]).status !== 0) return calledOwner(ticket, "builder", "it ruled the ticket closed and the ticket would not close");
  console.log(`fix: #${ticket} closed ${reason}: ${said}`);
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
  if (numbers.length < filed.length) return { ended: calledOwner(ticket, "builder", `its split filed ${numbers.length} of ${filed.length} tickets${named === "" ? "" : `, ${named}`}: ${quoted(filed.find(({ said }) => !FILED.test(said))?.refusals[0] ?? "")}`) };
  if (answer.body === undefined) return { ended: closedAs(ticket, "not planned", `${splitInto(ticket)} ${named}, which build themselves, and closed it: ${answer.reason}`) };
  const written = gh(["issue", "edit", ticket, "--body", answer.body]);
  if (written.status !== 0) return { ended: calledOwner(ticket, "builder", `it filed ${named} and its rewrite of what waits would not save: ${quoted((written.stderr || written.stdout).trim().split("\n")[0] ?? "")}`) };
  commentOnTicket(ticket, `${splitInto(ticket)} ${named}, which build themselves. #${ticket} keeps what must wait for them, ${LABELLED_WAITING}, and builds once they all close: ${answer.reason}`, gh);
  mark(ticket, WAITING);
  git(["reset", "--quiet", "--hard", "origin/main"]);
  git(["push", "--quiet", "origin", "--delete", ticketBranch(ticket)]);
  console.log(`fix: #${ticket} split into ${named}; it waits for them`);
  return { ended: 0 };
}

function rewritten(ticket: string, body: string, answer: Answer): Round {
  if (answer.body === undefined || answer.body.trim() === body.trim()) return {};
  const written = rewriteTicket(ticket, body, answer.body, gh);
  const [refusal] = written.refusals;
  if (refusal !== undefined) return { red: `Your rewrite of the ticket was refused: ${quoted(refusal)}` };
  commentOnTicket(ticket, `The builder of #${ticket} rewrote what done looks like against its Why, and builds it as rewritten in this run: ${answer.reason}\n\n## Done when\n\n${doneWhen(answer.body)}`, gh);
  console.log(`fix: #${ticket} rewritten; it builds as rewritten`);
  return { body: answer.body };
}

interface Handing {
  repo: string;
  filedFrom: (origin: string) => string;
  parked: (filed: string[]) => string;
  unfiled: string;
}

function filedToWaitOn(ticket: string, answer: Answer, { repo, filedFrom, parked, unfiled }: Handing): Round {
  const origin = filedFrom(`${process.env.GH_REPO ?? ""}#${ticket}`);
  const postings = (answer.tickets ?? []).map(({ title, why: step, done }) => ({ title, text: followUpBody([origin, "", `> ${step}`], done) }));
  const refused = postings.length === 0 ? [unfiled] : postings.flatMap((posting) => postRefusals({ kind: "ticket", ...posting }).map((refusal) => `${posting.title}: ${refusal}`));
  if (refused.length > 0) return { red: [`Your \`${answer.outcome}\` answer was refused, and nothing was filed:`, ...refused.map((refusal) => `- ${refusal}`)].join("\n") };
  const inRepo = (args: string[]) => gh([...args, "--repo", repo]);
  const filed = postings.map((posting) => post({ kind: "ticket", ...posting }, inRepo).said.trim());
  if (filed.some((said) => !FILED.test(said))) return { ended: calledOwner(ticket, "builder", `it filed ${filed.filter((said) => FILED.test(said)).length} of ${filed.length} tickets in ${repo} to wait on`) };
  commentOnTicket(ticket, `${parked(filed)} ${answer.reason}`, gh);
  mark(ticket, WAITING);
  console.log(`fix: #${ticket} waits on ${filed.join(", ")}, filed in ${repo}`);
  return { ended: 0 };
}

const filedForMachine = (ticket: string, answer: Answer): Round =>
  filedToWaitOn(ticket, answer, { repo: MACHINE_REPO, filedFrom: faultOf, parked: (filed) => waitsOnFault(ticket, filed), unfiled: "a `machine` answer from a tree that is not the machine's files the machine's fault as one ticket or more in `tickets`" });

function heardIn(repo: string): boolean {
  const got = gh(["--missing-answers", "api", `repos/${repo}/contents/.github/workflows/${ENROLLED_CALLER}`, "--silent"]);
  if (got.status === 0) return true;
  return MISSING.test(got.stderr) ? false : unread(`whether ${repo} carries a caller file could not be read, ${NOTHING_MARKED}`);
}

function handedToItsRepo(ticket: string, answer: Answer): Round {
  const { repo } = answer;
  if (repo === undefined) return { red: "Your `owned` answer was refused, and nothing was filed: it names the repo that owns its first step as `repo`." };
  if (repo === process.env.GH_REPO) return { red: `Your \`owned\` answer was refused, and nothing was filed: ${repo} is this ticket's own repo, so build its first step here.` };
  const parked = heardIn(repo) ? waitsOnStep : waitsUnheard;
  return filedToWaitOn(ticket, answer, { repo, filedFrom: firstStepOf, parked: (filed) => parked(ticket, repo, filed), unfiled: "an `owned` answer files its first step as one ticket or more in `tickets`" });
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
  if (answer.outcome === "done") return { ended: closedAs(ticket, "completed", `The builder of #${ticket} found its work already on main and closed it: ${answer.reason}`) };
  if (answer.outcome === "close") return { ended: closedAs(ticket, "not planned", `@${OWNER} the builder closed #${ticket} unbuilt and kept its branch: ${answer.reason}`) };
  if (answer.outcome === "stuck") return { ended: calledOwner(ticket, "builder", answer.reason) };
  if (answer.outcome === "split") return split(ticket, body, answer);
  if (answer.outcome === "machine" && FOREIGN) return filedForMachine(ticket, answer);
  if (answer.outcome === "owned") return handedToItsRepo(ticket, answer);
  if (answer.outcome === "machine") return landedOnMain(ticket, answer.reason, mainBefore);
  return rewritten(ticket, body, answer);
}

export function spentOn(said: string, spend: Spend, input: string, session: string | undefined, opening: string): Spent {
  const fresh = () => spend(input === opening ? input : [opening, input].join("\n\n"));
  if (session === undefined) return fresh();
  const resumed = spend(input, session);
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

function judged(): Round {
  if (gitRead(["rev-list", "--count", "origin/main..HEAD"], PAST_MAIN_UNREAD) === "0") return { red: "You answered `code`, and this branch has no commits past main, so there is nothing to land: build the ticket, or answer `done` if main already does what it asks." };
  const lost = mergesCarryingWork();
  if (lost.length > 0) return { red: `You answered \`code\`, and a rebase drops merge commits, so these past main would land without the work they carry beyond a clean merge of their parents: ${lost.join(", ")}. Leave that work out of merge commits and add its work as plain commits on top of main, such as with \`git reset --soft origin/main\` and a fresh commit.` };
  const red = checkedBy(PUBLISHED_CHECK);
  return red === undefined ? {} : { red: repaired(red) };
}

function owned(ticket: string, body: string) {
  const refused = admission(ticket, NOTHING_MARKED);
  if (refused !== undefined) return stoppedAt("unadmitted", `fix: ${doesNotBuild(ticket, refused)}`);
  return { carrying: { onTicket: commentsRead(ticket, `the comments on #${ticket} could not be read, ${NOTHING_MARKED}`, gh), alongside: onTheSameFiles(ticket, body) } };
}

function ownTicket(ticket: string, app: AppKey | undefined): number {
  const owning = opened({
    stage: "fix",
    issue: ticket,
    state: BUILDING,
    stoppedAt,
    hire: { name: "builder", model: "opus", answers: ANSWER },
    ready: (asked) => owned(ticket, asked.body),
  });
  if (typeof owning !== "object") return exitFor(owning);
  const { asked, spend } = owning;
  let body = asked.body;
  let session = savedSession(ticket);
  const unready = setupRefusal(onDisk(join(process.cwd(), CONTRACT)) ?? "");
  if (unready !== undefined) return calledOwner(ticket, "builder", `its tree's setup failed: ${quoted(unready)}`);
  const opening = handedOn({
    ticket,
    body,
    alongside: owning.carried.alongside,
    commitlint: commitlinted(),
    foreign: FOREIGN,
    capture: captureOf(body, process.env.SESSION_CAPTURES),
    woken: owning.carried.onTicket.filter((said) => said.startsWith(splitClosed(ticket))).at(-1),
  });
  let input = opening;
  const said: string[] = [];
  for (;;) {
    const mainBefore = fetchedMain();
    const spent = spentOn(`fix: #${ticket}`, spend, input, session, opening);
    session = spent.session ?? session;
    keepSession(ticket, session);
    if (app !== undefined) freshAppToken(app, gh, `so the build of #${ticket} is not acted on`);
    if (spent.refusal !== undefined) return calledOwner(ticket, "builder", spent.refusal);
    const answer = spent.answer as Answer | undefined;
    if (answer?.outcome === "code") said.push(answer.reason);
    const round = outcomeOf(ticket, body, answer, mainBefore);
    if (round.ended !== undefined) return round.ended;
    body = round.body ?? body;
    committed(builtBy(ticket), "feat");
    const { red } = round.red === undefined ? judged() : round;
    if (red === undefined) return reviewedAndLanded(ticket, { body, alongside: owning.carried.alongside, said: said.join("\n\n") }, app);
    input = red;
  }
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  const app = takenAppKey();
  const ended = readOrStop("fix", () => ownTicket(ticket, app));
  process.exit(typeof ended === "number" ? ended : 1);
}
