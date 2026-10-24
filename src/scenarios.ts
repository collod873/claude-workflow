import { execFile, execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, matchesGlob } from "node:path";
import { parse } from "yaml";
import { onTestFinished } from "vitest";
import vitest from "../vitest.config.ts";
import { MACHINE, OWNER, SPELLINGS } from "./spelled.ts";

export const LINE_LIMIT = 200;
export const MOST_LINES = 6;

export function overLimit(said: string, allowed: number): string[] {
  const spoken = said.replace(/\n$/, "").split("\n");
  const long = spoken.filter((line) => line.length > LINE_LIMIT).map((line) => `said a line of ${line.length} characters, over ${LINE_LIMIT}`);
  return spoken.length > allowed ? [...long, `said ${spoken.length} lines, over ${allowed}`] : long;
}

export const CONTRACT = ".claude/contract.json";

interface Step {
  run: string;
  each?: string;
  files?: string;
  fast?: boolean;
  why?: string;
}

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
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST") && name !== "REASON" && name !== "TREE_PATH" && name !== "APP_KEY_FILE" && name !== "CLAUDE_CODE_SESSION_ID")), GH_RETRY_SECONDS: "0" };

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

const labelledIn = (job: WorkflowJob | undefined) => job?.steps.find(({ id }) => id === "labelled");

export function gateOf(file: string, job: string): string {
  const jobs = workflowJobs(file);
  const gate = [job, ...[jobs[job]?.needs ?? []].flat()].find((name) => labelledIn(jobs[name]) !== undefined);
  if (gate === undefined) throw new Error(`no labelled step in the ${job} job of ${file} or a job it needs`);
  return gate;
}

export function labelledStep(file: string, job: string): WorkflowStep {
  const step = labelledIn(workflowJobs(file)[gateOf(file, job)]);
  if (step === undefined) throw new Error(`no labelled step in the ${job} job of ${file}`);
  return step;
}

export const afterLabelled = (steps: WorkflowStep[]) => steps.slice(steps.findIndex(({ id }) => id === "labelled") + 1);

export const labelledAs = (steps: WorkflowStep[], held: string | undefined): Record<string, StepOutcome> => ({
  ...Object.fromEntries(steps.flatMap(({ id }) => (id === undefined ? [] : [[id, { outcome: "skipped", conclusion: "skipped", outputs: {} }]]))),
  labelled: { outcome: "success", conclusion: "success", outputs: held === undefined ? {} : { held } },
});

export function labelledOutputs(step: WorkflowStep, cwd: string, { labels, action = "opened", label = "", sender = OWNER, head, state }: IssueEvent): Promise<{ failed: boolean; outputs: Record<string, string> }> {
  const root = scratch("labelled-");
  const event = join(root, "event.json");
  const output = join(root, "output");
  writeFileSync(event, JSON.stringify({ action, sender: { login: sender }, ...(label === "" ? {} : { label: { name: label } }), ...(labels === undefined ? {} : { issue: { labels: labels.map((name) => ({ name })), ...(state === undefined ? {} : { state }) } }), ...(head === undefined ? {} : { pull_request: { head: { ref: head } } }) }));
  return new Promise((resolve) => {
    execFile("bash", ["-e", "-c", step.run ?? ""], { cwd, env: { ...env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output } }, (error) => {
      const written = existsSync(output) ? readFileSync(output, "utf8") : "";
      resolve({ failed: error !== null, outputs: Object.fromEntries([...written.matchAll(/^([\w-]+)=(.*)$/gm)].map(([, name = "", value = ""]) => [name, value])) });
    });
  });
}

export const heldBy = async (step: WorkflowStep, cwd: string, event: IssueEvent): Promise<{ failed: boolean; held: string | undefined }> => {
  const { failed, outputs } = await labelledOutputs(step, cwd, event);
  return { failed, held: outputs.held };
};

const HELD = new Map<string, ReturnType<typeof labelledOutputs>>();
let spelledOnce: string | undefined;

function answeredOnce(): string {
  if (spelledOnce !== undefined) return spelledOnce;
  const root = mkdtempSync(join(tmpdir(), "spelled-once-"));
  process.once("exit", () => rmSync(root, { recursive: true, force: true }));
  const known = SPELLINGS.filter(([key]) => key !== "labels").map(([key, spelling]) => `  ${key}) printf '%s\\n' '${spelling.replaceAll("'", "'\\''")}'; exit 0 ;;`);
  script(join(root, "bin", "spelled"), ['[ "$#" -eq 1 ] && case "$1" in', ...known, "esac", `exec "${join(BIN, "spelled")}" "$@"`, ""].join("\n"));
  return (spelledOnce = root);
}

