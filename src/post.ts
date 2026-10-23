import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { text as read } from "node:stream/consumers";
import { dedashed } from "./em-dash.ts";
import {
  BUG_SHAPE,
  BUILD_SHAPE,
  IDEA_SHAPE,
  LOOK_INTO_SHAPE,
  OWNER_SHAPE,
  NEXT_HEADING,
  SPEC_SHAPE,
  WHY_SHAPE,
  bugRefusals,
  matchEnd,
  noteRefusals,
  rewriteRefusals,
  specRefusals,
  ticketRefusals,
} from "./ticket-shape.ts";
import { BUG, HELD, LABELS, MACHINE, NOTE, OWNER, OWNER_STEP, RESEARCH, SPEC, STUCK, TICKET, TICKET_PREFIX, WAITING, type LabelName, type MarkedLabel } from "./spelled.ts";
import { type Stop, stoppedAt } from "./stops.ts";

export interface Posting {
  kind: string;
  text: string;
  title?: string;
  sessionId?: string;
  labels?: LabelName[];
}

export type Gh = (args: string[]) => { status: number | null; stdout: string; stderr: string };

const GITHUB = join(import.meta.dirname, "..", "bin", "github");
export const ghAs =
  (env: NodeJS.ProcessEnv): Gh =>
  (args) =>
    spawnSync(GITHUB, args, { encoding: "utf8", maxBuffer: Infinity, env, stdio: ["pipe", "pipe", "pipe", 2] });
export const gh = ghAs(process.env);
export const git = (args: string[], input?: string) => spawnSync("git", args, { input, encoding: "utf8", maxBuffer: Infinity });

export class Stopped extends Error {
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
export const gitRead = (args: string[], line: string, input?: string) => readOrUnread(git(args, input), line);

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
  args: (title: string, text: string) => string[];
}

const filed = (refuses: (text: string) => string[], labels: LabelName[]): Kind => ({
  refuses,
  args: (title, text) => ["issue", "create", "--title", title, ...labels.flatMap((label) => ["--label", label]), "--body", text],
});

export const MISSING = /HTTP 404/;
export const ticketBranch = (ticket: string) => `${TICKET_PREFIX}${ticket}`;

export const FOLLOW_UP_OF = "Follow-up of #";
export const BUILDER_SPLIT = ": its builder split it";
export const SPLIT_FROM = new RegExp(`^${FOLLOW_UP_OF}(\\d+)${BUILDER_SPLIT}`, "m");
export const RESEARCH_FOUND = ": its research found this.";
const followUpFrom = (said: string) => new RegExp(`^${FOLLOW_UP_OF}(\\d+)${said.replaceAll(".", "\\.")}`);
export const RESEARCH_FROM = followUpFrom(RESEARCH_FOUND);
export const REVIEW_LET_THROUGH = ": its reviewer let this through.";
export const REVIEW_FROM = followUpFrom(REVIEW_LET_THROUGH);
const FAULT_OF = "Filed by the builder of ";
const FAULT_WAITS = ", which waits on it, as the machine's fault";
export const faultOf = (origin: string) => `${FAULT_OF}${origin}${FAULT_WAITS}.`;
export const MACHINE_REPO = `${OWNER}/claude-workflow`;
const callerRepo = /^([^/]+\/[^/]+)\//.exec(process.env.CALLED_FROM ?? "")?.[1];
export const FOREIGN = callerRepo !== undefined && callerRepo !== MACHINE_REPO;
export const ENROLLED_CALLER = "machine.yml";
export const CALLER_FILE = /\/([^/@]+)@/.exec(process.env.CALLED_FROM ?? "")?.[1] ?? ENROLLED_CALLER;
export const FAULT_FROM = new RegExp(`^${FAULT_OF}(${OWNER}/[\\w.-]+)#(\\d+)${FAULT_WAITS}\\.`, "m");
export function followUpBody(whyLines: string[], done: string[]): string {
  return ["## Why", "", ...whyLines, "", "## Done when", "", ...done.map((sentence) => `- ${sentence}`), ""].join("\n");
}

