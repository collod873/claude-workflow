import { execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, matchesGlob } from "node:path";
import { parse } from "yaml";
import { onTestFinished } from "vitest";
import vitest from "../vitest.config.ts";
import { MACHINE, OWNER } from "./spelled.ts";
import { woken, type IssuePayload } from "./wake.ts";

export const CONTRACT = ".claude/contract.json";

interface Step {
  run: string;
  each?: string;
  files?: string;
  fast?: boolean;
  why?: string;
}

export const settleMapOf = (run: string, setup?: string) => JSON.stringify({ setup, settle: { index: { files: ["derived"], run, why: "derived/index lists parts/, so two branches that each add a part both rewrite it" } } });

export function contractSteps(contract: string): Record<string, Step> {
  return (JSON.parse(contract) as { steps?: Record<string, Step> }).steps ?? {};
}

export function coveredByCheck(contract: string): (file: string) => boolean {
  const commands = Object.values(contractSteps(contract)).flatMap((step) => [step.run, step.each ?? ""]);
  const fedToTools = new Set([CONTRACT, ...commands.flatMap((command) => command.match(/[\w./-]+\.(json|m?js|ts)\b/g) ?? [])]);
  const collects = vitest.test?.include ?? [];
  return (file) => fedToTools.has(file) || collects.some((glob) => matchesGlob(file, glob));
}

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const SRC = import.meta.dirname;
export const BIN = join(SRC, "..", "bin");
const WORKFLOWS = join(SRC, "..", ".github", "workflows");
export const harnessEnv = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST") && name !== "REASON" && name !== "TREE_PATH" && name !== "APP_KEY_FILE" && name !== "CLAUDE_CODE_SESSION_ID")), GH_RETRY_SECONDS: "0" };

export interface WorkflowStep {
  id?: string;
  if?: string | undefined;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "timeout-minutes"?: number;
}

interface WorkflowJob {
  if?: string | undefined;
  outputs?: Record<string, string>;
  env?: Record<string, unknown>;
  needs?: string | string[];
  permissions?: Record<string, string>;
  "cache-mode"?: string;
  "timeout-minutes"?: number;
  concurrency?: unknown;
  "runs-on"?: string;
  steps: WorkflowStep[];
}

export interface IssueEvent {
  event?: string;
  labels?: string[] | undefined;
  sender?: string;
  action?: string;
  label?: string;
  head?: string;
  fork?: boolean;
  state?: string;
}

export const workflowJobs = (file: string) => (parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, WorkflowJob> }).jobs;

const wakeIn = (job: WorkflowJob | undefined) => job?.steps.find(({ id }) => id === "wake");

export function gateOf(file: string, job: string): string {
  const jobs = workflowJobs(file);
  const gate = [job, ...[jobs[job]?.needs ?? []].flat()].find((name) => wakeIn(jobs[name]) !== undefined);
  if (gate === undefined) throw new Error(`no wake step in the ${job} job of ${file} or a job it needs`);
  return gate;
}

export function wakeStep(file: string, job: string): WorkflowStep {
  const step = wakeIn(workflowJobs(file)[gateOf(file, job)]);
  if (step === undefined) throw new Error(`no wake step in the ${job} job of ${file}`);
  return step;
}

export const payloadOf = ({ labels, action = "opened", label = "", sender = OWNER, state }: IssueEvent): IssuePayload => ({
  action,
  sender: { login: sender },
  ...(label === "" ? {} : { label: { name: label } }),
  ...(labels === undefined ? {} : { issue: { labels: labels.map((name) => ({ name })), ...(state === undefined ? {} : { state }) } }),
});

export const wakeOutputs = (event: IssueEvent): Record<string, string> => Object.fromEntries(Object.entries(woken(payloadOf(event))).map(([stage, starting]) => [stage, String(starting)]));

export const skippedAll = (steps: WorkflowStep[]): Record<string, StepOutcome> => Object.fromEntries(steps.flatMap(({ id }) => (id === undefined ? [] : [[id, { outcome: "skipped", conclusion: "skipped", outputs: {} }]])));