export async function starts(file: string, gated: string, event: IssueEvent): Promise<boolean> {
  const jobs = workflowJobs(file);
  const job = jobs[gated];
  if (job === undefined) throw new Error(`no ${gated} job in ${file}`);
  const gate = gateOf(file, gated);
  const { labels, ...rest } = event;
  if (!holds(jobs[gate]?.if ?? "true", rest)) return false;
  const seen = `${file} ${gate} ${JSON.stringify([labels, rest.action, rest.label, rest.head, rest.state])}`;
  const heard = HELD.get(seen) ?? labelledOutputs(labelledStep(file, gate), answeredOnce(), { ...rest, labels, sender: OWNER });
  HELD.set(seen, heard);
  const { failed, outputs } = await heard;
  if (failed || Object.keys(outputs).length === 0) throw new Error(`the labelled step of ${file} ended red on ${JSON.stringify(labels)}`);
  if (gate !== gated) return holds(job.if ?? "success()", { ...rest, needs: { [gate]: { result: "success", outputs } } });
  const [next] = afterLabelled(job.steps);
  return holds(next?.if ?? "success()", { steps: labelledAs(job.steps, outputs.held) });
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
  },
): boolean {
  const github = {
    event_name: event,
    event: { action, label: { name: label }, issue: { state, body, labels: labels.map((name) => ({ name })) }, sender: { login: sender }, inputs },
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
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
  return () => (existsSync(marks) ? readFileSync(marks, "utf8").trimEnd().split("\n") : []);
}

export function copyMark(root: string): void {
  mkdirSync(join(root, "bin"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  for (const name of ["mark", "spelled", "github"]) copyFileSync(join(BIN, name), join(root, "bin", name));
  copyFileSync(join(SRC, "spelled.ts"), join(root, "src", "spelled.ts"));
}

export function execute(file: string, cwd: string, extra: Record<string, string> = {}, args: string[] = []): Run {
  const { status, stdout, stderr } = spawnSync(file, args, { cwd, env: { MACHINE_BIN: join(cwd, "bin"), ...env, ...extra }, encoding: "utf8" });
  return { status, stdout, stderr };
}

export const wellFormedTicket = [
  "## Why",
  "",
  'The owner, in session: "a ticket is the only way in, so its shape is where intent survives".',
  "",
  "## Done when",
  "",
  "- Filing a misshapen body files nothing and names each defect.",
  "",
].join("\n");

export const misshapenSpec = "## Nothing to slice\n";

export const wellFormedBug = [
  "## Why",
  "",
  "The Signals of session 7a2c read:",
  "",
  '> hookkit: check-gate crashed 3 times: "TypeError: Cannot read properties of undefined (reading \'steps\')"',
  "",
  "## Done when",
  "",
  "- check-gate reads a contract with no steps and says so instead of crashing.",
  "",
].join("\n");

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
  "## I'll know it works when I can",
  "",
  "- [ ] see a spec land as its own issue, labelled spec",
  "",
].join("\n");

export function filing({
  gh,
  body,
  title = "A ticket the machine can build",
  sessionId,
}: {
  gh: string;
  body: string;
  title?: string;
  sessionId?: string;
}) {
  const root = scratch("file-issue-");
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, "body.md"), body);
  script(join(root, "bin", "gh"), gh);
  return {
    repo,
    run: (args = ["build", "--title", title, "--body-file", "body.md"]) =>
      execute(join(BIN, "file-issue"), repo, { PATH: `${join(root, "bin")}:${process.env.PATH}`, ...(sessionId === undefined ? {} : { CLAUDE_CODE_SESSION_ID: sessionId }) }, args),
  };
}

export function cloned(root: string, ...commits: string[]) {
  return clonedOn(root, "main", commits);
}

