import { spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { NO_EM_DASH, onDisk } from "./brief.ts";
import { type Asked, askedIssue, commentOnTicket, gh, ghRead, git, gitRead, heldOn, mark, OWNER, STUCK, unread, type MarkedLabel } from "./post.ts";
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
        return [JSON.parse(line)];
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

function capped(argv: string[], minutes: number, deadline: number): [string, ...string[]] {
  if (!(minutes > 0)) return [...launcher(), ...argv] as [string, ...string[]];
  const left = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
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
  session?: string;
  answer?: unknown;
}

export const treePathed = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => (env.TREE_PATH === undefined || env.TREE_PATH === "" ? env : { ...env, PATH: `${env.TREE_PATH}:${env.PATH ?? ""}` });

export const CONTRACT = join(".claude", "contract.json");

export function setupRefusal(contract: string): string | undefined {
  const { setup } = JSON.parse(contract || "{}") as { setup?: string };
  if (setup === undefined || setup.trim() === "") return undefined;
  const readied = spawnSync("bash", ["-c", setup], { env: treePathed(), encoding: "utf8", maxBuffer: Infinity });
  if (readied.status === 0) return undefined;
  return `${readied.stderr}${readied.stdout}`.trim().split("\n").at(-1) || `it ended ${readied.status}`;
}

export function hired(hire: Hire): (input: string, resume?: string) => Spent {
  const minutes = Number(process.env.STAGE_MINUTES);
  const deadline = Date.now() + minutes * 60_000;
  const argv = [...stageArgv(hire.model), ...(hire.answers === undefined ? [] : ["--json-schema", JSON.stringify(hire.answers)])];
  rmSync(hire.transcript, { force: true });
  const readingEnds = deadline - (hire.writeUp?.minutes ?? 0) * 60_000;
  const handed = `${hire.transcript.replace(/\.jsonl$/, "")}.handed.md`;
  rmSync(handed, { force: true });
  const attempt = (input: string, resume?: string, ends = readingEnds) => {
    appendFileSync(handed, `${input}\n\n`);
    const from = existsSync(hire.transcript) ? statSync(hire.transcript).size : 0;
    const streamed = openSync(hire.transcript, "a");
    const [command, ...args] = capped([...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], minutes, ends);
    const spent = spawnSync(command, args, { input, env: treePathed(), stdio: ["pipe", streamed, "pipe"], encoding: "utf8", maxBuffer: Infinity });
    closeSync(streamed);
    const stdout = readFileSync(hire.transcript).subarray(from).toString("utf8");
    return { stdout, status: spent.status, stderr: String(spent.stderr ?? "") };
  };
  const refusalFor = (got: { stdout: string; status: number | null; stderr: string }): string | undefined => {
    if (got.status === TIMED_OUT && minutes > 0) return `the ${hire.name} ran past its ${minutes} minute cap`;
    if (got.status !== 0) return `the ${hire.name} ended ${got.status}: ${quoted(String(got.stderr || got.stdout).trim().split("\n")[0] ?? "")}`;
    return undefined;
  };
  return (input, resume) => {
    let got = attempt(input, resume);
    let refusal = refusalFor(got);
    if (refusal !== undefined && got.status !== TIMED_OUT) {
      spawnSync("sleep", [RETRY_WAIT_SECONDS]);
      got = attempt(input, resume);
      refusal = refusalFor(got);
    }
    const reading = sessionOf(got.stdout);
    if (got.status === TIMED_OUT && minutes > 0 && hire.writeUp !== undefined && reading !== undefined) {
      got = attempt(hire.writeUp.told, reading, deadline);
      refusal = refusalFor(got);
    }
    return refusal === undefined ? { stdout: got.stdout, session: sessionOf(got.stdout), answer: answerIn(got.stdout) } : { stdout: got.stdout, refusal };
  };
}

export function machineLogs(): string {
  const logs = join(gitRead(["rev-parse", "--path-format=absolute", "--git-common-dir"], "the log directory could not be named by git, so no model was hired"), "machine-logs");
  mkdirSync(logs, { recursive: true });
  return logs;
}

export const hire = (stage: string, key: string, hiring: Omit<Hire, "transcript">) => hired({ ...hiring, transcript: join(machineLogs(), `${stage}-${key}.jsonl`) });

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

export function opened<Carried, Own extends string>({ stage, issue, state, tried, hire: hiring, stoppedAt, ready }: Opening<Carried, Own>): Opened<Carried> | Own | undefined {
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

export const linted = (commitlint: boolean | undefined) =>
  commitlint === true ? ["This repo runs commitlint on every commit: write each message as `type: subject`, the type `feat`, `fix` or another conventional one, the subject lower-case, as the machine's own are."] : [];

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