export function starts(file: string, gated: string, event: IssueEvent): boolean {
  const jobs = workflowJobs(file);
  const job = jobs[gated];
  if (job === undefined) throw new Error(`no ${gated} job in ${file}`);
  const gate = gateOf(file, gated);
  if (gate === gated) throw new Error(`the ${gated} job of ${file} wakes itself, so no job it needs answers whether it starts`);
  const { labels, ...rest } = event;
  if (!holds(jobs[gate]?.if ?? "true", rest)) return false;
  return holds(job.if ?? "success()", { ...rest, labels, needs: { [gate]: { result: "success", outputs: wakeOutputs(event) } } });
}

export type Said = string | { author: string; type: string; body: string };
export const authored = (comments: Said[]) => comments.map((said) => `${JSON.stringify(typeof said === "string" ? { author: MACHINE, type: "Bot", body: said } : said)}\n`).join("");

export interface StepOutcome {
  outcome: string;
  conclusion: string;
  outputs?: Record<string, string>;
}

export function holds(
  condition: string,
  {
    labels = [],
    steps = {},
    needs = {},
    failed = false,
    cancelled = false,
    sender = OWNER,
    body = "",
    action = "opened",
    label = "",
    head = "",
    event = "issues",
    inputs = {},
    state = "open",
    merged = false,
    repository = "app",
  }: {
    labels?: string[] | undefined;
    steps?: Record<string, StepOutcome>;
    needs?: Record<string, { result: string; outputs?: Record<string, string> }>;
    failed?: boolean;
    cancelled?: boolean;
    sender?: string;
    body?: string;
    action?: string;
    label?: string;
    head?: string;
    event?: string;
    inputs?: Record<string, string>;
    state?: string;
    merged?: boolean;
    repository?: string;
  },
): boolean {
  const github = {
    event_name: event,
    event: { action, label: { name: label }, issue: { state, body, labels: labels.map((name) => ({ name })) }, pull_request: { merged }, sender: { login: sender }, inputs, repository: { name: repository } },
    head_ref: head,
    repository_owner: OWNER,
  };
  const bare = condition.replace(/^\s*\$\{\{|\}\}\s*$/g, "");
  const statused = /\b(success|failure|always|cancelled)\(\)/.test(bare) ? bare : `success() && (${bare})`;
  return Boolean(
    evaluated(statused, {
      contexts: { github, steps, needs, inputs },
      functions: {
        success: () => !failed && !cancelled,
        failure: () => failed && !cancelled,
        always: () => true,
        cancelled: () => cancelled,
        startsWith: (text, start) => typeof text === "string" && typeof start === "string" && text.startsWith(start),
        contains: (search, item) => (search instanceof Each ? search.items.includes(item) : typeof search === "string" && typeof item === "string" && search.includes(item)),
      },
    }),
  );
}

class Each {
  readonly items: unknown[];

  constructor(items: unknown[]) {
    this.items = items;
  }
}

interface Scope {
  contexts: Record<string, unknown>;
  functions: Record<string, (...args: unknown[]) => boolean>;
}

const EXPRESSION_TOKEN = /\s*(?:'((?:[^']|'')*)'|([A-Za-z_][\w-]*)|(==|!=|&&|\|\||[!().,*[\]]))/y;

function tokensOf(source: string): string[] {
  const tokens: string[] = [];
  EXPRESSION_TOKEN.lastIndex = 0;
  while (source.slice(EXPRESSION_TOKEN.lastIndex).trim() !== "") {
    const at = EXPRESSION_TOKEN.lastIndex;
    const found = EXPRESSION_TOKEN.exec(source);
    if (found === null) throw new SyntaxError(`no expression token at ${at} in ${source}`);
    tokens.push(found[1] === undefined ? (found[2] ?? found[3] ?? "") : `'${found[1]}`);
  }
  return tokens;
}