function clonedOn(root: string, defaultBranch: string, commits: string[]) {
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

export function agedLogs(logs: string, tool: string) {
  mkdirSync(logs, { recursive: true });
  const stale = join(logs, `${tool}-0000000-old.log`);
  const fresh = join(logs, `${tool}-1111111-new.log`);
  writeFileSync(stale, "old failure");
  writeFileSync(fresh, "new failure");
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(stale, eightDaysAgo, eightDaysAgo);
  return { stale, fresh };
}

export const LANDED_PR = "https://github.com/collod873/claude-workflow/pull/1";
export const MERGE_REFUSAL = "GraphQL: Pull Request is not mergeable (mergePullRequest)";
export const MAIN_RACED = "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)";
export const GITHUB_ERRED = "GraphQL: Something went wrong while executing your query. Please include `C0B4:2D8E:1A2B3C:1D4E5F:671234AB` when reporting this issue.";

const REFUSALS = { refused: MERGE_REFUSAL, raced: MAIN_RACED, erred: GITHUB_ERRED };

export type Merge = "merged" | "mergedErred" | keyof typeof REFUSALS;

export const TICKET_TITLE = "Build what the ticket asks";

function landedBeside(root: string, remote: string, files: Record<string, string>): string {
  const elsewhere = join(root, "elsewhere");
  git(root, "clone", "--quiet", remote, elsewhere);
  for (const [path, content] of Object.entries(files)) plant(elsewhere, path, content);
  git(elsewhere, "add", "-A");
  git(elsewhere, "-c", "user.email=other@test", "-c", "user.name=other", "commit", "--quiet", "--allow-empty", "-m", "another session landed");
  git(remote, "fetch", "--quiet", elsewhere, "HEAD");
  return git(elsewhere, "rev-parse", "HEAD");
}

export function landSession({
  gh,
  remoteRefuses,
  messages = ["change"],
  merges = ["merged"],
  views = ["BLOCKED"],
  mainMovesOnRefusal,
  rounds = "3",
  covered = true,
  green = true,
  changes = {},
  defaultBranch = "main",
  openPr = false,
  treeNode = false,
}: { gh?: string; remoteRefuses?: string; messages?: string[]; merges?: Merge[]; views?: string[]; mainMovesOnRefusal?: Record<string, string>; rounds?: string; covered?: boolean; green?: boolean; changes?: Record<string, string>; defaultBranch?: string; openPr?: boolean; treeNode?: boolean } = {}) {
  const root = scratch("land-");
  const { remote, session } = clonedOn(root, defaultBranch, ["base"]);
  git(remote, "config", "user.email", "github@test");
  git(remote, "config", "user.name", "github");
  for (const [path, content] of Object.entries(changes)) plant(session, path, content);
  if (Object.keys(changes).length > 0) git(session, "add", "-A");
  for (const message of messages) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
  const movedMain = mainMovesOnRefusal === undefined ? undefined : landedBeside(root, remote, mainMovesOnRefusal);
  if (remoteRefuses !== undefined) script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\ncat >&2 <<'REFUSAL'\n${remoteRefuses}\nREFUSAL\nexit 1\n`);
  const state = join(root, "gh-state");
  mkdirSync(state);
  const log = join(state, "argv.jsonl");
  const counted = (name: string) => `$(( $(ls ${JSON.stringify(state)} | grep -c ${name}-) + 1 ))`;
  script(
    join(root, "bin", "gh"),
    gh ??
      [
        `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}`,
        `remote=${JSON.stringify(remote)}`,
        `merges=(${merges.join(" ")})`,
        `views=(${views.join(" ")})`,
        'case "$1 $2" in',
        `  "issue view") echo ${JSON.stringify(TICKET_TITLE)} ;;`,
        ...(openPr
          ? ['  "pr list") echo ' + LANDED_PR + " ;;", `  "pr create") printf 'a pull request for branch "%s" into branch "${defaultBranch}" already exists:\\n%s\\n' "$5" ${LANDED_PR} >&2; exit 1 ;;`]
          : [`  "pr create") echo ${LANDED_PR} ;;`]),
        '  "api -X")',
        "    sha=${4##*/}",
        '    git -C "$remote" cat-file -e "$sha^{commit}" 2>/dev/null || { printf "gh: No commit found for SHA: %s (HTTP 422)\\n" "$sha" >&2; exit 1; }',
        "    ;;",
        '  "pr view")',
        `    n=${counted("view")}; touch ${JSON.stringify(state)}/view-$n`,
        "    (( n > ${#views[@]} )) && n=${#views[@]}",
        '    echo "${views[n - 1]}"',
        "    ;;",
        '  "pr close")',
        '    for arg in "$@"; do [[ $arg == --delete-branch ]] && git checkout --quiet ' + defaultBranch + ' 2>/dev/null && git branch --quiet -D "$3"; done',
        "    ;;",
        '  "pr merge")',
        `    n=${counted("merge")}; touch ${JSON.stringify(state)}/merge-$n`,
        "    (( n > ${#merges[@]} )) && n=${#merges[@]}",
        "    if [[ ${merges[n - 1]} == merged* ]]; then",
        "      for (( at = 1; at <= $#; at++ )); do [[ ${!at} == --match-head-commit ]] && { next=$(( at + 1 )); sha=${!next}; }; done",
        `      git -C "$remote" update-ref refs/heads/${defaultBranch} "$(git -C "$remote" commit-tree "$sha^{tree}" -p ${defaultBranch} -p "$sha" -m merged)"`,
        `      [[ \${merges[n - 1]} == mergedErred ]] && { printf '%s\\n' '${GITHUB_ERRED}' >&2; exit 1; }`,
        "    else",
        ...Object.entries(REFUSALS).map(([merge, refusal]) => `      [[ \${merges[n - 1]} == ${merge} ]] && printf '%s\\n' '${refusal}' >&2`),
        ...(movedMain === undefined ? [] : [`      git -C "$remote" update-ref refs/heads/${defaultBranch} ${movedMain}`]),
        "      exit 1",
        "    fi",
        "    ;;",
        "esac",
        "exit 0",
        "",
      ].join("\n"),
  );
  const checks = join(state, "check-calls");
  const covering = covered ? "printf 'check: covered, all 9 steps\\n'" : "printf 'check: due test\\n'\nexit 3";
  const publishing = green ? "printf 'check: green, all 9 steps\\n'" : "printf 'check: red test; log .git/check-logs/test.log\\n'\nexit 1";
  const checkNodes = join(state, "check-nodes");
  const treeBin = join(root, "tree-bin");
  if (treeNode) script(join(treeBin, "node"), "exit 9\n");
  script(join(root, "bin", "check"), `printf '%s\\n' "$*" >>${JSON.stringify(checks)}\ncommand -v node >>${JSON.stringify(checkNodes)}\nif [[ $* == *--publish* ]]; then\n${publishing}\nelse\n${covering}\nfi\n`);
  const head = git(session, "rev-parse", "HEAD");
  return {
    root,
    remote,
    session,
    head,
    branch: `land/${head.slice(0, 12)}`,
    run: (args: string[] = [], from = session) => execute(join(BIN, "land"), from, { PATH: `${join(root, "bin")}:${process.env.PATH}`, LAND_ROUNDS: rounds, LAND_PAUSE_SECONDS: "0", ...(treeNode ? { TREE_PATH: treeBin } : {}) }, args),
    calls: (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []),
    merged: (call: string[]) => call[0] === "pr" && call[1] === "merge",
    posted: (call: string[]) => call[0] === "api" && call[3]?.startsWith("repos/{owner}/{repo}/statuses/") === true,
    checked: () => (existsSync(checks) ? readFileSync(checks, "utf8").trim().split("\n") : []),
    checkedOn: () => (existsSync(checkNodes) ? readFileSync(checkNodes, "utf8").trim().split("\n") : []),
    treeBin,
  };
}

export function plant(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function filedAs(calls: string[][]): { title: string | undefined; labels: string[]; body: string | undefined; then: string[][] } {
  const [call = [], ...then] = calls;
  return { title: call[call.indexOf("--title") + 1], labels: call.filter((_, at) => call[at - 1] === "--label"), body: call[call.indexOf("--body") + 1], then };
}

export function ghArgv(dir: string): { setup: string; calls: () => string[][] } {
  mkdirSync(dir, { recursive: true });
  return {
    setup: `n=$(( $(ls "${dir}" 2>/dev/null | wc -l) + 1 ))\nprintf '%s\\0' "$@" >"${dir}/$n"`,
    calls: () => readdirSync(dir).map((_, index) => readFileSync(join(dir, String(index + 1)), "utf8").split("\0").filter((part) => part !== "")),
  };
}

export const nulSplit = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\0").filter((said) => said !== "") : []);

export const schemaIn = (argv: string[]) => JSON.parse(argv[argv.indexOf("--json-schema") + 1] ?? "{}") as { required: string[]; properties: Record<string, { items?: { required: string[]; properties: Record<string, { enum?: string[] }> } }> };

export const createdIssues = (calls: string[][]) =>
  calls.filter((args) => args[0] === "issue" && args[1] === "create").map((args) => ({ title: args[args.indexOf("--title") + 1], body: args[args.indexOf("--body") + 1], labels: args.flatMap((arg, at) => (args[at - 1] === "--label" ? [arg] : [])) }));

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

export function openedCases(root: string, opener: string, body: string, parent: Parent, ticket = "811"): string[] {
  plant(root, "opened.json", JSON.stringify({ number: Number(ticket), user: { login: opener }, body }));
  return [`  *"api"*"issues/${ticket}/parent") ${parentSays(root, parent)} ;;`, `  *"api"*"issues/${ticket}") cat "${join(root, "opened.json")}" ;;`];
}

export const gitRefusing = (root: string, unreadable: string) =>
  script(join(root, "bin", "git"), `case "$*" in\n  ${unreadable}) printf 'fatal: unable to read\\n' >&2; exit 128 ;;\nesac\nPATH="\${PATH#*:}" exec git "$@"\n`);

function parentSays(root: string, parent: Parent): string {
  plant(root, "parent.json", JSON.stringify(parent ?? {}));
  if (parent === undefined) return "printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1";
  if (parent === "unreadable") return "printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1";
  return `cat "${join(root, "parent.json")}"`;
}

export function marking({ gh = "", labels = {}, pr = "", repo = [] }: { gh?: string; labels?: Record<string, string[]>; pr?: string; repo?: string[] } = {}) {
  const root = scratch("mark-");
  const calls = join(root, "gh-calls");
  const held = (number: string) => join(root, "labels", number);
  mkdirSync(join(root, "labels"));
  for (const [number, names] of Object.entries(labels)) writeFileSync(held(number), names.map((name) => `${name}\n`).join(""));
  writeFileSync(join(root, "repo"), repo.map((name) => `${name} ededed\n`).join(""));
  script(
    join(root, "bin", "gh"),
    [
      `printf '%s\\n' "$*" >>"${calls}"`,
      gh,
      `dir="${root}"`,
      'if [[ $1 == label && $2 == create ]]; then grep -q "^$3 " "$dir/repo" && exit 1; printf \'%s %s\\n\' "$3" "$5" >>"$dir/repo"; exit 0; fi',
      `[[ $1 == pr && $2 == list ]] && { printf '%s' '${pr}'; exit 0; }`,
      "[[ $1 == api ]] || exit 0",
      "if [[ $2 == -X ]]; then method=$3 path=$4; shift 4; else method=GET path=$2; shift 2; fi",
      'number=${path#repos/?owner?/?repo?/issues/}; number=${number%%/*}; file="$dir/labels/$number"; touch "$file"',
      "case $method in",
      '  GET) cat "$file" ;;',
      '  POST) while (($#)); do [[ $1 == -f ]] && printf \'%s\\n\' "${2#labels[]=}" >>"$file"; shift; done ;;',
      '  DELETE) grep -vxF "${path##*/}" "$file" >"$file.left"; mv "$file.left" "$file" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  return {
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trimEnd().split("\n") : []),
    labels: (number: string) => (existsSync(held(number)) ? readFileSync(held(number), "utf8").split("\n").filter(Boolean).sort() : []),
    made: () => readFileSync(join(root, "repo"), "utf8").split("\n").filter(Boolean),
    run: (...args: string[]) => execute(join(BIN, "mark"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args),
  };
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
    comments: () => calls().filter((args) => args[1] === "comment").map((args) => args[args.indexOf("--body") + 1]),
  };
}

export function sessionExtras({
  gh = "exit 0\n",
  npm = "exit 0\n",
  mainMoves = "moved.txt",
  live = 0,
}: { gh?: string; npm?: string; mainMoves?: string; live?: number } = {}) {
  const root = scratch("session-extras-");
  const { remote, session: main } = cloned(root, "base");
  const was = git(main, "rev-parse", "HEAD");
  const other = join(root, "other");
  git(root, "clone", "--quiet", remote, other);
  git(other, "config", "user.email", "other@test");
  git(other, "config", "user.name", "other");
  plant(other, mainMoves, "moved\n");
  git(other, "add", mainMoves);
  git(other, "commit", "--quiet", "-m", "a merge since the last session");
  git(other, "push", "--quiet", "origin", "main");
  git(main, "pull", "--quiet", "--ff-only", "origin", "main");
  const installed = join(root, "npm");
  script(join(root, "bin", "npm"), `printf '%s\\n' "$PWD" "$@" >"${installed}"\n${npm}`);
  script(join(root, "bin", "gh"), gh);
  return {
    main,
    npm: () => (existsSync(installed) ? readFileSync(installed, "utf8").trimEnd().split("\n") : undefined),
    run: () => execute(join(BIN, "session-extras"), main, { PATH: `${join(root, "bin")}:${process.env.PATH}`, SESSION_MAIN_WAS: was, SESSION_LIVE: String(live) }, []),
  };
}

export const ENROLLED = "collod873/Next";
export const PC_RUNS_ON = "${{ vars.CI_RUNNER || 'ubuntu-latest' }}";
export const QUICK_RUNS_ON = "${{ vars.QUICK_RUNNER || vars.CI_RUNNER || 'ubuntu-latest' }}";
export const CI_ON_EVERY_PR = ["name: Gate", "on:", "  pull_request:", "jobs:", "  check:", `    runs-on: ${PC_RUNS_ON}`, "    steps:", "      - run: check --full", ""].join("\n");
export const checkJobRule = () => (/^ {2}check:\n((?: {4}.*\n)+?) {4}runs-on:/m.exec(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "check.yml"), "utf8"))?.[1] ?? "").trimEnd().split("\n");
export const ci = () => CI_ON_EVERY_PR.replace("  check:\n", ["  check:", ...checkJobRule(), ""].join("\n"));
export const DEPLOY = ["name: Deploy", "on:", "  push:", "jobs:", "  ship:", `    runs-on: ${PC_RUNS_ON}`, "    steps:", "      - run: ./ship", ""].join("\n");
let appKey: { publicKey: string; privateKey: string } | undefined;
const appKeys = () => (appKey ??= generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }));
export const key = () => appKeys().privateKey;

interface Held {
  repo: string;
  id: number;
  allow_auto_merge: boolean;
  files: Record<string, string>;
  branches: Record<string, Record<string, string>>;
  prs: { number: number; head: string; auto: boolean }[];
  pending: boolean;
  selection: string;
  reached: string[];
  variables: string[];
  secrets: string[];
  dependabot: string[];
  labels: string[];
  appKey: string;
  rules: { type: string; ruleset_id?: number; parameters?: unknown }[];
  refused: Record<string, string>;
  writes: string[][];
}

const FAKE_GH = String.raw`
const fs = require("node:fs");
const path = process.env.HELD;
const held = JSON.parse(fs.readFileSync(path, "utf8"));
const args = process.argv.slice(2);
const said = args.join(" ");
const save = () => fs.writeFileSync(path, JSON.stringify(held));
const out = (value) => process.stdout.write(JSON.stringify(value));
const refusal = Object.keys(held.refused).find((pattern) => said.includes(pattern));
const wrote = () => { held.writes.push(args); save(); };
if (refusal !== undefined) { wrote(); process.stderr.write(held.refused[refusal] + "\n"); process.exit(1); }
const flag = (name) => args[args.indexOf(name) + 1];
const method = args.includes("-X") ? flag("-X") : "GET";
const route = args.find((arg, at) => at > 0 && !arg.startsWith("-") && !["-X", "-H", "-f", "-F", "--input"].includes(args[at - 1]));
const fields = Object.fromEntries(args.flatMap((arg, at) => (["-f", "-F"].includes(args[at - 1]) ? [arg.split(/=(.*)/s).slice(0, 2)] : [])));
const stdin = () => fs.readFileSync(0, "utf8");
const repo = held.repo;
const contents = "repos/" + repo + "/contents/";
if (args[0] === "api" && method === "GET" && route === "repos/" + repo) out({ id: held.id, allow_auto_merge: held.allow_auto_merge, default_branch: "main" });
else if (args[0] === "api" && method === "PATCH" && route === "repos/" + repo) { wrote(); held.allow_auto_merge = fields.allow_auto_merge === "true"; save(); out({}); }
else if (args[0] === "api" && method === "GET" && route.startsWith(contents)) {
  const [file, ref] = route.slice(contents.length).split("?ref=");
  const files = ref === undefined ? held.files : held.branches[ref] ?? {};
  const listed = Object.keys(files).filter((held) => held.startsWith(file + "/"));
  if (files[file] === undefined && listed.length > 0) out(listed.map((held) => ({ path: held, type: "file" })));
  else if (files[file] === undefined) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  else out({ path: file, sha: "sha-" + file.length, content: Buffer.from(files[file]).toString("base64") });
}
else if (args[0] === "api" && method === "PUT" && route.startsWith(contents)) {
  wrote();
  const branch = fields.branch;
  if (branch === undefined && held.rules.some(({ type }) => type === "pull_request")) { process.stderr.write("gh: Repository rule violations found\n"); process.exit(1); }
  (branch === undefined ? held.files : held.branches[branch])[route.slice(contents.length)] = Buffer.from(fields.content, "base64").toString("utf8");
  save();
  out({});
}
else if (args[0] === "api" && method === "DELETE" && route.startsWith(contents)) {
  wrote();
  const branch = fields.branch;
  if (branch === undefined && held.rules.some(({ type }) => type === "pull_request")) { process.stderr.write("gh: Repository rule violations found\n"); process.exit(1); }
  delete (branch === undefined ? held.files : held.branches[branch])[route.slice(contents.length)];
  save();
  out({});
}
else if (args[0] === "api" && method === "GET" && route === "repos/" + repo + "/git/ref/heads/main") out({ object: { sha: "main-sha" } });
else if (args[0] === "api" && method === "POST" && route === "repos/" + repo + "/git/refs") {
  wrote();
  const branch = fields.ref.replace("refs/heads/", "");
  if (held.branches[branch] !== undefined) { process.stderr.write("gh: Reference already exists (HTTP 422)\n"); process.exit(1); }
  held.branches[branch] = { ...held.files };
  save();
  out({});
}
else if (args[0] === "api" && method === "PATCH" && route.startsWith("repos/" + repo + "/git/refs/heads/")) { wrote(); held.branches[route.slice(("repos/" + repo + "/git/refs/heads/").length)] = { ...held.files }; save(); out({}); }
else if (args[0] === "api" && method === "DELETE" && route.startsWith("repos/" + repo + "/git/refs/heads/")) { wrote(); delete held.branches[route.slice(("repos/" + repo + "/git/refs/heads/").length)]; save(); }
else if (args[0] === "pr" && args[1] === "list") out(held.prs.filter(({ head }) => head === flag("--head")).map(({ number }) => ({ number, url: "https://github.com/" + repo + "/pull/" + number })));
else if (args[0] === "pr" && args[1] === "close") { wrote(); held.prs = held.prs.filter(({ head }) => head !== args[2]); if (args.includes("--delete-branch")) delete held.branches[args[2]]; save(); }
else if (args[0] === "pr" && args[1] === "create") { wrote(); const number = 900 + held.prs.length; held.prs.push({ number, head: flag("--head"), auto: false }); save(); process.stdout.write("https://github.com/" + repo + "/pull/" + number + "\n"); }
else if (args[0] === "pr" && args[1] === "merge") {
  wrote();
  const pr = held.prs.find(({ number, head }) => String(number) === args[2] || head === args[2]);
  if (pr === undefined || !held.allow_auto_merge || !args.includes("--auto")) { process.stderr.write("GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)\n"); process.exit(1); }
  pr.auto = true;
  if (held.pending) { save(); process.exit(0); }
  held.files = { ...held.branches[pr.head] };
  held.prs = held.prs.filter((open) => open !== pr);
  delete held.branches[pr.head];
  save();
}
else if (args[0] === "api" && route.startsWith("user/installations") && method === "GET") { process.stderr.write("gh: You must authenticate with an access token authorized to a GitHub App in order to list installations (HTTP 403)\n"); process.exit(1); }
else if (args[0] === "api" && (route === "repos/" + repo + "/installation" || route === "users/collod873/installation")) {
  const bearer = (args.find((arg) => arg.startsWith("Authorization: Bearer ")) ?? "").slice("Authorization: Bearer ".length);
  const [head, body, signature] = bearer.split(".");
  const signed = signature !== undefined && require("node:crypto").verify("RSA-SHA256", Buffer.from(head + "." + body), held.appKey, Buffer.from(signature, "base64url"));
  const claims = signed ? JSON.parse(Buffer.from(body, "base64url").toString("utf8")) : {};
  if (!signed || claims.iss !== "Iv23client" || claims.exp <= Date.now() / 1000) { process.stderr.write("gh: A JSON web token could not be decoded (HTTP 401)\n"); process.exit(1); }
  if (route.startsWith("repos/") && held.selection !== "all" && !held.reached.includes(repo)) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out({ id: 77, repository_selection: held.selection });
}
else if (args[0] === "api" && method === "PUT" && route === "user/installations/77/repositories/" + held.id) {
  wrote();
  if (args.some((arg) => arg.startsWith("Authorization:"))) { process.stderr.write("gh: This endpoint only works for PATs (classic) (HTTP 403)\n"); process.exit(1); }
  held.reached.push(repo);
  save();
}
else if (args[0] === "api" && route === "apps/${MACHINE.replace("[bot]", "")}") out({ client_id: "Iv23client" });
else if (args[0] === "api" && route === "repos/" + repo + "/rules/branches/main") out(held.rules);
else if (args[0] === "api" && method === "POST" && route === "repos/" + repo + "/rulesets") { wrote(); held.rules.push(...JSON.parse(stdin()).rules); held.writes.at(-1).push("ruleset"); save(); out({}); }
else if (args[0] === "api" && method === "GET" && route.startsWith("repos/" + repo + "/rulesets/")) {
  const id = Number(route.split("/").at(-1));
  const rules = held.rules.filter((rule) => rule.ruleset_id === id);
  if (rules.length === 0) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out({ id, name: "main lands only through a PR", target: "branch", enforcement: "active", conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } }, rules });
}
else if (args[0] === "api" && method === "PUT" && route.startsWith("repos/" + repo + "/rulesets/")) {
  wrote();
  const id = Number(route.split("/").at(-1));
  held.rules = [...held.rules.filter((rule) => rule.ruleset_id !== id), ...JSON.parse(stdin()).rules.map((rule) => ({ ...rule, ruleset_id: id }))];
  held.writes.at(-1).push("ruleset");
  save();
  out({});
}
else if (args[0] === "api" && method === "DELETE" && route.startsWith("repos/" + repo + "/rulesets/")) {
  wrote();
  const id = Number(route.split("/").at(-1));
  held.rules = held.rules.filter((rule) => rule.ruleset_id !== id);
  held.writes.at(-1).push("ruleset");
  save();
}
else if (args[0] === "variable" && args[1] === "list") out(held.variables.map((name) => ({ name })));
else if (args[0] === "variable" && args[1] === "set") { wrote(); held.variables.push(args[2]); save(); }
else if (args[0] === "secret" && args[1] === "list") out((args.includes("dependabot") ? held.dependabot : held.secrets).map((name) => ({ name })));
else if (args[0] === "secret" && args[1] === "set") { wrote(); held.writes.at(-1).push("value " + stdin()); (args.includes("dependabot") ? held.dependabot : held.secrets).push(args[2]); save(); }
else if (args[0] === "label" && args[1] === "list") out(held.labels.map((name) => ({ name })));
else if (args[0] === "label" && args[1] === "create") { wrote(); held.labels.push(args[2]); save(); }
else if (args[0] === "label" && args[1] === "delete") { wrote(); held.labels = held.labels.filter((name) => name !== args[2]); save(); }
else { process.stderr.write("fake gh: unknown call " + said + "\n"); process.exit(9); }
`;

export function bare(extra: Partial<Held> = {}): Held {
  return {
    repo: ENROLLED,
    id: 4242,
    allow_auto_merge: false,
    files: { ".github/workflows/ci.yml": ci(), ".github/workflows/deploy.yml": DEPLOY },
    branches: {},
    prs: [],
    pending: false,
    selection: "selected",
    reached: ["collod873/claude-workflow"],
    variables: [],
    secrets: [],
    dependabot: [],
    labels: ["bug"],
    appKey: appKeys().publicKey,
    rules: [],
    refused: {},
    writes: [],
    ...extra,
  };
}

export const HOME = `${OWNER}/claude-workflow`;
const HOME_RULES: Held["rules"] = [
  { type: "pull_request", ruleset_id: 3 },
  { type: "required_status_checks", ruleset_id: 3, parameters: { strict_required_status_checks_policy: true, required_status_checks: [{ context: "check" }, { context: "review" }] } },
];
export const home = () =>
  bare({
    repo: HOME,
    allow_auto_merge: true,
    rules: HOME_RULES,
    files: Object.fromEntries([".github/workflows/check.yml", ".github/workflows/machine.yml", ".github/workflows/tickets.yml"].map((path) => [path, readFileSync(join(SRC, "..", path), "utf8")])),
  });

export function enrolling(held: Held, env: Record<string, string> = { CORE_APP_PRIVATE_KEY: key(), CLAUDE_CODE_OAUTH_TOKEN: "sk-token" }) {
  const root = scratch("enrol-");
  const state = join(root, "held.json");
  writeFileSync(state, JSON.stringify(held));
  writeFileSync(join(root, "gh"), `#!/usr/bin/env node\n${FAKE_GH}`);
  chmodSync(join(root, "gh"), 0o755);
  const now = () => JSON.parse(readFileSync(state, "utf8")) as Held;
  return {
    run: (...args: string[]) => execute(join(BIN, "enrol"), root, { PATH: `${root}:${process.env.PATH}`, HELD: state, CORE_APP_PRIVATE_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "", ...env }, args.length === 0 ? [held.repo] : args),
    held: now,
    writes: () => now().writes.map((args) => args.slice(0, 3).join(" ")),
  };
}

