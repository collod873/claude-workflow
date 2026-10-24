import { execFile, spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { NO_EM_DASH, onDisk } from "./brief.ts";
import { type Asked, askedIssue, commentOnTicket, followUpBody, gh, ghRead, git, gitRead, heldOn, mark, OWNER, post, STUCK, unread, type MarkedLabel } from "./post.ts";
import type { Stop } from "./stops.ts";
import { quoted } from "./ticket-shape.ts";

const STREAM = ["--output-format", "stream-json", "--verbose"];
const TIMED_OUT = 124;
const GRACE_SECONDS = "30";
const RETRY_WAIT_SECONDS = "5";

const FOREGROUND_ONLY = {
  env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", BASH_DEFAULT_TIMEOUT_MS: "600000", BASH_MAX_TIMEOUT_MS: "1200000" },
  permissions: { deny: ["Agent", "Monitor", "Workflow", "ScheduleWakeup", "CronCreate", "RemoteTrigger"] },
};

const stageArgv = (model: string) => ["--print", "--model", model, "--setting-sources", "user,project", "--settings", JSON.stringify({ disableAllHooks: false, ...FOREGROUND_ONLY }), "--permission-mode", "bypassPermissions"];

function events(stdout: string): unknown[] {
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

function answerIn(stdout: string): unknown {
  let answer: unknown;
  for (const event of events(stdout)) {
    const { type, structured_output } = (event ?? {}) as { type?: unknown; structured_output?: unknown };
    if (type === "result" && structured_output !== undefined) answer = structured_output;
  }
  return answer;
}

function sessionOf(stdout: string): string | undefined {
  let session: string | undefined;
  for (const event of events(stdout)) {
    const id = (event as { session_id?: unknown })?.session_id;
    if (typeof id === "string") session = id;
  }
  return session;
}

function launcher(): string[] {
  const found = (process.env.PATH ?? "").split(":").map((dir) => join(dir, "claude")).find((path) => existsSync(path));
  if (found === undefined) return ["claude"];
  const head = Buffer.alloc(128);
  const opened = openSync(found, "r");
  const read = readSync(opened, head, 0, head.length, 0);
  closeSync(opened);
  return /^#!.*\bnode\b/.test(head.subarray(0, read).toString("utf8").split("\n")[0] ?? "") ? [process.execPath, found] : ["claude"];
}

function capped(argv: string[], minutes: number, leftMs: number): [string, ...string[]] {
  if (!(minutes > 0)) return [...launcher(), ...argv] as [string, ...string[]];
  const left = Math.max(1, Math.ceil(leftMs / 1000));
  return ["timeout", `--kill-after=${GRACE_SECONDS}`, String(left), ...launcher(), ...argv];
}

export interface Hire {
  name: string;
  transcript: string;
  model: string;
  answers?: object;
  writeUp?: { minutes: number; told: string };
}

export interface Spent {
  stdout: string;
  refusal?: string;
  timedOut?: boolean;
  session?: string | undefined;
  answer?: unknown;
}

export const treePathed = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => (env.TREE_PATH === undefined || env.TREE_PATH === "" ? env : { ...env, PATH: `${env.TREE_PATH}:${env.PATH ?? ""}` });

export const CONTRACT = join(".claude", "contract.json");

const setupOf = (contract: string) => {
  const { setup } = JSON.parse(contract || "{}") as { setup?: string };
  return setup === undefined || setup.trim() === "" ? undefined : setup;
};

const unready = ({ status, stdout, stderr }: { status: number | null; stdout: string; stderr: string }) => (status === 0 ? undefined : `${stderr}${stdout}`.trim().split("\n").at(-1) || `it ended ${status}`);

export function setupRefusal(contract: string): string | undefined {
  const setup = setupOf(contract);
  return setup === undefined ? undefined : unready(spawnSync("bash", ["-c", setup], { env: treePathed(), encoding: "utf8", maxBuffer: Infinity }));
}

export function setupRefusedIn(tree: string, contract: string): Promise<string | undefined> {
  const setup = setupOf(contract);
  if (setup === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("bash", ["-c", setup], { cwd: tree, env: treePathed(), encoding: "utf8", maxBuffer: Infinity }, (error, stdout, stderr) => {
      resolve(unready({ status: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout, stderr }));
    });
  });
}

interface Launch {
  argv: [string, ...string[]];
  input: string;
  streamed: number;
  waitFirst: boolean;
}

interface Exited {
  status: number | null;
  stderr: string;
}

type Spending = (input: string, resume?: string) => Generator<Launch, Spent, Exited>;

function spending(hire: Hire): Spending {
  const minutes = Number(process.env.STAGE_MINUTES);
  const budget = minutes * 60_000;
  let used = 0;
  const argv = [...stageArgv(hire.model), ...(hire.answers === undefined ? [] : ["--json-schema", JSON.stringify(hire.answers)])];
  rmSync(hire.transcript, { force: true });
  const writeUpKept = (hire.writeUp?.minutes ?? 0) * 60_000;
  const handed = `${hire.transcript.replace(/\.jsonl$/, "")}.handed.md`;
  rmSync(handed, { force: true });
  function* attempt(input: string, resume?: string, kept = writeUpKept, waitFirst = false): Generator<Launch, Exited & { stdout: string }, Exited> {
    appendFileSync(handed, `${input}\n\n`);
    const from = existsSync(hire.transcript) ? statSync(hire.transcript).size : 0;
    const streamed = openSync(hire.transcript, "a");
    const started = Date.now();
    const exited = yield { argv: capped([...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], minutes, budget - used - kept), input, streamed, waitFirst };
    used += Date.now() - started;
    closeSync(streamed);
    return { ...exited, stdout: readFileSync(hire.transcript).subarray(from).toString("utf8") };
  }
  const refusalFor = (got: Exited & { stdout: string }): string | undefined => {
    if (got.status === TIMED_OUT && minutes > 0) return `the ${hire.name} ran past its ${minutes} minute cap`;
    if (got.status !== 0) return `the ${hire.name} ended ${got.status}: ${quoted(String(got.stderr || got.stdout).trim().split("\n")[0] ?? "")}`;
    return undefined;
  };
  return function* (input, resume) {
    let got = yield* attempt(input, resume);
    let refusal = refusalFor(got);
    if (refusal !== undefined && got.status !== TIMED_OUT) {
      got = yield* attempt(input, resume, writeUpKept, true);
      refusal = refusalFor(got);
    }
    const reading = sessionOf(got.stdout);
    if (got.status === TIMED_OUT && minutes > 0 && hire.writeUp !== undefined && reading !== undefined) {
      got = yield* attempt(hire.writeUp.told, reading, 0);
      refusal = refusalFor(got);
    }
    if (refusal === undefined) return { stdout: got.stdout, session: sessionOf(got.stdout), answer: answerIn(got.stdout) };
    return got.status === TIMED_OUT && minutes > 0 ? { stdout: got.stdout, refusal, timedOut: true, session: sessionOf(got.stdout) ?? reading } : { stdout: got.stdout, refusal };
  };
}

function launchedHere({ argv: [command, ...args], input, streamed, waitFirst }: Launch): Exited {
  if (waitFirst) spawnSync("sleep", [RETRY_WAIT_SECONDS]);
  const spent = spawnSync(command, args, { input, env: treePathed(), stdio: ["pipe", streamed, "pipe"], encoding: "utf8", maxBuffer: Infinity });
  return { status: spent.status, stderr: String(spent.stderr ?? "") };
}

const launchedIn =
  (tree: string) =>
  async ({ argv: [command, ...args], input, streamed, waitFirst }: Launch): Promise<Exited> => {
    if (waitFirst) await setTimeout(Number(RETRY_WAIT_SECONDS) * 1000);
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd: tree, env: treePathed(), stdio: ["pipe", streamed, "pipe"] });
      let stderr = "";
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
      child.stdin?.on("error", () => undefined);
      child.on("error", (error) => resolve({ status: null, stderr: error.message }));
      child.on("close", (status) => resolve({ status, stderr }));
      child.stdin?.end(input);
    });
  };

