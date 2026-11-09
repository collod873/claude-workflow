import { execFile, spawn, spawnSync } from "node:child_process";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { NO_EM_DASH, onDisk } from "./brief.ts";
import { type Asked, askedOn, commentOnTicket, followUpBody, gh, git, gitRead, heardIn, stoodDown, LABELLED_WAITING, mark, nothingHears, OWNER, post, STUCK, WAITING, type MarkedLabel } from "./post.ts";
import type { Stop } from "./stops.ts";
import { addBlocker, postedUnderOrigin } from "./issue-links.ts";
import { quoted } from "./ticket-shape.ts";

const STREAM = ["--output-format", "stream-json", "--verbose"];
const TIMED_OUT = 124;
const GRACE_SECONDS = "30";
const RETRY_WAIT_SECONDS = "5";
const ACCOUNT_SECRETS = ["CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN_2"] as const;
const OUT_OF_USAGE = /usage limit reached|hit your (\w+ )?limit|limit reached|out of extra usage/i;

const accounts = () => [...new Set(ACCOUNT_SECRETS.map((name) => process.env[name] ?? "").filter((token) => token !== ""))];
let account = 0;
const accountEnv = (): Record<string, string> => {
  const token = accounts()[account];
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

export function setupRefusal(contract: string): string | undefined {
  const setup = setupOf(contract);
  return setup === undefined ? undefined : unready(spawnSync("bash", ["-c", setup], { env: treePathed(), encoding: "utf8", maxBuffer: Infinity }));
}

export function setupRefusedIn(tree: string, contract: string, env: Record<string, string> = {}): Promise<string | undefined> {
  const setup = setupOf(contract);
  if (setup === undefined) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    execFile("bash", ["-c", setup], { cwd: tree, env: treePathed({ ...process.env, ...env }), encoding: "utf8", maxBuffer: Infinity }, (error, stdout, stderr) => {
      resolve(unready({ status: error === null ? 0 : typeof error.code === "number" ? error.code : null, stdout, stderr }));
    });
  });
}