function member(value: unknown, key: string): unknown {
  if (value instanceof Each) return new Each(value.items.map((item) => member(item, key)));
  if (typeof value !== "object" || value === null) return undefined;
  if (key === "*") return new Each(Object.values(value));
  return (value as Record<string, unknown>)[key];
}

type Lazy = () => unknown;

const LITERALS: Record<string, unknown> = { true: true, false: false, null: null };

function evaluated(source: string, { contexts, functions }: Scope): unknown {
  const tokens = tokensOf(source);
  let at = 0;
  const peek = () => tokens[at];
  const take = (expected?: string): string => {
    const token = tokens[at++];
    if (token === undefined || (expected !== undefined && token !== expected)) throw new SyntaxError(`expected ${expected ?? "a token"} at token ${at} in ${source}`);
    return token;
  };
  const either = (): Lazy => {
    let value = both();
    while (peek() === "||") {
      take();
      const [left, right] = [value, both()];
      value = () => left() || right();
    }
    return value;
  };
  const both = (): Lazy => {
    let value = equality();
    while (peek() === "&&") {
      take();
      const [left, right] = [value, equality()];
      value = () => left() && right();
    }
    return value;
  };
  const equality = (): Lazy => {
    let value = unary();
    while (peek() === "==" || peek() === "!=") {
      const equal = take() === "==";
      const [left, right] = [value, unary()];
      value = () => (left() == right()) === equal;
    }
    return value;
  };
  const unary = (): Lazy => {
    if (peek() !== "!") return postfix();
    take();
    const operand = unary();
    return () => !operand();
  };
  const postfix = (): Lazy => {
    let value = primary();
    for (;;) {
      const object = value;
      if (peek() === ".") {
        take();
        const key = take();
        value = () => member(object(), key);
      } else if (peek() === "[") {
        take();
        const key = either();
        take("]");
        value = () => {
          const named = key();
          return member(object(), typeof named === "string" ? named : JSON.stringify(named));
        };
      } else return value;
    }
  };
  const primary = (): Lazy => {
    const token = take();
    if (token === "(") {
      const value = either();
      take(")");
      return value;
    }
    if (token.startsWith("'")) {
      const text = token.slice(1).replaceAll("''", "'");
      return () => text;
    }
    if (peek() === "(") return called(token);
    if (token in LITERALS) return () => LITERALS[token];
    return () => {
      if (!(token in contexts)) throw new ReferenceError(`${token} is not a context this scenario knows, in ${source}`);
      return contexts[token];
    };
  };
  const called = (name: string): Lazy => {
    take("(");
    const args: Lazy[] = [];
    while (peek() !== ")") {
      args.push(either());
      if (peek() === ",") take();
    }
    take(")");
    return () => {
      const run = functions[name];
      if (run === undefined) throw new ReferenceError(`${name}() is not a function this scenario knows, in ${source}`);
      return run(...args.map((arg) => arg()));
    };
  };
  const value = either();
  if (at !== tokens.length) throw new SyntaxError(`unexpected ${tokens[at] ?? ""} in ${source}`);
  return value();
}

export const NO_FILES: Readonly<Record<string, string>> = {};

