import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { admission, doesNotBuild } from "./admit.ts";
import { capped, LIST_CAP, NO_EM_DASH, onDisk, TAIL_CAP, tailOf, TICKET_CAP } from "./brief.ts";
import { FULL_CHECK } from "./checks.ts";
import { BUILDER_SPLIT, commentOnTicket, commentsRead, faultOf, FOLLOW_UP_OF, FOREIGN, followUpBody, gh, git, gitRead, MACHINE_REPO, mark, NOTHING_MARKED, OWNER, post, postRefusals, readOrStop, rewriteTicket, FILED_IN, STUCK, ticketBranch, WAITING } from "./post.ts";
import { reviewedAndLanded } from "./reviewer.ts";
import { calledOwner, committed, commitlinted, CONTRACT, head, linted, opened, OWNER_STEPS, type OwnerStep, setupRefusal, type Spent, treePathed } from "./stage.ts";
import { BUILDING } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { DONE_SENTENCES, doneWhen, quoted, why, whyChanged } from "./ticket-shape.ts";

const ANSWER = {
  type: "object",
  properties: {
    outcome: { enum: ["code", "ticket", "split", "close", "stuck", "machine"] },
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
    steps: OWNER_STEPS,
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
  outcome: "code" | "ticket" | "split" | "close" | "stuck" | "machine";
  reason: string;
  body?: string;
  tickets?: Piece[];
  steps?: OwnerStep[];
}

const stoppedAt = stopsOf({ unadmitted: "Build refused: the ticket's checks would run as shell with the App's token" });

export const splitInto = (ticket: string) => `@${OWNER} the builder split #${ticket} into`;
export const splitClosed = (ticket: string) => `Every ticket #${ticket} was split into has closed:`;
export const LABELLED_WAITING = `labelled \`${WAITING}\``;
export const waitsOnFault = (ticket: string, filed: string[]) => `The builder of #${ticket} found the machine at fault and filed ${filed.join(", ")}. #${ticket} waits on it, ${LABELLED_WAITING}, and the closer wakes it once every one of them closes:`;
export const faultsClosed = (ticket: string) => `Every machine fault #${ticket} waits on has closed:`;
export const FILED = /\/issues\/(\d+)\s*$/;

interface Handed {
  ticket: string;
  body: string;
  contract?: string;
  capture?: string;
  woken?: string;
  commitlint?: boolean;
  foreign?: boolean;
}

type Round = { red?: string; ended?: number; body?: string };

type Spend = (input: string, resume?: string) => Spent;

export const CONTRACT_CAP = 4 * 1024;
const CHECK = `${FULL_CHECK} --publish`;
const PASSED = /^check: ok\b/;
const LOGGED = /; log (.+?)\s*$/;

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

export function repaired(output: string): string {
  return [`\`${CHECK}\` is still red. The end of its output:`, tailOf(output, TAIL_CAP), "Make it pass.", ""].join("\n\n");
}

function readiedTree(): { contract: string; unready: string | undefined } {
  const contract = onDisk(join(process.cwd(), CONTRACT)) ?? "";
  return { contract, unready: setupRefusal(contract) };
}

function checked(): string | undefined {
  const { GITHUB_ACTIONS: _annotating, ...env } = process.env;
  const { stdout, stderr } = spawnSync("bash", ["-c", CHECK], { env: treePathed(env), encoding: "utf8" });
  const output = `${stdout}${stderr}`.trim();
  const verdict = stdout.trim().split("\n").at(-1) ?? "";
  if (PASSED.test(verdict)) return undefined;
  const log = LOGGED.exec(verdict)?.[1];
  return [output, log === undefined ? "" : (onDisk(resolve(log)) ?? "")].join("\n");
}

const buildIt = (contract: string) => [
  "## Build it",
  "Build what the ticket's Why asks for until its `## Done when` holds.",
  "Call the Skill tool with `testing` before the first test: it is the standard for which tests are worth writing and what to do when an existing one goes red. Then work red before green, one slice at a time: write one failing test, see it fail, write only enough to pass it, repeat.",
  "Commit your own work, each message saying why, with no em dash and no closing keyword such as `Fixes #12`: `bin/land` refuses them. If the test count drops, give the reason on a line of its own: `Test count drop: <why>`; a test `testing` says to cut is reason enough.",
  `Run \`${FULL_CHECK}\` last: it runs every step of \`${CONTRACT}\` no receipt already covers, so running a step apart only repeats it. The steps stand in your tree as:`,
  ["```json", capped(contract, CONTRACT_CAP).trimEnd(), "```"].join("\n"),
];

const machineAtFault = (foreign: boolean | undefined) =>
  foreign === true
    ? `- \`machine\`: the machine is at fault, reviewer included; it lives in ${MACHINE_REPO}, not this tree, so change nothing here for it: file the fault as \`tickets\`, and this ticket waits on them.`
    : "- `machine`: the machine is at fault, reviewer included; fix it in a worktree off `origin/main`, commit naming this ticket, and `bin/land` it first.";

export function handedOn({ ticket, body, contract = "", capture, woken, commitlint, foreign }: Handed): string {
  return [
    `# Ticket #${ticket}`,
    capped(body, TICKET_CAP),
    ...(woken === undefined ? [] : ["## How its split ended", "Build what a piece closed unbuilt left, or rule it out:", capped(woken, LIST_CAP)]),
    ...filedIn(capture),
    ...buildIt(contract),
    ...linted(commitlint),
    "## Your answer",
    "Read its Why first; `gh` reads any run. Answer one outcome:",
    `- \`code\`: build it; the machine commits, runs \`${CHECK}\` and hands back each red until it passes, then a fresh reviewer reads your diff, fixes what it finds, and lands it with \`bin/land\`.`,
    "- `ticket`: its `## Done when` is wrong; return the ticket rewritten against its Why as `body`, Why byte-identical; it is posted on the ticket, and you build it in this run.",
    `- \`split\`: too big for one build; file \`tickets\` that build at once, each with \`done\` as ${DONE_SENTENCES}. What must wait for them stays as \`body\`, Why byte-identical, and builds once they merge.`,
    "- `close`: the ticket should not exist as written, and nothing should replace it, as for a gate you cannot make pass, since a gate is proven first.",
    "- `stuck`: you cannot build it, even rewritten; `reason` says why, and the ticket is marked `stuck`.",
    machineAtFault(foreign),
    "`steps`: with `code`, each step only the owner can take before this work runs, such as a dashboard setting or a key; each is filed as an `owner-step` note once it lands, and the ticket still closes.",
    "`reason`: one paragraph for the owner. Two rounds in a row that change nothing call them.",
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

function closedUnbuilt(ticket: string, said: string): number {
  const posted = commentOnTicket(ticket, said, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return calledOwner(ticket, "builder", `its closing reason was refused: ${quoted(refusal)}`);
  if (gh(["issue", "close", ticket, "--reason", "not planned"]).status !== 0) return calledOwner(ticket, "builder", "it ruled the ticket closed and the ticket would not close");
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
  if (numbers.length < filed.length) return { ended: calledOwner(ticket, "builder", `its split filed ${numbers.length} of ${filed.length} tickets${named === "" ? "" : `, ${named}`}: ${quoted(filed.find(({ said }) => !FILED.test(said))?.refusals[0] ?? "")}`) };
  if (answer.body === undefined) return { ended: closedUnbuilt(ticket, `${splitInto(ticket)} ${named}, which build themselves, and closed it: ${answer.reason}`) };
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
  if (answer.body === undefined || answer.body.trim() === body.trim()) return { red: "Your `ticket` answer returned the ticket unchanged: return it rewritten as `body`, or answer another outcome." };
  const written = rewriteTicket(ticket, body, answer.body, gh);
  const [refusal] = written.refusals;
  if (refusal !== undefined) return { red: `Your rewrite of the ticket was refused: ${quoted(refusal)}` };
  commentOnTicket(ticket, `The builder of #${ticket} rewrote what done looks like against its Why, and builds it as rewritten in this run: ${answer.reason}\n\n## Done when\n\n${doneWhen(answer.body)}`, gh);
  console.log(`fix: #${ticket} rewritten; it builds as rewritten`);
  return { red: `Your rewrite is posted on #${ticket}, and its body is now:\n\n${capped(answer.body, TICKET_CAP)}\n\nBuild it as rewritten and answer \`code\`; answer \`stuck\` or \`close\` if you cannot.`, body: answer.body };
}

const faultBody = (ticket: string, { why: fault, done }: Piece): string =>
  followUpBody([faultOf(`${process.env.GH_REPO ?? ""}#${ticket}`), "", `> ${fault}`], done);

const inMachineRepo = (args: string[]) => gh([...args, "--repo", MACHINE_REPO]);

function filedForMachine(ticket: string, answer: Answer): Round {
  const postings = (answer.tickets ?? []).map((piece) => ({ title: piece.title, text: faultBody(ticket, piece) }));
  const refused = postings.length === 0 ? ["a `machine` answer from a tree that is not the machine's files the machine's fault as one ticket or more in `tickets`"] : postings.flatMap((posting) => postRefusals({ kind: "ticket", ...posting }).map((refusal) => `${posting.title}: ${refusal}`));
  if (refused.length > 0) return { red: ["Your `machine` answer was refused, and nothing was filed:", ...refused.map((refusal) => `- ${refusal}`)].join("\n") };
  const filed = postings.map((posting) => post({ kind: "ticket", ...posting }, inMachineRepo).said.trim());
  if (filed.some((said) => !FILED.test(said))) return { ended: calledOwner(ticket, "builder", `it found the machine at fault and filed ${filed.filter((said) => FILED.test(said)).length} of ${filed.length} tickets in ${MACHINE_REPO}`) };
  commentOnTicket(ticket, `${waitsOnFault(ticket, filed)} ${answer.reason}`, gh);
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
  if (answer.outcome === "stuck") return { ended: calledOwner(ticket, "builder", answer.reason) };
  if (answer.outcome === "split") return split(ticket, body, answer);
  if (answer.outcome === "ticket") return rewritten(ticket, body, answer);
  if (answer.outcome === "machine" && FOREIGN) return filedForMachine(ticket, answer);
  if (answer.outcome === "machine") return landedOnMain(ticket, answer.reason, mainBefore);
  return {};
}

function spentOn(ticket: string, spend: Spend, input: string, session: string | undefined, opening: string): Spent {
  const fresh = () => spend(input === opening ? input : [opening, input].join("\n\n"));
  if (session === undefined) return fresh();
  const resumed = spend(input, session);
  if (resumed.refusal === undefined) return resumed;
  console.error(`fix: #${ticket} could not resume its builder's session ${session}, so it starts fresh: ${resumed.refusal}`);
  return fresh();
}

function judged(): Round {
  if (gitRead(["rev-list", "--count", "origin/main..HEAD"], "the commits past main could not be read, so nothing is reviewed") === "0") return { red: "You answered `code`, and this branch has no commits past main, so there is nothing to land: build the ticket, or answer `close` if main already does what it asks." };
  const red = checked();
  return red === undefined ? {} : { red: repaired(red) };
}

function owned(ticket: string) {
  const refused = admission(ticket, NOTHING_MARKED);
  if (refused !== undefined) return stoppedAt("unadmitted", `fix: ${doesNotBuild(ticket, refused)}`);
  return { carrying: { onTicket: commentsRead(ticket, `the comments on #${ticket} could not be read, ${NOTHING_MARKED}`, gh) } };
}

function ownTicket(ticket: string): number {
  const owning = opened({
    stage: "fix",
    issue: ticket,
    state: BUILDING,
    stoppedAt,
    hire: { name: "builder", model: "opus", answers: ANSWER },
    ready: () => owned(ticket),
  });
  if (typeof owning !== "object") return exitFor(owning);
  const { asked, spend } = owning;
  let body = asked.body;
  let session = savedSession(ticket);
  const { contract, unready } = readiedTree();
  if (unready !== undefined) return calledOwner(ticket, "builder", `its tree's setup failed: ${quoted(unready)}`);
  const opening = handedOn({
    ticket,
    body,
    contract,
    commitlint: commitlinted(),
    foreign: FOREIGN,
    capture: captureOf(body, process.env.SESSION_CAPTURES),
    woken: owning.carried.onTicket.filter((said) => said.startsWith(splitClosed(ticket))).at(-1),
  });
  let input = opening;
  let idle = false;
  for (;;) {
    const before = { head: head(), main: fetchedMain() };
    const spent = spentOn(ticket, spend, input, session, opening);
    session = spent.session ?? session;
    keepSession(ticket, session);
    if (spent.refusal !== undefined) return calledOwner(ticket, "builder", spent.refusal);
    const answer = spent.answer as Answer | undefined;
    const round = outcomeOf(ticket, body, answer, before.main);
    if (round.ended !== undefined) return round.ended;
    body = round.body ?? body;
    committed(builtBy(ticket), "feat");
    const changed = round.body !== undefined || head() !== before.head || fetchedMain() !== before.main;
    const { red } = round.red === undefined ? judged() : round;
    if (red === undefined) return reviewedAndLanded(ticket, body, answer?.steps ?? []);
    if (!changed && idle) return calledOwner(ticket, "builder", `two rounds in a row changed nothing: ${round.red ?? answer?.reason ?? "it gave no outcome"}`);
    idle = !changed;
    input = red;
  }
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  const ended = readOrStop("fix", () => ownTicket(ticket));
  process.exit(typeof ended === "number" ? ended : 1);
}