interface Launch {
  argv: [string, ...string[]];
  input: string;
  streamed: number;
  waitFirst: boolean;
  env: Record<string, string>;
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
  const argv = [...stageArgv(hire), ...(hire.answers === undefined ? [] : ["--json-schema", JSON.stringify(hire.answers)])];
  rmSync(hire.transcript, { force: true });
  const writeUpKept = (hire.writeUp?.minutes ?? 0) * 60_000;
  const handed = `${hire.transcript.replace(/\.jsonl$/, "")}.handed.md`;
  rmSync(handed, { force: true });
  function* attempt(input: string, resume?: string, kept = writeUpKept, waitFirst = false): Generator<Launch, Exited & { stdout: string }, Exited> {
    let got = yield* launch(input, resume, kept, waitFirst);
    while (outOfUsage(got) && account < accounts().length - 1) {
      account++;
      got = yield* launch(input, resume, kept, false);
    }
    return got;
  }
  function* launch(input: string, resume: string | undefined, kept: number, waitFirst: boolean): Generator<Launch, Exited & { stdout: string }, Exited> {
    appendFileSync(handed, `${input}\n\n`);
    const from = existsSync(hire.transcript) ? statSync(hire.transcript).size : 0;
    const streamed = openSync(hire.transcript, "a");
    const started = Date.now();
    const exited = yield { argv: capped([...argv, ...(resume === undefined ? [] : ["--resume", resume]), ...STREAM], minutes, budget - used - kept), input, streamed, waitFirst, env: accountEnv() };
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
    if (refusal !== undefined && got.status !== TIMED_OUT && !outOfUsage(got)) {
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

function launchedHere({ argv: [command, ...args], input, streamed, waitFirst, env }: Launch): Exited {
  if (waitFirst) spawnSync("sleep", [RETRY_WAIT_SECONDS]);
  const spent = spawnSync(command, args, { input, env: treePathed({ ...process.env, ...env }), stdio: ["pipe", streamed, "pipe"], encoding: "utf8", maxBuffer: Infinity });
  return { status: spent.status, stderr: String(spent.stderr ?? "") };
}

const launchedIn =
  (tree: string, env: Record<string, string>) =>
  async ({ argv: [command, ...args], input, streamed, waitFirst, env: chosen }: Launch): Promise<Exited> => {
    if (waitFirst) await setTimeout(Number(RETRY_WAIT_SECONDS) * 1000);
    return new Promise((resolve) => {
      const child = spawn(command, args, { cwd: tree, env: treePathed({ ...process.env, ...env, ...chosen }), stdio: ["pipe", streamed, "pipe"] });
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

export function hireIn(tree: string, stage: string, key: string, hiring: Omit<Hire, "transcript">, env: Record<string, string> = {}): (input: string, resume?: string) => Promise<Spent> {
  const spend = spending({ ...hiring, transcript: transcriptOf(stage, key) });
  const launched = launchedIn(tree, env);
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
  ready: (asked: Asked) => { carrying: Carried; tried?: boolean; unmarked?: boolean; effort?: Effort } | Own | undefined;
}

export interface Opened<Carried> {
  asked: Asked;
  carried: Carried;
  spend: (input: string, resume?: string) => Spent;
}

export function opened<Carried, Own extends string>({ stage, issue, state, tried, hire: hiring, ready }: Opening<Carried, Own>): Opened<Carried> | Own | undefined {
  const said = `${stage}: #${issue}`;
  const unchanged = "so no label changed and no model was hired";
  const asked = askedOn(issue, unchanged);
  const stood = stoodDown(asked);
  if (stood !== undefined) {
    console.log(`${said} ${stood}, ${unchanged}`);
    return undefined;
  }
  const readied = ready(asked);
  if (typeof readied !== "object") return readied;
  const spend = hire(stage, issue, { ...hiring, effort: readied.effort ?? hiring.effort });
  if (readied.unmarked !== true) mark(issue, state, ...((readied.tried ?? tried) === true ? (["--try"] as const) : []));
  return { asked, carried: readied.carrying, spend };
}

const DIRECT_LINK = /^https:\/\/\S+$/;

const CLICK = {
  type: "object",
  properties: {
    action: { type: "string", pattern: NO_EM_DASH, description: "One action the owner takes, such as Click Generate token." },
    at: {
      type: "string",
      pattern: DIRECT_LINK.source,
      description: "The exact settings page as a direct link, pre-filled where GitHub allows, as a fine-grained token's https://github.com/settings/personal-access-tokens/new?name=NAME&target_name=OWNER&expires_in=DAYS&PERMISSION=read.",
    },
    picks: {
      type: "array",
      description: "Every field the page asks, each with the one value to set, such as Expiration and Repository access for a token.",
      items: {
        type: "object",
        properties: { field: { type: "string", pattern: NO_EM_DASH }, value: { type: "string", minLength: 1, pattern: NO_EM_DASH } },
        required: ["field", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["action", "at", "picks"],
  additionalProperties: false,
};

export const OWNER_STEPS = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string", pattern: NO_EM_DASH },
      why: { type: "string", pattern: NO_EM_DASH },
      needs: { type: "string", pattern: NO_EM_DASH },
      clicks: { type: "array", minItems: 1, items: CLICK, description: "The owner's numbered steps, one action each; a step missing a link or a value is refused, not filed." },
      handover: {
        type: "string",
        pattern: NO_EM_DASH,
        description: "The last step: how a secret this makes reaches its home without being pasted into a chat, such as running gh secret set NAME --repo OWNER/REPO and pasting at its prompt. Empty when it makes no secret.",
      },
    },
    required: ["title", "why", "needs", "clicks", "handover"],
    additionalProperties: false,
  },
};

interface Click {
  action: string;
  at: string;
  picks: { field: string; value: string }[];
}

export interface OwnerStep {
  title: string;
  why: string;
  needs: string;
  clicks: Click[];
  handover: string;
}

const PAGES_ASKING = [{ page: "https://github.com/settings/personal-access-tokens/new", asks: ["Expiration", "Repository access"], prefills: ["name", "target_name", "expires_in"], unpermitted: ["name", "description", "target_name", "expires_in"] }];
const UNANSWERED = /^\s*(|any|whatever|your (call|choice)|choose|pick one|tbd|n\/a|\?+|depends)\s*$/i;
const SECRET = /\b(tokens?|secrets?|passwords?|keys?|pat)\b|_(KEY|TOKEN|SECRET|PAT)\b/i;

const linked = (at: string) => DIRECT_LINK.test(at) && URL.canParse(at);
const askingAt = (url: URL) => PAGES_ASKING.find(({ page }) => `${url.origin}${url.pathname}` === page);

function clickRefusals({ at, picks }: Click, index: number): string[] {
  const number = index + 1;
  if (!linked(at)) return [`step ${number} links no page: "${at}" is no direct https link`];
  const url = new URL(at);
  const asking = askingAt(url);
  const permitted = asking === undefined || [...url.searchParams.keys()].some((param) => !asking.unpermitted.includes(param));
  const unfilled = [...(asking?.prefills ?? []).filter((param) => !url.searchParams.has(param)), ...(permitted ? [] : ["a permission"])];
  return [
    ...picks.filter(({ value }) => UNANSWERED.test(value)).map(({ field }) => `step ${number} leaves "${field}" unanswered`),
    ...(unfilled.length > 0 ? [`step ${number} links its page without pre-filling ${unfilled.join(", ")}`] : []),
  ];
}

function unaskedRefusals(clicks: Click[]): string[] {
  const fields = clicks.flatMap(({ picks }) => picks.map(({ field }) => field.toLowerCase()));
  const firstOnPage = new Map<(typeof PAGES_ASKING)[number], number>();
  clicks.forEach(({ at }, index) => {
    const asking = linked(at) ? askingAt(new URL(at)) : undefined;
    if (asking !== undefined && !firstOnPage.has(asking)) firstOnPage.set(asking, index);
  });
  return [...firstOnPage].flatMap(([{ asks }, index]) => asks.filter((ask) => !fields.some((field) => field.includes(ask.toLowerCase()))).map((ask) => `step ${index + 1} leaves "${ask}" unanswered, which its page asks`));
}

function ownerStepRefusals(step: OwnerStep): string[] {
  if (step.clicks.length === 0) return ["it gives no numbered steps, so the owner must work out where to click"];
  const said = [step.title, step.why, step.needs, ...step.clicks.map(({ action }) => action)].join("\n");
  const unhanded = SECRET.test(said) && step.handover.trim() === "" ? ["it makes a secret, but no last step says how to hand it over without pasting it into a chat"] : [];
  return [...new Set([...step.clicks.flatMap(clickRefusals), ...unaskedRefusals(step.clicks)]), ...unhanded];
}

export function stepsUnfileable(steps: OwnerStep[]): string | undefined {
  const refused = steps.flatMap((step) => ownerStepRefusals(step).map((refusal) => `- "${step.title}": ${refusal}`));
  return refused.length === 0 ? undefined : ["These owner steps would be refused, not filed:", refused.join("\n"), "Answer again with each under its same title, fixed: nothing is posted, filed or landed until every one would file."].join("\n\n");
}

const numbered = ({ clicks, handover }: OwnerStep): string =>
  [
    ...clicks.flatMap(({ action, at, picks }, index) => [`${index + 1}. ${action}: ${at}`, ...picks.map(({ field, value }) => `   - ${field}: **${value}**`)]),
    ...(handover.trim() === "" ? [] : [`${clicks.length + 1}. ${handover.trim()}`]),
  ].join("\n");

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
        waits: { type: "string", pattern: NO_EM_DASH },
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
  waits?: string | undefined;
}

export type Filed = { named: string; refusals: string[]; said: string };

const stepKey = (title: string) => title.trim().toLowerCase();
export const FILED = /\/issues\/(\d+)\s*$/;

const blocks = (step: OwnerStep) => step.needs.trim() !== "";

const ownerStepFiled = (left: string) => (step: OwnerStep): Filed => {
  const named = `${step.title}: ${step.why}`;
  const refusals = ownerStepRefusals(step);
  if (refusals.length > 0) return { named, refusals, said: "" };
  const needs = blocks(step) ? `Needs: ${step.needs.trim()}\n\n` : "";
  return { named, ...post({ kind: blocks(step) ? "owner" : "note", title: step.title, text: `## Why\n\n${step.why}\n\n## Steps\n\n${numbered(step)}\n\n${needs}${left}\n` }, gh) };
};

function pingedUnheard(filed: Filed, note: string): Filed {
  const repo = process.env.GH_REPO ?? "";
  const fix = FILED.exec(filed.said)?.[1];
  if (fix === undefined || heardIn(repo)) return filed;
  commentOnTicket(fix, `#${fix} waits on #${note}, ${LABELLED_WAITING}. ${nothingHears(fix, repo)} #${note}`, gh);
  return filed;
}

function fixFiled(found: string, { fault, title, done, waits }: Fix, notes: Map<string, Filed>, unneeded: Set<string>): Filed {
  const text = followUpBody([found, "", `> ${fault}`], done);
  if (waits === undefined || waits.trim() === "" || unneeded.has(stepKey(waits))) return { named: title, ...postedUnderOrigin({ kind: "ticket", title, text }, gh) };
  const number = FILED.exec(notes.get(stepKey(waits))?.said ?? "")?.[1];
  if (number === undefined) return { named: title, refusals: [`it waits on the owner step "${waits}", which was not filed`], said: "" };
  const filed: Filed = { named: title, ...postedUnderOrigin({ kind: "ticket", title, text, labels: [WAITING] }, gh) };
  const fix = FILED.exec(filed.said)?.[1];
  const repo = process.env.GH_REPO ?? "";
  if (fix !== undefined) addBlocker(repo, Number(fix), repo, Number(number));
  return pingedUnheard(filed, number);
}

export function stepsAndFixesFiled(found: string, left: string, steps: OwnerStep[], fixes: Fix[]): Filed[] {
  const filed = steps.map((step) => ({ step, filed: ownerStepFiled(left)(step) }));
  const notes = new Map(filed.filter(({ step }) => blocks(step)).map(({ step, filed }) => [stepKey(step.title), filed]));
  const unneeded = new Set(steps.filter((step) => !blocks(step)).map((step) => stepKey(step.title)));
  return [...filed.map(({ filed }) => filed), ...fixes.map((fix) => fixFiled(found, fix, notes, unneeded))];
}


export function followedUp(found: string, fixes: Fix[], asks: string[], call: { title: string; by: string; steps: OwnerStep[]; left: string }): Filed[] {
  const tickets = stepsAndFixesFiled(found, call.left, call.steps, fixes.slice(0, MOST_FIXES));
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