export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: harnessEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function script(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/bash\n${body}`);
  chmodSync(path, 0o755);
}

export const refusedMark = (refusal: string | undefined): string => (refusal === undefined ? "" : `printf '%s\\n' '${refusal}' >&2\nexit 1\n`);

export function stubbedMark(root: string, hiredAt?: string, refusal?: string): () => string[] {
  const marks = join(root, "mark-calls");
  const when = hiredAt === undefined ? "" : `[[ -e "${hiredAt}" ]] && when=after || when=before\n`;
  script(join(root, "bin", "mark"), `${when}printf '%s\\n' "$*${hiredAt === undefined ? "" : " $when the model"}" >>"${marks}"\n${refusedMark(refusal)}`);
  return () => linesIn(marks);
}

export function copyMark(root: string): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  for (const name of ["mark", "spelled", "github"]) copyFileSync(join(BIN, name), join(root, "bin", name));
  copyFileSync(join(SRC, "spelled.ts"), join(root, "src", "spelled.ts"));
}

export function execute(file: string, cwd: string, extra: Record<string, string> = {}, args: string[] = []): Run {
  const { status, stdout, stderr } = spawnSync(file, args, { cwd, env: { MACHINE_BIN: join(cwd, "bin"), ...harnessEnv, ...extra }, encoding: "utf8" });
  return { status, stdout, stderr };
}

export const TOKEN_PAGE = "https://github.com/settings/personal-access-tokens/new?name=BILLING_PAT&target_name=collod873&expires_in=366&plan=read";
export const HANDED_OVER = "In a terminal, run `gh secret set BILLING_PAT --repo collod873/claude-workflow` and paste the token at its prompt, never into a chat";
export const OPENED_TOKEN_PAGE = { action: "Open the pre-filled token page", at: TOKEN_PAGE, picks: [{ field: "Expiration", value: "366 days" }, { field: "Repository access", value: "Public repositories" }, { field: "Plan", value: "Read-only" }] };
export const TAKEN_STEP = {
  clicks: [
    OPENED_TOKEN_PAGE,
    { action: "Click Generate token and copy it", at: TOKEN_PAGE, picks: [] },
  ],
  handover: HANDED_OVER,
};

export const wellFormedNote = ["## Why", "", "Three passes over the standards left four proposals nobody can build until the owner weighs them.", ""].join("\n");

export const wellFormedSpec = [
  "## Problem Statement",
  "",
  'The owner, in session: "a spec is filed once, so the slicer and the done check share one document".',
  "",
  "## Solution",
  "",
  "File a spec kind alongside a ticket, sharing its filing pipeline.",
  "",
  "## User Stories",
  "",
  "1. As the owner, I can file a spec before any ticket exists.",
  "",
  "## Implementation Decisions",
  "",
  "Reuse the ticket machinery where it already fits.",
  "",
  "## Testing Decisions",
  "",
  "Cover the shape with unit tests.",
  "",
  "## Out of Scope",
  "",
  "The slicer and the done check.",
  "",
  "## Further Notes",
  "",
  "## Done when",
  "",
  "- [ ] see a spec land as its own issue, labelled spec",
  "",
].join("\n");

export function cloned(root: string, ...commits: string[]) {
  return clonedOn(root, "main", commits);
}

export function clonedOn(root: string, defaultBranch: string, commits: string[]) {
  const remote = join(root, "remote.git");
  const session = join(root, "session");
  git(root, "init", "--quiet", "--bare", `--initial-branch=${defaultBranch}`, remote);
  git(root, "clone", "--quiet", remote, session);
  git(session, "config", "user.email", "session@test");
  git(session, "config", "user.name", "session");
  for (const message of commits) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
  git(session, "push", "--quiet", "origin", defaultBranch);
  return { remote, session };
}

export function heard({ status, stdout, stderr }: Run) {
  return { status, stderr, lines: stdout.trimEnd().split("\n") };
}

export const LANDED_PR = "https://github.com/collod873/claude-workflow/pull/1";
export const NOISE = "a line a tool prints that nobody needed to read\n".repeat(40).trim();
export function plant(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function filedAs(calls: string[][]): { title: string | undefined; labels: string[]; body: string | undefined; then: string[][] } {
  const [call = [], ...then] = calls;
  return { title: call[call.indexOf("--title") + 1], labels: call.filter((_, at) => call[at - 1] === "--label"), body: bodyIn(call), then };
}

export function ghArgv(dir: string): { setup: string; calls: () => string[][] } {
  mkdirSync(dir, { recursive: true });
  return {
    setup: `n=$(( $(ls "${dir}" 2>/dev/null | wc -l) + 1 ))\nprintf '%s\\0' "$@" >"${dir}/$n"`,
    calls: () => readdirSync(dir).map((_, index) => readFileSync(join(dir, String(index + 1)), "utf8").split("\0").filter((part) => part !== "")),
  };
}

export const labelsJson = (file: string) => `printf '{"state":"%s","labels":[%s]}' "$(cat "${file}.state" 2>/dev/null || echo OPEN)" "$(sed 's/.*/{"name":"&"}/' "${file}" | paste -sd, -)"`;

export const bodyIn = (args: string[]) => (args.includes("--body") ? (args[args.indexOf("--body") + 1] ?? "") : (args.find((arg) => arg.startsWith("body="))?.slice("body=".length) ?? ""));

export const linesIn = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : []);

export const nulSplit = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\0").filter((said) => said !== "") : []);

export const schemaIn = (argv: string[]) => JSON.parse(argv[argv.indexOf("--json-schema") + 1] ?? "{}") as { required: string[]; properties: Record<string, { items?: { required: string[]; properties: Record<string, { enum?: string[] }> } }> };

export const createdIssues = (calls: string[][]) =>
  calls.filter((args) => args[0] === "issue" && args[1] === "create").map((args) => ({ title: args[args.indexOf("--title") + 1], body: bodyIn(args), labels: args.flatMap((arg, at) => (args[at - 1] === "--label" ? [arg] : [])) }));

export const FIXED_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a red ticket stays with its builder until it merges, never the owner".',
  "",
  "## Done when",
  "",
  "- The builder clears a red ticket.",
  "",
].join("\n");

export type Parent = object | "unreadable" | undefined;

export function openedCases(root: string, opener: string, body: string, parent: Parent, ticket = "811", standing: { labels?: string[]; state?: string } = {}): string[] {
  plant(root, "opened.json", JSON.stringify({ number: Number(ticket), user: { login: opener }, body, state: standing.state ?? "open", labels: (standing.labels ?? []).map((name) => ({ name })) }));
  return [`  *"api"*"issues/${ticket}/parent") ${parentSays(root, parent)} ;;`, `  *"api"*"issues/${ticket}") cat "${join(root, "opened.json")}" ;;`];
}

function parentSays(root: string, parent: Parent): string {
  plant(root, "parent.json", JSON.stringify(parent ?? {}));
  if (parent === undefined) return "printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1";
  if (parent === "unreadable") return "printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1";
  return `cat "${join(root, "parent.json")}"`;
}

export function issueStage(prefix: string, issue: object, answer: object, posted: string, gh: string, cutOff = "") {
  const root = scratch(prefix);
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  const handed = join(root, "claude-stdin");
  const hired = join(root, "claude-argv");
  git(root, "init", "--quiet", "--initial-branch=main");
  plant(root, "issue.json", JSON.stringify(issue));
  plant(root, "answer.json", `${JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: answer })}\n`);
  script(join(root, "bin", "gh"), [setup, gh, 'case "$*" in', `  *"issue view"*) cat "${join(root, "issue.json")}" ;;`, `  *"issue comment"*) printf '%s\\n' '${posted}' ;;`, "esac", ""].join("\n"));
  script(join(root, "bin", "claude"), `printf '%s\\0' "$@" >"${hired}"\ncat >"${handed}"\n${cutOff}cat "${join(root, "answer.json")}"\n`);
  return {
    root,
    argv: calls,
    hired: () => (existsSync(hired) ? readFileSync(hired, "utf8").split("\0") : []),
    handed: () => (existsSync(handed) ? readFileSync(handed, "utf8") : ""),
    calls: () => calls().map((args) => args.slice(0, 3).join(" ")),
    comments: () => calls().filter((args) => args[1] === "comment").map(bodyIn),
  };
}

export const PC_RUNS_ON = "${{ vars.CI_RUNNER || 'ubuntu-latest' }}";
let appKey: { publicKey: string; privateKey: string } | undefined;
export const appKeys = () => (appKey ??= generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }));
export const key = () => appKeys().privateKey;
