import { spawnSync } from "node:child_process";
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { brief, onDisk } from "./brief.ts";
import { ownerHooks, stageArgv, type Registration } from "./fence.ts";
import { STOPS, type Stop, type Stopped } from "./stops.ts";
import { checks, quoted } from "./ticket-shape.ts";

const UNTRACKED = "??";
const STREAM = ["--output-format", "stream-json", "--verbose"];
const TIMED_OUT = 124;
const GRACE_SECONDS = "30";
const RETRY_WAIT_SECONDS = "5";

export interface Opened {
  ticket: string;
  body: string;
  tests: string[];
  commands: string[];
  briefed: string;
  aside: string[];
  logs: string;
  wrote: () => string[];
  spend: (input: string, resume?: string) => Spent;
  setAside: (paths: string[]) => void;
}

export type Outcome = (Stopped | { stop?: undefined; verdict: string }) & { commit?: { message: string; branch?: string } };

export interface Stage {
  name: string;
  bin: string;
  undone: string;
  clean?: boolean;
  endsAt?: Stop;
  answers?: object;
  tests?: { found: () => string[]; missing?: string };
  keeps: (path: string, opened: Opened) => boolean;
  work: (opened: Opened) => Outcome;
}

const git = (cwd: string, args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

function changed(cwd: string): Map<string, string> {
  const entries = git(cwd, ["status", "--porcelain", "-z", "-uall"]).stdout.split("\0");
  const found = new Map<string, string>();
  for (let at = 0; at < entries.length; at++) {
    const entry = entries[at];
    if (entry.length < 4) continue;
    found.set(entry.slice(3), entry.slice(0, 2));
    if (/^[RC]/.test(entry)) at++;
  }
  return found;
}

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

function writtenOutsideRepo(cwd: string, stdout: string): string | undefined {
  for (const event of events(stdout)) {
    const content = (event as { message?: { content?: unknown[] } })?.message?.content;
    for (const block of content ?? []) {
      const { type, name, input } = (block ?? {}) as { type?: string; name?: string; input?: { file_path?: unknown } };
      const path = input?.file_path;
      if (type === "tool_use" && (name === "Write" || name === "Edit") && typeof path === "string" && relative(cwd, resolve(cwd, path)).startsWith("..")) return path;
    }
  }
  return undefined;
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

function capped(argv: string[], minutes: number, deadline: number): string[] {
  if (!(minutes > 0)) return ["claude", ...argv];
  const left = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
  return ["timeout", `--kill-after=${GRACE_SECONDS}`, String(left), "claude", ...argv];
}

function registered(): Registration | string {
  const path = process.env.AGENT_HOOKS_SETTINGS;
  if (path === undefined || path === "") return {};
  try {
    return (JSON.parse(readFileSync(path, "utf8")) as { hooks?: Registration }).hooks ?? {};
  } catch {
    return path;
  }
}

export interface Hire {
  name: string;
  transcript: string;
  commands?: string[];
  tools?: string[];
  answers?: object;
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
  const argv = [...stageArgv(hire.commands ?? [], ownerHooks(hooks), hire.tools), ...(hire.answers === undefined ? [] : ["--json-schema", JSON.stringify(hire.answers)])];
  rmSync(hire.transcript, { force: true });
  const attempt = (input: string, resume?: string) => {
    const from = existsSync(hire.transcript) ? statSync(hire.transcript).size : 0;
    const streamed = openSync(hire.transcript, "a");
    const [command, ...args] = capped([...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], minutes, deadline);
    const spent = spawnSync(command, args, { input, stdio: ["pipe", streamed, "pipe"], encoding: "utf8", maxBuffer: Infinity });
    closeSync(streamed);
    const stdout = readFileSync(hire.transcript).subarray(from).toString("utf8");
    return { stdout, status: spent.status, stderr: String(spent.stderr ?? "") };
  };
  const refusalFor = (got: { stdout: string; status: number | null; stderr: string }): string | undefined => {
    if (got.status === TIMED_OUT && minutes > 0) return `the ${hire.name} ran past its ${minutes} minute cap`;
    if (got.status !== 0) return `the ${hire.name} ended ${got.status}: ${quoted(String(got.stderr || got.stdout).trim().split("\n")[0])}`;
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
    return refusal === undefined ? { stdout: got.stdout, session: sessionOf(got.stdout), answer: answerIn(got.stdout) } : { stdout: got.stdout, refusal };
  };
}

export const machineLogs = (cwd: string) => join(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim(), "machine-logs");

function open(stage: Stage, ticket: string, cwd: string, logs: string): Opened | Stopped {
  const asked = spawnSync("gh", ["issue", "view", ticket, "--json", "body", "--jq", ".body"], { encoding: "utf8" });
  if (asked.status !== 0) return { stop: "unread", refusals: [`ticket ${ticket} could not be read, so ${stage.undone}`] };
  const body = asked.stdout;
  const tests = stage.tests?.found() ?? [];
  if (stage.tests?.missing !== undefined && tests.length === 0) return { stop: "noTest", refusals: [stage.tests.missing] };
  const briefed = brief({ ticket, body, tests, read: onDisk });
  if (briefed.refusals.length > 0) return { stop: "overCap", refusals: briefed.refusals };
  writeFileSync(join(logs, `brief-${ticket}.md`), briefed.text);
  const commands = checks(body).map(({ command }) => command);
  const spend = hired({ name: stage.name, transcript: join(logs, `${stage.bin}-${ticket}.jsonl`), commands, answers: stage.answers });
  if (typeof spend === "string") return { stop: "modelRun", refusals: [`the owner's hooks could not be read from ${spend}, so ${stage.undone}`] };
  const kept = join(logs, `${stage.bin}-${ticket}-set-aside`);
  rmSync(kept, { recursive: true, force: true });
  const before = changed(cwd);
  const fresh = () => [...changed(cwd)].filter(([path]) => !before.has(path));
  const aside: string[] = [];
  const setAside = (paths: string[]) => {
    for (const [path, status] of fresh().filter(([written]) => paths.includes(written))) {
      mkdirSync(dirname(join(kept, path)), { recursive: true });
      if (existsSync(join(cwd, path))) cpSync(join(cwd, path), join(kept, path));
      if (status === UNTRACKED) rmSync(join(cwd, path), { force: true });
      else git(cwd, ["checkout", "--quiet", "--", path]);
      if (!aside.includes(path)) aside.push(path);
    }
  };
  const opened: Opened = {
    ticket,
    body,
    tests,
    commands,
    briefed: briefed.text,
    aside,
    logs,
    wrote: () => fresh().map(([path]) => path),
    setAside,
    spend: (input, resume) => {
      const spent = spend(input, resume);
      setAside(opened.wrote().filter((path) => !stage.keeps(path, opened)));
      const stray = writtenOutsideRepo(cwd, spent.stdout);
      return stray === undefined ? spent : { stdout: spent.stdout, refusal: `the ${stage.name} wrote outside the repo: ${stray}` };
    },
  };
  return opened;
}

function commit(cwd: string, paths: string[], { message, branch }: { message: string; branch?: string }): string | undefined {
  const steps = [...(branch === undefined ? [] : [["checkout", "--quiet", "-b", branch]]), ["add", "--", ...paths], ["commit", "--quiet", "-m", message]];
  for (const step of steps) {
    const done = git(cwd, step);
    if (done.status !== 0) return `git ${step[0]} exited ${done.status}: ${done.stderr.trim()}`;
  }
  return undefined;
}

export function runStage(stage: Stage, ticket: string): number {
  const cwd = process.cwd();
  const said = `${stage.bin}: #${ticket}`;
  const logs = machineLogs(cwd);
  mkdirSync(logs, { recursive: true });
  const log = join(logs, `${stage.bin}-${ticket}.log`);
  rmSync(log, { force: true });
  const shown = relative(cwd, log).startsWith("..") ? log : relative(cwd, log);
  const ended = ({ stop, refusals }: Stopped, line: string) => {
    writeFileSync(log, `${refusals.length} refusals, stopped at: ${STOPS[stage.endsAt ?? stop]}\n${refusals.join("\n")}\n`);
    console.error(`${line}; log ${shown}`);
    return 1;
  };
  if (stage.clean === true && changed(cwd).size > 0) {
    return ended({ stop: "dirtyTree", refusals: ["the tree holds uncommitted work"] }, `${said} refused, the tree holds uncommitted work, so no model was spent`);
  }
  const opened = open(stage, ticket, cwd, logs);
  const outcome: Outcome = "stop" in opened ? opened : stage.work(opened);
  const written = "stop" in opened ? [] : opened.wrote();
  const saving = written.length > 0 ? outcome.commit : undefined;
  const failed = saving === undefined ? undefined : commit(cwd, written, saving);
  const refused = outcome.stop === undefined ? [] : outcome.refusals;
  const unsaved: Stopped | undefined = failed === undefined ? undefined : { stop: "uncommitted", refusals: [`the work would not commit${saving?.branch === undefined ? "" : ` on ${saving.branch}`}`, ...refused, failed] };
  const stopped = unsaved ?? outcome;
  if (stopped.stop === undefined) {
    console.log(`${said} ${stopped.verdict}`);
    return 0;
  }
  const kept = saving !== undefined && failed === undefined;
  return ended(stopped, `${said} ended red, ${stopped.refusals[0]}${kept ? "" : "; nothing written"}`);
}
