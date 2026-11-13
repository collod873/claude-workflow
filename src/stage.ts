import { execFile, spawn } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { onDisk } from "./brief.ts";
import { type Asked, askedOn, git, gitRead, stoodDown, mark, type MarkedLabel } from "./post.ts";
import { quoted } from "./ticket-shape.ts";

const STREAM = ["--output-format", "stream-json", "--verbose"];
const TIMED_OUT = 124;
const GRACE_SECONDS = "30";
const RETRY_WAIT_MS = 5_000;
const ACCOUNT_SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_2"] as const;
const OUT_OF_USAGE = /usage limit reached|hit your (\w+ )?limit|limit reached|out of extra usage/i;

const accounts = () => [...new Set(ACCOUNT_SECRETS.map((name) => process.env[name] ?? "").filter((token) => token !== ""))];
let account = 0;
const accountEnv = (on: number): Record<string, string> => {
  const token = accounts()[on];
  return token === undefined ? {} : { CLAUDE_CODE_OAUTH_TOKEN: token };
};
const outOfUsage = ({ status, stderr, stdout }: Exited & { stdout: string }) => status !== 0 && OUT_OF_USAGE.test(`${stderr}\n${resultIn(stdout)}`);

const FOREGROUND_ONLY = {
  env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", BASH_DEFAULT_TIMEOUT_MS: "600000", BASH_MAX_TIMEOUT_MS: "1200000" },
  permissions: { deny: ["Agent", "Monitor", "Workflow", "ScheduleWakeup", "CronCreate", "RemoteTrigger"] },
};

const stageArgv = ({ model, effort }: Pick<Hire, "model" | "effort">) => ["--print", "--model", model, "--effort", effort, "--setting-sources", "user,project", "--settings", JSON.stringify({ disableAllHooks: false, ...FOREGROUND_ONLY }), "--permission-mode", "bypassPermissions"];

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

function resultIn(stdout: string): string {
  let said = "";
  for (const event of events(stdout)) {
    const { type, result } = (event ?? {}) as { type?: unknown; result?: unknown };
    if (type === "result" && typeof result === "string") said = result;
  }
  return said;
}

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

function reasonGiven({ stderr, stdout }: Exited & { stdout: string }): string {
  const reason = firstLine(stderr) || firstLine(resultIn(stdout));
  return reason === "" ? " and gave no reason" : `: ${quoted(reason)}`;
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

type Effort = "low" | "medium" | "high";

export const WRITE_UP_MINUTES = 5;

export interface Hire {
  name: string;
  transcript: string;
  model: "opus" | "sonnet" | "haiku";
  effort: Effort;
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

export function treeNeeds(contract: string): { database: boolean; keys: string[] } {
  const { needs = [], steps = {} } = JSON.parse(contract || "{}") as { needs?: string[]; steps?: Record<string, { needs?: string[] }> };
  const named = [...needs, ...Object.values(steps).flatMap((step) => step.needs ?? [])];
  return { database: named.includes("DATABASE_URL"), keys: needs.filter((name) => name !== "DATABASE_URL") };
}

export const unsetKeys = () => (process.env.UNSET_KEYS ?? "").split(",").map((key) => key.trim()).filter(Boolean);

const setupOf = (contract: string) => {
  const { setup } = JSON.parse(contract || "{}") as { setup?: string };
  return setup === undefined || setup.trim() === "" ? undefined : setup;
};

const unready = ({ status, stdout, stderr }: { status: number | null; stdout: string; stderr: string }) => (status === 0 ? undefined : `${stderr}${stdout}`.trim().split("\n").at(-1) || `it ended ${status}`);

export function setupRefusedIn(tree: string, contract: string, env: Record<string, string> = {}): Promise<string | undefined> {
  const setup = setupOf(contract);
  if (setup === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("bash", ["-c", setup], { cwd: tree, env: treePathed({ ...process.env, ...env }), encoding: "utf8", maxBuffer: Infinity }, (error, stdout, stderr) => {
      resolve(unready({ status: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout, stderr }));
    });
  });
}

interface Exited {
  status: number | null;
  stderr: string;
}

type Got = Exited & { stdout: string };

function launched([command, ...args]: [string, ...string[]], input: string, streamed: number, env: NodeJS.ProcessEnv, tree: string): Promise<Exited> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: tree, env, stdio: ["pipe", streamed, "pipe"] });
    let stderr = "";
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.stdin?.on("error", () => undefined);
    child.on("error", (error) => resolve({ status: null, stderr: error.message }));
    child.on("close", (status) => resolve({ status, stderr }));
    child.stdin?.end(input);
  });
}