export function hired(hire: Hire): (input: string, resume?: string) => Spent {
  const spend = spending(hire);
  return (input, resume) => {
    const steps = spend(input, resume);
    for (let step = steps.next(); ; step = steps.next(launchedHere(step.value))) if (step.done === true) return step.value;
  };
}

export function machineLogs(): string {
  const logs = join(gitRead(["rev-parse", "--path-format=absolute", "--git-common-dir"], "the log directory could not be named by git, so no model was hired"), "machine-logs");
  mkdirSync(logs, { recursive: true });
  return logs;
}

const transcriptOf = (stage: string, key: string) => join(machineLogs(), `${stage}-${key}.jsonl`);

export const hire = (stage: string, key: string, hiring: Omit<Hire, "transcript">) => hired({ ...hiring, transcript: transcriptOf(stage, key) });

export function hireIn(tree: string, stage: string, key: string, hiring: Omit<Hire, "transcript">): (input: string, resume?: string) => Promise<Spent> {
  const spend = spending({ ...hiring, transcript: transcriptOf(stage, key) });
  const launched = launchedIn(tree);
  return async (input, resume) => {
    const steps = spend(input, resume);
    for (let step = steps.next(); ; step = steps.next(await launched(step.value))) if (step.done === true) return step.value;
  };
}