export { OWNER, RESEARCH, STUCK, WAITING, type MarkedLabel };

const KINDS: Record<string, Kind> = {
  ticket: filed(ticketRefusals, [TICKET]),
  bug: filed(bugRefusals, [TICKET, BUG]),
  note: filed(noteRefusals, [NOTE]),
  research: filed(noteRefusals, [NOTE, RESEARCH]),
  owner: filed(noteRefusals, [NOTE, OWNER_STEP]),
  spec: filed(specRefusals, [SPEC]),
};

interface DoorKind {
  files: string;
  says: string;
}

const DOOR: Record<string, DoorKind> = {
  idea: { files: "note", says: IDEA_SHAPE },
  "look-into": { files: "research", says: LOOK_INTO_SHAPE },
  build: { files: "ticket", says: BUILD_SHAPE },
  bug: { files: "bug", says: BUG_SHAPE },
  spec: { files: "spec", says: SPEC_SHAPE },
  owner: { files: "owner", says: OWNER_SHAPE },
};

const DOOR_USAGE = `file-issue: usage: file-issue ${Object.keys(DOOR).join("|")} --title <title> --body-file <path>`;

const doorHelp = (): string[] => [DOOR_USAGE, WHY_SHAPE, ...Object.entries(DOOR).map(([kind, { says }]) => `${kind}: ${says}`)];

const FIRST_HEADING = /^##[ \t].*$/m;

const BESIDE = " · ";
const FILED_AT = /github\.com\/[^/\s]+\/([^/\s]+)\/issues\/(\d+)/;

const sessionLine = (sessionId: string) => `Session: \`${sessionId}\``;
export const FILED_IN = new RegExp(`^${sessionLine("([^`]+)")}(?:${BESIDE}.*)?\\s*$`, "m");
const sessionsPage = (repo: string, number: string) => `[sessions](https://github.com/${OWNER}/transcripts/blob/main/issues/${repo.toLowerCase()}-${number}.md)`;

function stampedWithSession(text: string, sessionId: string | undefined, page?: string): string {
  const found = FIRST_HEADING.exec(text);
  if (found === null) return text;
  const start = matchEnd(found);
  const next = NEXT_HEADING.exec(text.slice(start));
  const end = next === null ? text.length : start + next.index;
  const section = text.slice(start, end).replace(/\s+$/, "");
  const session = sessionId ? sessionLine(sessionId) : undefined;
  const stamp = [session, page].filter((part) => part !== undefined).join(BESIDE);
  const carried = page ?? session;
  if (stamp === "" || (carried !== undefined && section.includes(carried))) return text;
  const stamped = session !== undefined && section.includes(session) ? section.replace(session, stamp) : `${section}\n\n${stamp}`;
  return `${text.slice(0, start)}${stamped}\n\n${text.slice(end)}`;
}

function linkedToSessions(posting: Posting, text: string, url: string, gh: Gh): { refusals: string[]; said: string } {
  const [, repo, number] = FILED_AT.exec(url) ?? [];
  if (repo === undefined || number === undefined) return { refusals: [], said: url };
  const linked = stampedWithSession(text, posting.sessionId, sessionsPage(repo, number));
  if (linked === text) return { refusals: [], said: url };
  for (const refusal of written(gh, ["issue", "edit", number, "--body", linked]).refusals) console.error(`${url} was filed, but ${refusal}, so it carries no sessions link`);
  return { refusals: [], said: url };
}

function written(gh: Gh, args: string[]): { refusals: string[]; said: string } {
  const { status, stdout, stderr } = gh(args);
  if (status !== 0) return { refusals: [`gh ${args[0]} ${args[1]} failed: ${(stderr || stdout).trim().split("\n")[0]}`], said: "" };
  return { refusals: [], said: stdout.trim() };
}