export function githubCall(refusals: string[], args = ["issue", "edit", "1202", "--add-label", "landing"]) {
  const root = scratch("github-");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  script(
    join(root, "bin", "gh"),
    [setup, `refusals=(${refusals.map((refusal) => `'${refusal}'`).join(" ")})`, "refusal=${refusals[$((n - 1))]:-}", '[[ -z $refusal ]] && { printf "answered\\n"; exit 0; }', 'printf "partial\\n"', 'printf "%s\\n" "$refusal" >&2', "exit 1", ""].join("\n"),
  );
  const run = () => execute(join(BIN, "github"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, GH_RETRY_SECONDS: "0" }, args);
  return { run, calls };
}
export const PC_REPO = "collod873/Lumaria";
export const PC_HOST = hostname().toLowerCase();
export const PC_RUNNER_COUNT = 2;
export const QUICK_RUNNER_COUNT = 8;

const runnerId = (name: string) => [...name].reduce((sum, char) => sum + char.charCodeAt(0), 0);
export const pcRunner = (name: string, status = "online", busy = false, labels = ["pc", "pc-quick"]) => ({ id: runnerId(name), name, status, busy, labels: ["self-hosted", ...labels].map((label) => ({ name: label })) });
export const quickRunners = () => Array.from({ length: QUICK_RUNNER_COUNT }, (_, at) => pcRunner(`${PC_HOST}-quick-${at + 1}`, "online", false, ["pc-quick"]));

