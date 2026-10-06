import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { text as read } from "node:stream/consumers";
import { emDashLines } from "./em-dash.ts";
import { NEXT_HEADING, NOTE_SHAPE, SPEC_SHAPE, TICKET_SHAPE, matchEnd, noteRefusals, rewriteRefusals, specRefusals, ticketRefusals } from "./ticket-shape.ts";
import { HELD, MACHINE, NOTE, OWNER, RESEARCH, RESOLVING, SPEC, STUCK, TICKET, TICKET_PREFIX, WAITING, type LabelName, type MarkedLabel } from "./spelled.ts";
import { type Stop, stoppedAt } from "./stops.ts";

export interface Posting {
  kind: string;
  text: string;
  title?: string;
  pr?: string;
  sessionId?: string;
  labels?: LabelName[];
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

export const ghAs =
  (env: NodeJS.ProcessEnv): Gh =>
  (args) =>
    spawnSync("gh", args, { encoding: "utf8", maxBuffer: Infinity, env });
export const gh = ghAs(process.env);
export const git = (args: string[], input?: string) => spawnSync("git", args, { input, encoding: "utf8", maxBuffer: Infinity });

class Stopped extends Error {
  readonly stop: Stop;

  constructor(stop: Stop, line: string) {
    super(line);
    this.stop = stop;
  }
}

export const unread = (line: string): never => {
  throw new Stopped("unread", line);
};

const readOrUnread = (got: ReturnType<Gh>, line: string): string => (got.status === 0 ? got.stdout.trim() : unread(line));

export const ghRead = (args: string[], line: string) => readOrUnread(gh(args), line);
export function ghWhole(args: string[], line: string): string {
  const got = gh(args);
  return got.status === 0 ? got.stdout : unread(line);
}
export const gitRead = (args: string[], line: string, input?: string) => readOrUnread(git(args, input), line);

export function answered(got: ReturnType<Gh>, line: string): boolean {
  if (got.status !== 0 && got.status !== 1) unread(line);
  return got.status === 0;
}

export function readOrStop<Ended>(stage: string, run: () => Ended): Ended | Stop {
  try {
    return run();
  } catch (error) {
    if (error instanceof Stopped) return stoppedAt(error.stop, `${stage}: ${error.message}`);
    throw error;
  }
}

export const machineBin = (command: string) => join(process.env.MACHINE_BIN ?? join(import.meta.dirname, "..", "bin"), command);

export const markWith = (env: NodeJS.ProcessEnv) => (issue: string, label: MarkedLabel | "--closed", ...count: ("--try" | "--untry")[]) => {
  const marked = spawnSync(machineBin("mark"), [issue, label, ...count], { stdio: ["ignore", "ignore", "inherit"], env });
  if (marked.status !== 0) throw new Stopped("unwritten", `bin/mark #${issue} ${label} ended non-zero, so nothing after it is posted, closed, marked or hired`);
};
export const mark = markWith(process.env);
export interface Held {
  has(label: LabelName): boolean;
}

export const heldOn = (labels: Held) => HELD.find((label) => labels.has(label));

export const heldOf = (labels: { name?: string }[] | undefined): Held => new Set((labels ?? []).map(({ name }) => name));

export const NOTHING_MARKED = "so nothing is marked";

export function labelsHeld(issue: string, gh: Gh): Held {
  const got = gh(["issue", "view", issue, "--json", "labels", "--jq", ".labels[].name"]);
  return got.status === 0 ? new Set(got.stdout.split("\n").filter((label) => label !== "")) : unread(`the labels of #${issue} could not be read, ${NOTHING_MARKED}`);
}

interface Kind {
  refuses: (text: string) => string[];
  on: "title" | "pr";
  args: (on: string, text: string) => string[];
  shape?: string;
}

const filed = (refuses: (text: string) => string[], labels: LabelName[], shape: string): Kind => ({
  refuses,
  shape,
  on: "title",
  args: (title, text) => ["issue", "create", "--title", title, ...labels.flatMap((label) => ["--label", label]), "--body", text],
});

const judgementRefusals = (text: string): string[] => emDashLines(text).map((line) => `line ${line} carries an em dash`);

export const MISSING = /HTTP 404/;
export const ticketBranch = (ticket: string) => `${TICKET_PREFIX}${ticket}`;
export const TICKET_BRANCH = new RegExp(`^${ticketBranch("(\\d+)")}$`);

export const FOLLOW_UP_OF = "Follow-up of #";
export const REVIEW_FOUND = ": its review found";
export const BUILDER_SPLIT = ": its builder split it";
export const REVIEWED_FROM = new RegExp(`^${FOLLOW_UP_OF}(\\d+)${REVIEW_FOUND}`, "m");
export const SPLIT_FROM = new RegExp(`^${FOLLOW_UP_OF}(\\d+)${BUILDER_SPLIT}`, "m");
export function followUpBody(whyLines: string[], done: string[]): string {
  return ["## Why", "", ...whyLines, "", "## Done when", "", ...done.map((sentence) => `- ${sentence}`), ""].join("\n");
}

export const foundDrift = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.`;
export const foundOverlap = (ticket: string) => `The reviewer read this PR for #${ticket} against what merged to main since its last judgement and found overlap.`;
export const drifted = (ticket: string, comment: string) => comment.startsWith(foundDrift(ticket)) || comment.startsWith(foundOverlap(ticket));
export const earlierDrift = (ticket: string, comments: string[]) => comments.filter((comment) => drifted(ticket, comment)).join("\n\n");
export const repairOf = (ticket: string) => `Repair #${ticket} as its builder`;
export { OWNER, RESEARCH, RESOLVING, STUCK, WAITING, type MarkedLabel };

const KINDS: Record<string, Kind> = {
  ticket: filed(ticketRefusals, [TICKET], TICKET_SHAPE),
  note: filed(noteRefusals, [NOTE], NOTE_SHAPE),
  research: filed(noteRefusals, [NOTE, RESEARCH], NOTE_SHAPE),
  spec: filed(specRefusals, [SPEC], SPEC_SHAPE),
  judgement: { refuses: judgementRefusals, on: "pr", args: (pr, text) => ["pr", "comment", pr, "--body", text] },
};

export const POSTING_KINDS = Object.keys(KINDS);

const FIRST_HEADING = /^##[ \t].*$/m;

export const sessionLine = (sessionId: string) => `Session: \`${sessionId}\``;

function stampedWithSession(text: string, sessionId: string): string {
  const line = sessionLine(sessionId);
  const found = FIRST_HEADING.exec(text);
  if (found === null) return text;
  const start = matchEnd(found);
  const next = NEXT_HEADING.exec(text.slice(start));
  const end = next === null ? text.length : start + next.index;
  const section = text.slice(start, end).replace(/\s+$/, "");
  if (section.includes(line)) return text;
  return `${text.slice(0, start)}${section}\n\n${line}\n\n${text.slice(end)}`;
}

function written(gh: Gh, args: string[]): { refusals: string[]; said: string } {
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

export const commentOnTicket = (ticket: string, text: string, gh: Gh) => written(gh, ["issue", "comment", ticket, "--body", text]);

const TRUSTED = new Set([`User ${OWNER}`, `Bot ${MACHINE}`]);

const trusted = (said: unknown): said is { author: string; body: string } =>
  typeof said === "object" &&
  said !== null &&
  "author" in said &&
  typeof said.author === "string" &&
  "type" in said &&
  "body" in said &&
  typeof said.body === "string" &&
  TRUSTED.has(`${String(said.type)} ${said.author}`);

export function authoredOn(number: string, line: string, gh: Gh): { author: string; body: string }[] {
  const got = gh(["api", "--paginate", `repos/{owner}/{repo}/issues/${number}/comments`, "--jq", ".[] | {author: .user.login, type: .user.type, body}"]);
  if (got.status !== 0) return unread(line);
  try {
    return got.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line): unknown => JSON.parse(line))
      .filter(trusted)
      .map(({ author, body }) => ({ author, body }));
  } catch {
    return unread(line);
  }
}