interface Opening<Carried, Own extends string> {
  stage: string;
  issue: string;
  state: MarkedLabel;
  tried?: boolean;
  hire: Omit<Hire, "transcript">;
  stoppedAt: (stop: Stop, line: string) => Own;
  ready: (asked: Asked) => { carrying: Carried; tried?: boolean; unmarked?: boolean } | Own | undefined;
}

export interface Opened<Carried> {
  asked: Asked;
  carried: Carried;
  spend: (input: string, resume?: string) => Spent;
}

export function opened<Carried, Own extends string>({ stage, issue, state, tried, hire: hiring, ready }: Opening<Carried, Own>): Opened<Carried> | Own | undefined {
  const said = `${stage}: #${issue}`;
  const unchanged = "so no label changed and no model was hired";
  const asked = askedIssue(ghRead(["issue", "view", issue, "--json", "title,body,labels"], `#${issue} could not be read, ${unchanged}`)) ?? unread(`#${issue} could not be read, ${unchanged}`);
  const held = heldOn(asked.labels);
  if (held !== undefined) {
    console.log(`${said} is marked ${held}, ${unchanged}`);
    return undefined;
  }
  const readied = ready(asked);
  if (typeof readied !== "object") return readied;
  const spend = hire(stage, issue, hiring);
  if (readied.unmarked !== true) mark(issue, state, ...((readied.tried ?? tried) === true ? (["--try"] as const) : []));
  return { asked, carried: readied.carrying, spend };
}

export const OWNER_STEPS = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string", pattern: NO_EM_DASH },
      why: { type: "string", pattern: NO_EM_DASH },
    },
    required: ["title", "why"],
    additionalProperties: false,
  },
};

export interface OwnerStep {
  title: string;
  why: string;
}

export const MOST_FIXES = 3;

export const FOLLOW_UPS = {
  fixes: {
    type: "array",
    maxItems: MOST_FIXES,
    items: {
      type: "object",
      properties: {
        fault: { type: "string", pattern: NO_EM_DASH },
        title: { type: "string", pattern: NO_EM_DASH },
        done: { type: "array", minItems: 1, items: { type: "string", pattern: NO_EM_DASH } },
      },
      required: ["fault", "title", "done"],
      additionalProperties: false,
    },
  },
  asks: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
};

export interface Fix {
  fault: string;
  title: string;
  done: string[];
}

export const fixesFiled = (found: string, fixes: Fix[]): { named: string; refusals: string[]; said: string }[] =>
  fixes.slice(0, MOST_FIXES).map(({ fault, title, done }) => ({ named: title, ...post({ kind: "ticket", title, text: followUpBody([found, "", `> ${fault}`], done) }, gh) }));

export function followedUp(found: string, fixes: Fix[], asks: string[], call: { title: string; by: string }): ReturnType<typeof fixesFiled> {
  const tickets = fixesFiled(found, fixes);
  if (asks.length === 0) return tickets;
  const text = ["## Why", "", `@${OWNER} ${call.by} leaves these to you:`, "", ...asks.map((ask) => `- ${ask}`), ""].join("\n");
  return [...tickets, { named: call.title, ...post({ kind: "note", title: call.title, text }, gh) }];
}

const COMMITLINT = /^(\.commitlintrc(\.\w+)?|commitlint\.config\.[cm]?[jt]s)$/;
const COMMITLINT_KEY = /"commitlint"\s*:/;
export const commitlinted = () => readdirSync(process.cwd()).some((name) => COMMITLINT.test(name)) || COMMITLINT_KEY.test(onDisk(join(process.cwd(), "package.json")) ?? "");
const conventional = (type: string, message: string) => `${type}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;

export const head = () => gitRead(["rev-parse", "HEAD"], "the head of this branch could not be read");

export function calledOwner(ticket: string, by: "builder" | "reviewer", why: string): number {
  mark(ticket, STUCK);
  commentOnTicket(ticket, `@${OWNER} the ${by} of #${ticket} stopped and needs you: ${why}`, gh);
  console.error(`fix: #${ticket} needs the owner, ${why}`);
  return 1;
}

export function committed(message: string, type: "feat" | "fix"): void {
  if (gitRead(["status", "--porcelain"], "what was changed could not be read") === "") return;
  git(["add", "--all"]);
  git(["commit", "--quiet", "-m", commitlinted() ? conventional(type, message) : message]);
}