export function hired(hire: Hire, { tree = process.cwd(), env = {} }: { tree?: string; env?: Record<string, string> } = {}): (input: string, resume?: string) => Promise<Spent> {
  const minutes = Number(process.env.STAGE_MINUTES);
  const budget = minutes * 60_000;
  let used = 0;
  const argv = [...stageArgv(hire), ...(hire.answers === undefined ? [] : ["--json-schema", JSON.stringify(hire.answers)])];
  rmSync(hire.transcript, { force: true });
  const writeUpKept = (hire.writeUp?.minutes ?? 0) * 60_000;
  const handed = `${hire.transcript.replace(/\.jsonl$/, "")}.handed.md`;
  rmSync(handed, { force: true });
  async function launch(input: string, resume: string | undefined, kept: number, waitFirst: boolean, on: number): Promise<Got> {
    appendFileSync(handed, `${input}\n\n`);
    const from = existsSync(hire.transcript) ? statSync(hire.transcript).size : 0;
    const streamed = openSync(hire.transcript, "a");
    const started = Date.now();
    if (waitFirst) await setTimeout(RETRY_WAIT_MS);
    const exited = await launched(capped([...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], minutes, budget - used - kept), input, streamed, treePathed({ ...process.env, ...env, ...accountEnv(on) }), tree);
    used += Date.now() - started;
    closeSync(streamed);
    return { ...exited, stdout: readFileSync(hire.transcript).subarray(from).toString("utf8") };
  }
  async function attempt(input: string, resume?: string, kept = writeUpKept, waitFirst = false): Promise<Got> {
    let on = account;
    let got = await launch(input, resume, kept, waitFirst, on);
    while (outOfUsage(got) && Math.max(account, on + 1) < accounts().length) {
      account = Math.max(account, on + 1);
      on = account;
      got = await launch(input, resume, kept, false, on);
    }
    return got;
  }
  const refusalFor = (got: Got): string | undefined => {
    if (got.status === TIMED_OUT && minutes > 0) return `the ${hire.name} ran past its ${minutes} minute cap`;
    if (got.status !== 0) return `the ${hire.name} ended ${got.status}${reasonGiven(got)}`;
    return undefined;
  };
  return async (input, resume) => {
    let got = await attempt(input, resume);
    let refusal = refusalFor(got);
    if (refusal !== undefined && got.status !== TIMED_OUT && !outOfUsage(got)) {
      got = await attempt(input, resume, writeUpKept, true);
      refusal = refusalFor(got);
    }
    const reading = sessionOf(got.stdout);
    if (got.status === TIMED_OUT && minutes > 0 && hire.writeUp !== undefined && reading !== undefined) {
      got = await attempt(hire.writeUp.told, reading, 0);
      refusal = refusalFor(got);
    }
    if (refusal === undefined) return { stdout: got.stdout, session: sessionOf(got.stdout), answer: answerIn(got.stdout) };
    return got.status === TIMED_OUT && minutes > 0 ? { stdout: got.stdout, refusal, timedOut: true, session: sessionOf(got.stdout) ?? reading } : { stdout: got.stdout, refusal };
  };
}

export function machineLogs(): string {
  const logs = join(gitRead(["rev-parse", "--path-format=absolute", "--git-common-dir"], "the log directory could not be named by git, so no model was hired"), "machine-logs");
  mkdirSync(logs, { recursive: true });
  return logs;
}

const transcriptOf = (stage: string, key: string) => join(machineLogs(), `${stage}-${key}.jsonl`);

export const hireIn = (tree: string, stage: string, key: string, hiring: Omit<Hire, "transcript">, env: Record<string, string> = {}) => hired({ ...hiring, transcript: transcriptOf(stage, key) }, { tree, env });

interface Opening<Carried> {
  stage: string;
  issue: string;
  state: MarkedLabel;
  tried?: boolean;
  hire: Omit<Hire, "transcript">;
  ready: (asked: Asked) => { carrying: Carried; tried?: boolean; unmarked?: boolean; effort?: Effort } | number;
}