export function switching({ isPrivate = true, runners = [] as object[], variable = "", quickVariable = "", startsOnline = true, slowToStart = [] as string[], stoppedByHand = [] as string[], manyJobs = [] as string[], userExists = true, neighbours = [] as { unit: string; slice: string; cpus: string }[] } = {}) {
  const root = scratch("runner-");
  const at = (name: string) => join(root, name);
  writeFileSync(at("runners.json"), JSON.stringify({ runners }));
  if (variable !== "") writeFileSync(at("variable-CI_RUNNER"), variable);
  if (quickVariable !== "") writeFileSync(at("variable-QUICK_RUNNER"), quickVariable);
  script(
    at("bin/gh"),
    [
      `printf '%s\\n' "$*" >>"${at("gh-calls")}"`,
      'case "$*" in',
      `  "api repos/${PC_REPO}/actions/runners") cat "${at("runners.json")}" ;;`,
      `  "api -X POST repos/${PC_REPO}/actions/runners/"*/labels*) id=\${4#repos/${PC_REPO}/actions/runners/}; jq -c --argjson id "\${id%/labels}" --arg label "\${@: -1}" '.runners |= map(if .id == $id then .labels += [{name: ($label | ltrimstr("labels[]="))}] else . end)' "${at("runners.json")}" >"${at("runners.next")}" && mv "${at("runners.next")}" "${at("runners.json")}" ;;`,
      `  "api repos/${PC_REPO}") printf '{"private":${isPrivate}}\\n' ;;`,
      `  "variable get"*) [ -f "${at("variable-")}$3" ] || { printf 'variable %s was not found\\n' "$3" >&2; exit 1; }; cat "${at("variable-")}$3" ;;`,
      `  "variable set"*) printf '%s' "\${@: -1}" >"${at("variable-")}$3" ;;`,
      `  "variable delete"*) rm "${at("variable-")}$3" ;;`,
      '  *cli/cli/releases/latest*) printf "v2.96.0\\n" ;;',
      '  *releases/latest*) printf "v2.330.0\\n" ;;',
      '  *registration-token*) printf "TOKEN\\n" ;;',
      "esac",
      "",
    ].join("\n"),
  );
  mkdirSync(at("placed"));
  script(
    at("bin/sudo"),
    [
      `printf '%s\\n' "$*" >>"${at("sudo-calls")}"`,
      "if [[ $* =~ cat\\ \\>([^ ]+)\\.next ]]; then",
      `  kept="${at("placed")}/\${BASH_REMATCH[1]//\\//_}"`,
      '  cat >"$kept.next"',
      '  cmp -s "$kept.next" "$kept" || echo changed',
      "elif [[ $* =~ mv\\ ([^ ]+)\\.next ]]; then",
      `  kept="${at("placed")}/\${BASH_REMATCH[1]//\\//_}"`,
      '  mv "$kept.next" "$kept"',
      "fi",
      `[[ $* == *"${at("proc")}/"* ]] && exec "$@"`,
      "started='runners/[^/ ]+/([^ /]+) && .*svc\\.sh start'",
      `if ${startsOnline} && [[ $* =~ $started ]] && [[ " ${slowToStart.join(" ")} " != *" \${BASH_REMATCH[1]} "* ]]; then`,
      `  jq -c --arg name "\${BASH_REMATCH[1]}" '.runners |= (map(select(.name != $name)) + [{id: ($name | explode | add), name: $name, status: "online", busy: false, labels: ([{name: "self-hosted"}] + (if ($name | test("-quick-")) then [{name: "pc-quick"}] else [{name: "pc"}, {name: "pc-quick"}] end))}])' "${at("runners.json")}" >"${at("runners.next")}"`,
      `  mv "${at("runners.next")}" "${at("runners.json")}"`,
      "fi",
      "",
    ].join("\n"),
  );
  script(at("bin/id"), `exit ${userExists ? 0 : 1}\n`);
  for (const [pid, environ] of [["1", "ACTIONS_RUNNER_INPUT_ONCE=true"], ["2", "LANG=C.UTF-8"]]) {
    mkdirSync(at(`proc/${pid}`), { recursive: true });
    writeFileSync(at(`proc/${pid}/environ`), `HOME=/home/ghrunner\0${environ}\0`);
  }
  const manyJobsUnits = manyJobs.map((name) => `actions.runner.${PC_REPO.replace("/", "-")}.${name}.service`).join(" ");
  writeFileSync(at("units"), neighbours.map(({ unit, slice, cpus }) => `Id=${unit}\nSlice=${slice}\nAllowedCPUs=${cpus}\n`).join("\n"));
  script(at("bin/systemctl"), `if [[ $* == "show --property Id,Slice,AllowedCPUs actions.runner.*" ]]; then cat "${at("units")}"; exit 0; fi\nif [[ $1 == show ]]; then [[ " ${manyJobsUnits} " == *" \${@: -1} "* ]] && echo 2 || echo 1; exit 0; fi\nfor name in ${stoppedByHand.join(" ")}; do [[ \${@: -1} == *".$name.service" ]] && exit 3; done\nexit 0\n`);
  script(at("bin/curl"), "printf '%s\\n' '[{\"version\":\"v25.1.0\",\"lts\":false},{\"version\":\"v24.11.0\",\"lts\":\"Krypton\"}]'\n");
  script(at("bin/sleep"), "");
  script(at("bin/nproc"), "printf '16\\n'\n");
  const lines = (name: string) => (existsSync(at(name)) ? readFileSync(at(name), "utf8").trim().split("\n") : []);
  return {
    run: (...args: string[]) => execute(join(BIN, "runner"), root, { PATH: `${at("bin")}:${process.env.PATH}`, RUNNER_WAIT_SECONDS: "0", RUNNER_PROC: at("proc") }, [PC_REPO, ...args]),
    variable: () => (existsSync(at("variable-CI_RUNNER")) ? readFileSync(at("variable-CI_RUNNER"), "utf8") : undefined),
    runners: () => (JSON.parse(readFileSync(at("runners.json"), "utf8")) as { runners: { name: string; status: string; labels: { name: string }[] }[] }).runners,
    quickVariable: () => (existsSync(at("variable-QUICK_RUNNER")) ? readFileSync(at("variable-QUICK_RUNNER"), "utf8") : undefined),
    sudo: () => lines("sudo-calls"),
    gh: () => lines("gh-calls"),
    jobStarted: (name: string) => writeFileSync(at("runners.json"), JSON.stringify({ runners: (JSON.parse(readFileSync(at("runners.json"), "utf8")) as { runners: { name: string }[] }).runners.map((runner) => ({ ...runner, busy: runner.name === name })) })),
    jobsEnded: () => writeFileSync(at("runners.json"), JSON.stringify({ runners: (JSON.parse(readFileSync(at("runners.json"), "utf8")) as { runners: object[] }).runners.map((runner) => ({ ...runner, busy: false })) })),
    placed: (path: string) => readFileSync(join(at("placed"), path.replaceAll("/", "_")), "utf8"),
  };
}

export function onPath(tool: string): string {
  const dir = (process.env.PATH ?? "").split(":").find((folder) => existsSync(join(folder, tool)));
  if (dir === undefined) throw new Error(`${tool} is not on PATH`);
  return realpathSync(join(dir, tool));
}