export const commentsRead = (number: string, line: string, gh: Gh): string[] => authoredOn(number, line, gh).map(({ body }) => body);

export interface Opened {
  number?: number;
  state?: string;
  user?: { login?: string };
  labels?: { name?: string }[];
  body?: string | null;
}

export type Admission = string | undefined;

export function opened(path: string, line: string, gh: Gh): Opened | "missing" {
  const got = gh(["api", `repos/{owner}/{repo}/issues/${path}`]);
  if (got.status !== 0) return MISSING.test(got.stderr) ? "missing" : unread(line);
  try {
    return JSON.parse(got.stdout) as Opened;
  } catch {
    return unread(line);
  }
}

export function underOwnerSpec(ticket: string, line: string, gh: Gh): Admission {
  const spec = opened(`${ticket}/parent`, line, gh);
  if (spec === "missing") return "the App opened it under no spec";
  if (!heldOf(spec.labels).has(SPEC)) return "the App opened it under an issue not labelled `spec`";
  if (spec.user?.login !== OWNER) return "the App opened it under a spec the owner did not open";
  if (spec.state !== "open") return "the App opened it under a spec that is not open";
  return undefined;
}

export const NO_PR = /^no pull requests found/m;

export interface TicketPr {
  number?: number;
  state?: string;
  files?: { path?: string }[];
}