export interface Opened<Carried> {
  asked: Asked;
  carried: Carried;
  spend: (input: string, resume?: string) => Promise<Spent>;
}

export function opened<Carried>({ stage, issue, state, tried, hire: hiring, ready }: Opening<Carried>): Opened<Carried> | number {
  const said = `${stage}: #${issue}`;
  const unchanged = "so no label changed and no model was hired";
  const asked = askedOn(issue, unchanged);
  const stood = stoodDown(asked);
  if (stood !== undefined) {
    console.log(`${said} ${stood}, ${unchanged}`);
    return 0;
  }
  const readied = ready(asked);
  if (typeof readied !== "object") return readied;
  const spend = hireIn(process.cwd(), stage, issue, { ...hiring, effort: readied.effort ?? hiring.effort });
  if (readied.unmarked !== true) mark(issue, state, ...((readied.tried ?? tried) === true ? (["--try"] as const) : []));
  return { asked, carried: readied.carrying, spend };
}

export type Stop = "unchanged" | "again";

export type Refusal = { refused: string; handBack: string };

export type Ahead<Done> = { done: Done } | Refusal;

type Judged<Done> = { done: Done } | (Refusal & { changed?: boolean });

export type Looped<Done> = { done: Done } | { stop: Stop | "capped"; refused: string };

type Looping<Done> = {
  spend: (input: string, resume?: string) => Promise<Spent>;
  session?: string | undefined;
  stops: readonly Stop[];
  roundsBack?: number;
} & ({ input: string; judged: (spent: Spent) => Judged<Done> | Promise<Judged<Done>> } | { ahead: () => Handing<Done> | Promise<Handing<Done>>; judged: (spent: Spent) => { done: Done } | { changed?: boolean } });

type Handing<Done> = { done: Done } | { refused?: string; handBack: string };

type Judging<Done> = { done: Done } | { refused?: string; changed?: boolean | undefined };

function judgedAhead<Done>(looping: Looping<Done>): { ahead: () => Handing<Done> | Promise<Handing<Done>>; judged: (spent: Spent) => Judging<Done> | Promise<Judging<Done>> } {
  if ("ahead" in looping) return looping;
  let handing: Handing<Done> = { handBack: looping.input };
  return {
    ahead: () => handing,
    judged: async (spent) => {
      const judging = await looping.judged(spent);
      if (!("done" in judging)) handing = judging;
      return judging;
    },
  };
}

export async function stageLoop<Done>(looping: Looping<Done>): Promise<Looped<Done>> {
  const { spend, stops, roundsBack = Infinity } = looping;
  const { ahead, judged } = judgedAhead(looping);
  let carried = looping.session;
  let handedBack = 0;
  let last: { refused?: string | undefined; changed?: boolean | undefined } = {};
  for (;;) {
    const next = await ahead();
    if ("done" in next) return next;
    if (stops.includes("again") && next.refused !== undefined && next.refused === last.refused) return { stop: "again", refused: next.refused };
    if (next.refused !== undefined && handedBack === roundsBack) return { stop: "capped", refused: next.refused };
    const spent = await spend(next.handBack, carried);
    carried = spent.session ?? carried;
    const judging = await judged(spent);
    if ("done" in judging) return judging;
    const refused = judging.refused ?? next.refused;
    if (stops.includes("unchanged") && judging.changed === false && last.changed === false && refused !== undefined) return { stop: "unchanged", refused };
    last = { refused: next.refused, changed: judging.changed };
    if (next.refused !== undefined) handedBack += 1;
  }
}

const COMMITLINT = /^(\.commitlintrc(\.\w+)?|commitlint\.config\.[cm]?[jt]s)$/;
const COMMITLINT_KEY = /"commitlint"\s*:/;
export const commitlinted = () => readdirSync(process.cwd()).some((name) => COMMITLINT.test(name)) || COMMITLINT_KEY.test(onDisk(join(process.cwd(), "package.json")) ?? "");
const conventional = (type: string, message: string) => `${type}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;

export const head = () => gitRead(["rev-parse", "HEAD"], "the head of this branch could not be read");

export function committed(message: string, type: "feat" | "fix"): void {
  if (gitRead(["status", "--porcelain"], "what was changed could not be read") === "") return;
  git(["add", "--all"]);
  git(["commit", "--quiet", "-m", commitlinted() ? conventional(type, message) : message]);
}