export const commentOnTicket = (ticket: string, text: string, gh: Gh) => written(gh, ["issue", "comment", ticket, "--body", dedashed(text)]);

const COMMENT_ID = /#issuecomment-(\d+)$/;
export function commentEdited(url: string, text: string, gh: Gh): { refusals: string[]; said: string } {
  const id = COMMENT_ID.exec(url)?.[1];
  return id === undefined ? { refusals: [`${url} names no comment`], said: "" } : written(gh, ["api", "-X", "PATCH", `repos/{owner}/{repo}/issues/comments/${id}`, "-f", `body=${dedashed(text)}`]);
}

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

export function opened(path: string, line: string, gh: Gh, repo = "{owner}/{repo}"): Opened | "missing" {
  const got = gh(["--missing-answers", "api", `repos/${repo}/issues/${path}`]);
  if (got.status !== 0) return MISSING.test(got.stderr) ? "missing" : unread(line);
  try {
    return JSON.parse(got.stdout) as Opened;
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

export function rewriteTicket(ticket: string, read: string, rewrite: string, gh: Gh): { refusals: string[]; said: string } {
  const refused = rewriteRefusals(read, dedashed(rewrite));
  return refused.length > 0 ? { refusals: refused, said: "" } : written(gh, ["issue", "edit", ticket, "--body", dedashed(rewrite)]);
}

function prepared(posting: Posting): { refusals: string[]; args: string[]; text: string } {
  const { kind, sessionId, title } = posting;
  const shape = KINDS[kind];
  if (shape === undefined) return { refusals: [`${kind} is not a kind src/post.ts writes: ${Object.keys(KINDS).join(", ")}`], args: [], text: "" };
  if (title === undefined) return { refusals: [`a ${kind} carries no title`], args: [], text: "" };
  const text = dedashed(stampedWithSession(posting.text, sessionId));
  const refused = shape.refuses(text);
  const labelled = (posting.labels ?? []).flatMap((label) => ["--label", label]);
  return refused.length > 0 ? { refusals: refused, args: [], text } : { refusals: [], args: [...shape.args(dedashed(title), text), ...labelled], text };
}

export const postRefusals = (posting: Posting): string[] => prepared(posting).refusals;

const LABEL_MISSING = /could not add label: '[^']+' not found/;

function labelsCreated(args: string[], gh: Gh): void {
  const named = new Set(args.filter((_, at) => args[at - 1] === "--label"));
  for (const { name, colour, description } of LABELS.filter(({ name }) => named.has(name))) gh(["label", "create", name, "--color", colour, "--description", description]);
}

function createdLabelled(args: string[], gh: Gh): { refusals: string[]; said: string } {
  const created = written(gh, args);
  if (!created.refusals.some((refusal) => LABEL_MISSING.test(refusal))) return created;
  labelsCreated(args, gh);
  return written(gh, args);
}

export function post(posting: Posting, gh: Gh): { refusals: string[]; said: string } {
  const { refusals, args, text } = prepared(posting);
  if (refusals.length > 0) return { refusals, said: "" };
  const created = createdLabelled(args, gh);
  return created.refusals.length > 0 ? created : linkedToSessions(posting, text, created.said, gh);
}

if (import.meta.main) {
  const [kind, title, sessionId] = process.argv.slice(2);
  if (kind === undefined) throw new Error("no kind of posting in the arguments to post");
  if (kind === "--help" || kind === "--usage") {
    console.log((kind === "--help" ? doorHelp() : [DOOR_USAGE]).join("\n"));
    process.exit(0);
  }
  const door = DOOR[kind];
  if (door === undefined) throw new Error(`${kind} is not a kind file-issue files`);
  const { refusals, said } = post({ kind: door.files, text: await read(process.stdin), title, sessionId }, gh);
  for (const refusal of refusals) console.error(refusal);
  if (said !== "") console.log(said);
  process.exit(refusals.length > 0 ? 1 : 0);
}