export function prOfTicket(ticket: string, fields: (keyof TicketPr)[], gh: Gh): TicketPr | "none" {
  const line = `the PR of #${ticket} could not be read`;
  const got = gh(["pr", "view", ticketBranch(ticket), "--json", fields.join(",")]);
  if (got.status !== 0) return NO_PR.test(got.stderr) ? "none" : unread(line);
  try {
    return JSON.parse(got.stdout) as TicketPr;
  } catch {
    return unread(line);
  }
}

export interface Asked {
  title: string;
  body: string;
  labels: Held;
}

export function askedIssue(stdout: string): Asked | undefined {
  try {
    const { title, body, labels } = JSON.parse(stdout) as { title?: unknown; body?: unknown; labels?: unknown };
    return typeof title === "string" && typeof body === "string" && Array.isArray(labels) ? { title, body, labels: heldOf(labels as { name?: string }[]) } : undefined;
  } catch {
    return undefined;
  }
}

export const commentOnPr = (pr: string, text: string, gh: Gh) => written(gh, ["pr", "comment", pr, "--body", text]);

export function rewriteTicket(ticket: string, read: string, rewrite: string, gh: Gh): { refusals: string[]; said: string } {
  const refused = rewriteRefusals(read, rewrite);
  return refused.length > 0 ? { refusals: refused, said: "" } : written(gh, ["issue", "edit", ticket, "--body", rewrite]);
}

function prepared(posting: Posting): { refusals: string[]; args: string[] } {
  const { kind, sessionId } = posting;
  const shape = KINDS[kind];
  if (shape === undefined) return { refusals: [`${kind} is not a kind src/post.ts writes: ${Object.keys(KINDS).join(", ")}`], args: [] };
  const on = posting[shape.on];
  if (on === undefined) return { refusals: [`a ${kind} carries no ${shape.on}`], args: [] };
  const text = shape.on === "title" && sessionId ? stampedWithSession(posting.text, sessionId) : posting.text;
  const refused = shape.refuses(text);
  const labelled = (posting.labels ?? []).flatMap((label) => ["--label", label]);
  return refused.length > 0 ? { refusals: refused, args: [] } : { refusals: [], args: [...shape.args(on, text), ...labelled] };
}

function shapesFiled(): string[] {
  const kindsOf = new Map<string, string[]>();
  for (const [kind, { shape }] of Object.entries(KINDS)) if (shape !== undefined) kindsOf.set(shape, [...(kindsOf.get(shape) ?? []), kind]);
  return [...kindsOf].map(([shape, kinds]) => `${kinds.join(", ")}: ${shape}`);
}

export const postRefusals = (posting: Posting): string[] => prepared(posting).refusals;

export function post(posting: Posting, gh: Gh): { refusals: string[]; said: string } {
  const { refusals, args } = prepared(posting);
  return refusals.length > 0 ? { refusals, said: "" } : written(gh, args);
}

if (import.meta.main) {
  const [kind, title, sessionId] = process.argv.slice(2);
  if (kind === undefined) throw new Error("no kind of posting in the arguments to post");
  if (kind === "--help") {
    console.log(shapesFiled().join("\n"));
    process.exit(0);
  }
  const { refusals, said } = post({ kind, text: await read(process.stdin), title, sessionId }, gh);
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
