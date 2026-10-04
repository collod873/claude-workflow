import { spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ownerHooks, stageArgv, type Reach, type Registration } from "./fence.ts";
import { type Asked, askedIssue, ghRead, gitRead, mark, NEEDS_HUMAN, unread, type MarkedLabel } from "./post.ts";
import type { Stop } from "./stops.ts";
import { quoted } from "./ticket-shape.ts";

const STREAM = ["--output-format", "stream-json", "--verbose"];
const TIMED_OUT = 124;
const GRACE_SECONDS = "30";
const RETRY_WAIT_SECONDS = "5";

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

function capped(argv: string[], minutes: number, deadline: number): [string, ...string[]] {
  if (!(minutes > 0)) return ["claude", ...argv];
  const left = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
  return ["timeout", `--kill-after=${GRACE_SECONDS}`, String(left), "claude", ...argv];
}

function hooksIn(read: () => string, refusal: string): Registration | string {
  try {
    return (JSON.parse(read()) as { hooks?: Registration }).hooks ?? {};
  } catch {
    return refusal;
  }
}

function liveHooks(): Registration | string {
  const link = join(homedir(), ".agents", "hooks-live");
  if (!existsSync(link)) return `no owner hooks for this stage: AGENT_HOOKS_SETTINGS is unset and ${link} is missing`;
  const root = realpathSync(link);
  const unregistered = mkdtempSync(join(tmpdir(), "agent-hooks-"));
  const emitted = spawnSync("python3", [join(root, "hookcheck.py"), "--root", root, "--settings", join(unregistered, "unregistered.json"), "--emit-settings"], { encoding: "utf8" });
  rmSync(unregistered, { recursive: true, force: true });
  const refusal = `the live release at ${root} emitted no hooks: ${quoted(String(emitted.stderr ?? "").trim().split("\n")[0] ?? "")}`;
  return emitted.status === 0 ? hooksIn(() => emitted.stdout, refusal) : refusal;
}

function registered(): Registration | string {
  const path = process.env.AGENT_HOOKS_SETTINGS;
  if (path === "") return {};
  if (path === undefined) return liveHooks();
  return hooksIn(() => readFileSync(path, "utf8"), path);
}

export interface Hire {
  name: string;
  transcript: string;
  commands?: string[];
  tools?: string[];
  answers?: object;
  gated?: boolean;
  reach?: Reach;
  writeUp?: { minutes: number; told: string };
}

export interface Spent {
  stdout: string;
  refusal?: string;
  session?: string;
  answer?: unknown;
}

export function hired(hire: Hire): ((input: string, resume?: string) => Spent) | string {
  const minutes = Number(process.env.STAGE_MINUTES);
  const deadline = Date.now() + minutes * 60_000;
  const hooks = registered();
  if (typeof hooks === "string") return hooks;
  const argv = [...stageArgv(hire.commands ?? [], ownerHooks(hooks, hire.gated), hire.tools, hire.reach), ...(hire.answers === undefined ? [] : ["--json-schema", JSON.stringify(hire.answers)])];
  rmSync(hire.transcript, { force: true });
  const readingEnds = deadline - (hire.writeUp?.minutes ?? 0) * 60_000;
  const attempt = (input: string, resume?: string, ends = readingEnds) => {
    const from = existsSync(hire.transcript) ? statSync(hire.transcript).size : 0;
    const streamed = openSync(hire.transcript, "a");
    const [command, ...args] = capped([...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], minutes, ends);
    const spent = spawnSync(command, args, { input, stdio: ["pipe", streamed, "pipe"], encoding: "utf8", maxBuffer: Infinity });
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
  if (asked.labels.has(NEEDS_HUMAN)) {
    console.log(`${said} is marked ${NEEDS_HUMAN}, ${unchanged}`);
    return undefined;
  }
  const readied = ready(asked);
  if (typeof readied !== "object") return readied;
  if (readied.unmarked !== true) mark(issue, state, ...((readied.tried ?? tried) === true ? (["--try"] as const) : []));
  const spend = hire(stage, issue, hiring);
  if (typeof spend === "string") return stoppedAt("modelRun", `${said} ended red, the owner's hooks could not be read from ${spend}`);
  return { asked, carried: readied.carrying, spend };
}
