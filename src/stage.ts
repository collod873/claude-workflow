import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { brief, onDisk } from "./brief.ts";
import { stageArgv } from "./fence.ts";
import { STOPS, type Stop, type Stopped } from "./stops.ts";
import { checks, quoted } from "./ticket-shape.ts";

const UNTRACKED = "??";
const STREAM = ["--output-format", "stream-json", "--verbose"];

export interface Opened {
  ticket: string;
  body: string;
  tests: string[];
  commands: string[];
  briefed: string;
  aside: string[];
  logs: string;
  wrote: () => string[];
  spend: (input: string, resume?: string) => { refusal?: string; session?: string; answer?: unknown };
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
  const argv = [...stageArgv(commands), ...(stage.answers === undefined ? [] : ["--json-schema", JSON.stringify(stage.answers)])];
  const kept = join(logs, `${stage.bin}-${ticket}-set-aside`);
  const transcript = join(logs, `${stage.bin}-${ticket}.jsonl`);
  rmSync(kept, { recursive: true, force: true });
  rmSync(transcript, { force: true });
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
      const spent = spawnSync("claude", [...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], { input, encoding: "utf8", maxBuffer: Infinity });
      const stdout = spent.stdout ?? "";
      appendFileSync(transcript, stdout);
      setAside(opened.wrote().filter((path) => !stage.keeps(path, opened)));
      const stray = writtenOutsideRepo(cwd, stdout);
      if (stray !== undefined) return { refusal: `the ${stage.name} wrote outside the repo: ${stray}` };
      if (spent.status !== 0) return { refusal: `the ${stage.name} ended ${spent.status}: ${quoted(String(spent.stderr || stdout).trim().split("\n")[0])}` };
      return { session: sessionOf(stdout), answer: answerIn(stdout) };
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
  const logs = join(git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim(), "machine-logs");
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
