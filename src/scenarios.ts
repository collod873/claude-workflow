import { execFile, execFileSync, spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, matchesGlob } from "node:path";
import { parse } from "yaml";
import { onTestFinished } from "vitest";
import vitest from "../vitest.config.ts";
import { MACHINE, OWNER } from "./spelled.ts";

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
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST") && name !== "REASON" && name !== "TREE_PATH")), AGENT_HOOKS_SETTINGS: "", AGENT_SKILLS: "", GH_RETRY_SECONDS: "0" };

export interface WorkflowStep {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
  "timeout-minutes"?: number;
}

interface WorkflowJob {
  if?: string;
  env?: Record<string, unknown>;
  needs?: string | string[];
  permissions?: Record<string, string>;
  "cache-mode"?: string;
  "timeout-minutes"?: number;
  concurrency?: unknown;
  steps: WorkflowStep[];
}

export interface IssueEvent {
  event?: string;
  labels?: string[];
  sender?: string;
  action?: string;
  label?: string;
  head?: string;
  fork?: boolean;
  state?: string;
}

export const workflowJobs = (file: string) => (parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, WorkflowJob> }).jobs;

export function labelledStep(file: string, job: string): WorkflowStep {
  const step = workflowJobs(file)[job]?.steps.find(({ id }) => id === "labelled");
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

const HELD = new Map<string, ReturnType<typeof heldBy>>();

export async function starts(file: string, gated: string, event: IssueEvent): Promise<boolean> {
  const job = workflowJobs(file)[gated];
  if (job === undefined) throw new Error(`no ${gated} job in ${file}`);
  const { labels, ...rest } = event;
  if (!holds(job.if ?? "true", rest)) return false;
  const seen = `${file} ${gated} ${JSON.stringify([labels, rest.action, rest.label, rest.head])}`;
  const heard = HELD.get(seen) ?? heldBy(labelledStep(file, gated), join(SRC, ".."), { ...rest, labels, sender: OWNER });
  HELD.set(seen, heard);
  const { failed, held } = await heard;
  if (failed || held === undefined) throw new Error(`the labelled step of ${file} ended red on ${JSON.stringify(labels)}`);
  const [next] = afterLabelled(job.steps);
  return holds(next?.if ?? "success()", { steps: labelledAs(job.steps, held) });
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
    fork = false,
    event = "issues",
    conclusion = "",
    own = false,
    inputs = {},
  }: {
    labels?: string[];
    steps?: Record<string, StepOutcome>;
    needs?: Record<string, { result: string; outputs?: Record<string, string> }>;
    failed?: boolean;
    cancelled?: boolean;
    sender?: string;
    body?: string;
    action?: string;
    label?: string;
    head?: string;
    fork?: boolean;
    event?: string;
    conclusion?: string;
    own?: boolean;
    inputs?: Record<string, string>;
  },
): boolean {
  const bare = condition.replace(/^\s*\$\{\{|\}\}\s*$/g, "");
  const source = (/\b(success|failure|always|cancelled)\(\)/.test(bare) ? bare : `success() && (${bare})`)
    .replace(/github\.event_name/g, JSON.stringify(event))
    .replace(/github\.event\.workflow_run\.conclusion/g, JSON.stringify(conclusion))
    .replace(/github\.event\.workflow_run\.name\s*==\s*github\.workflow\b/g, JSON.stringify(own))
    .replace(/github\.event\.workflow_run\.name\s*!=\s*github\.workflow\b/g, JSON.stringify(!own))
    .replace(/github\.event\.workflow_run\.head_repository\.full_name\s*==\s*github\.repository\b/g, JSON.stringify(!fork))
    .replace(/github\.event\.action/g, JSON.stringify(action))
    .replace(/github\.event\.label\.name/g, JSON.stringify(label))
    .replace(/github\.event\.sender\.login/g, JSON.stringify(sender))
    .replace(/github\.head_ref/g, JSON.stringify(head))
    .replace(/github\.event\.pull_request\.head\.repo\.full_name\s*==\s*github\.repository/g, JSON.stringify(!fork))
    .replace(/contains\(\s*github\.event\.issue\.body\s*,\s*('[^']*')\s*\)/g, `${JSON.stringify(body)}.includes($1)`)
    .replace(/github\.repository_owner/g, JSON.stringify(OWNER))
    .replace(/contains\(\s*github\.event\.issue\.labels\.\*\.name\s*,\s*('[^']*')\s*\)/g, "labels.includes($1)")
    .replace(/steps\.([\w-]+)\.(outcome|conclusion)/g, 'steps["$1"].$2')
    .replace(/steps\.([\w-]+)\.outputs\.([\w-]+)/g, '(steps["$1"].outputs ?? {})["$2"]')
    .replace(/contains\(\s*needs\.\*\.result\s*,\s*('[^']*')\s*\)/g, "Object.values(needs).some(({ result }) => result === $1)")
    .replace(/needs\.([\w-]+)\.result/g, 'needs["$1"].result')
    .replace(/needs\.([\w-]+)\.outputs\.([\w-]+)/g, '(needs["$1"].outputs ?? {})["$2"]')
    .replace(/\b(github\.event\.)?inputs\.([\w-]+)/g, 'inputs["$2"]');
  const evaluate = new Function("labels", "steps", "needs", "inputs", "startsWith", "success", "failure", "always", "cancelled", `return Boolean(${source});`) as (...scope: unknown[]) => boolean;
  return evaluate(
    labels,
    steps,
    needs,
    inputs,
    (text: string, start: string) => text.startsWith(start),
    () => !failed && !cancelled,
    () => failed && !cancelled,
    () => true,
    () => cancelled,
  );
}

export function scratch(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function commitAt(cwd: string, date: string, args: string[], committed = date): string {
  return execFileSync("git", args, { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: committed }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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

export const misshapenTicket = [
  "## Why",
  "",
  "The session decided this was worth building \u2014 at once.",
  "",
  "## Done when",
  "",
  "- one \u2014 first",
  "- two \u2014 second",
  "- three \u2014 third",
  "- four \u2014 fourth",
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
    run: (args = ["ticket", "--title", title, "--body-file", "body.md"]) =>
      execute(join(BIN, "file-issue"), repo, { PATH: `${join(root, "bin")}:${process.env.PATH}`, CLAUDE_CODE_SESSION_ID: sessionId ?? "" }, args),
  };
}

export function cloned(root: string, ...commits: string[]) {
  const remote = join(root, "remote.git");
  const session = join(root, "session");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(root, "clone", "--quiet", remote, session);
  git(session, "config", "user.email", "session@test");
  git(session, "config", "user.name", "session");
  for (const message of commits) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
  git(session, "push", "--quiet", "origin", "main");
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

export function landSession({ gh, remoteRefuses, messages = ["change"] }: { gh: string; remoteRefuses?: string; messages?: string[] }) {
  const root = scratch("land-");
  const { remote, session } = cloned(root, "base");
  for (const message of messages) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
  if (remoteRefuses !== undefined) script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\ncat >&2 <<'REFUSAL'\n${remoteRefuses}\nREFUSAL\nexit 1\n`);
  script(join(root, "bin", "gh"), gh);
  return {
    remote,
    session,
    run: (args: string[] = []) => execute(join(BIN, "land"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, LAND_WAIT_SECONDS: "0" }, args),
  };
}

export function plant(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function flagValue(argv: string, flag: string): string {
  const value = argv.split("\n")[argv.split("\n").indexOf(flag) + 1];
  if (value === undefined) throw new Error(`no value after ${flag} in the argv`);
  return value;
}

export function fenceSays(argv: string, input: string) {
  const { hooks } = JSON.parse(flagValue(argv, "--settings")) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
  const [bash] = hooks.PreToolUse.filter(({ matcher }) => matcher === "Bash");
  const command = bash?.hooks[0]?.command;
  if (command === undefined) throw new Error("no Bash hook command in --settings");
  return spawnSync("bash", ["-c", command], { input, encoding: "utf8" });
}

export const askingBash = (command: unknown) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

export const SAVED_PR = "https://github.com/collod873/claude-workflow/pull/9726";

export function ghArgv(dir: string): { setup: string; calls: () => string[][] } {
  mkdirSync(dir, { recursive: true });
  return {
    setup: `n=$(( $(ls "${dir}" 2>/dev/null | wc -l) + 1 ))\nprintf '%s\\0' "$@" >"${dir}/$n"`,
    calls: () => readdirSync(dir).map((_, index) => readFileSync(join(dir, String(index + 1)), "utf8").split("\0").filter((part) => part !== "")),
  };
}

const CONSENT_ONLY_WHY = 'The owner, in session: "a plan carrying its own intent, spoken plainly, at length, right where it was proposed".';

export function saving({
  remoteRefuses,
  alreadyOpen = false,
  autoMergeRefused = false,
  autoMergeOff = false,
  held = "",
  why = CONSENT_ONLY_WHY,
}: {
  remoteRefuses?: string;
  alreadyOpen?: boolean;
  autoMergeRefused?: boolean;
  autoMergeOff?: boolean;
  held?: string;
  why?: string;
} = {}) {
  const root = scratch("save-");
  const { remote, session } = cloned(root, "base");
  const calls = join(root, "gh-calls");
  const argvDir = join(root, "gh-argv");
  const judged = join(root, "judged");
  const { setup, calls: argvCalls } = ghArgv(argvDir);
  const ticketBody = ["## Why", "", why, "", "## Done when", "", "- a fix lands", ""].join("\n");
  git(session, "checkout", "--quiet", "-b", "ticket/726");
  plant(session, "src/ticket-shape.ts", "export const shaped = 2;\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "Build #726 against its failing tests");
  const built = git(session, "rev-parse", "HEAD");
  script(join(session, ".git", "hooks", "pre-push"), `touch "${judged}"\nprintf 'the gate refuses a red build\\n' >&2\nexit 1\n`);
  git(remote, "config", "user.email", "github@test");
  git(remote, "config", "user.name", "github");
  git(remote, "update-ref", "refs/heads/main", git(remote, "commit-tree", "main^{tree}", "-p", "main", "-m", "main moved on"));
  if (remoteRefuses !== undefined) script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\nprintf '%s\\n' '${remoteRefuses}' >&2\nexit 1\n`);
  script(join(root, "bin", "npx"), `touch "${judged}"\nexit 1\n`);
  script(
    join(root, "bin", "gh"),
    [
      `printf '%s|%s\\n' "$(printf '%s' "$*" | tr '\\n' ' ')" "$(git --git-dir="${remote}" rev-parse --verify --quiet refs/heads/ticket/726)" >>"${calls}"`,
      setup,
      'case "$*" in',
      "  *\"issue view\"*\"--json body\"*)",
      "    cat <<'TICKET_BODY'",
      ticketBody,
      "TICKET_BODY",
      "    ;;",
      `  *"issue view"*"--json labels"*) printf 'ticket\\n%s\\n' '${held}' ;;`,
      "  *\"issue view\"*) printf 'Push the branch before anything can refuse it\\n' ;;",
      alreadyOpen ? "  *\"pr create\"*) exit 1 ;;" : `  *"pr create"*) printf '%s\\n' '${SAVED_PR}' ;;`,
      `  *"pr view"*) printf '%s\\n' '${SAVED_PR}' ;;`,
      autoMergeRefused ? "  *\"pr merge\"*) printf 'auto-merge is not enabled for this repository\\n' >&2; exit 1 ;;" : "",
      autoMergeOff ? "  *\"pr merge\"*) printf 'GraphQL: Auto merge is not allowed for this repository (enablePullRequestAutoMerge)\\n' >&2; exit 1 ;;" : "",
      "esac",
      "",
    ].join("\n"),
  );
  return {
    session,
    built,
    pushed: () => git(remote, "for-each-ref", "--format=%(objectname)", "refs/heads/ticket/726"),
    judged: () => existsSync(judged),
    log: () => (existsSync(join(session, ".git", "machine-logs", "save-726.log")) ? readFileSync(join(session, ".git", "machine-logs", "save-726.log"), "utf8") : ""),
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trimEnd().split("\n").map((line) => line.split("|")) : []),
    prBody: () => {
      const call = argvCalls().find((args) => args[0] === "pr" && args[1] === "create");
      const at = call?.indexOf("--body") ?? -1;
      return at === -1 ? undefined : call?.[at + 1];
    },
    run: (ticket = "726") => execute(join(BIN, "save"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

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

export function parentSays(root: string, parent: Parent): string {
  plant(root, "parent.json", JSON.stringify(parent ?? {}));
  if (parent === undefined) return "printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1";
  if (parent === "unreadable") return "printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1";
  return `cat "${join(root, "parent.json")}"`;
}

function onGh(command: string, gh: string) {
  const root = scratch(`${command}-`);
  const calls = join(root, "gh-calls");
  script(join(root, "bin", "gh"), `printf '%s\\n' "$*" >>"${calls}"\n${gh}`);
  return {
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trimEnd().split("\n") : []),
    run: (...args: string[]) => execute(join(BIN, command), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args),
  };
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

export function closingNote(labels: string, { gh = "exit 0\n" }: { gh?: string } = {}) {
  return onGh("close-note", `[[ $2 == view ]] && { printf '${labels}'; exit 0; }\n${gh}`);
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
export const CI = ["name: Gate", "on:", "  pull_request:", "jobs:", "  check:", "    runs-on: ubuntu-latest", "    steps:", "      - run: pnpm check", ""].join("\n");
export const DEPLOY = ["name: Deploy", "on:", "  push:", "jobs:", "  ship:", "    runs-on: ubuntu-latest", "    steps:", "      - run: ./ship", ""].join("\n");
let appKey: { publicKey: string; privateKey: string } | undefined;
const appKeys = () => (appKey ??= generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }));
export const key = () => appKeys().privateKey;

interface Held {
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
  rules: { type: string; parameters?: unknown }[];
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
const repo = "${ENROLLED}";
const contents = "repos/" + repo + "/contents/";
if (args[0] === "api" && method === "GET" && route === "repos/" + repo) out({ id: held.id, allow_auto_merge: held.allow_auto_merge, default_branch: "main" });
else if (args[0] === "api" && method === "PATCH" && route === "repos/" + repo) { wrote(); held.allow_auto_merge = fields.allow_auto_merge === "true"; save(); out({}); }
else if (args[0] === "api" && method === "GET" && route === contents + ".github/workflows") {
  const listed = Object.keys(held.files).filter((file) => file.startsWith(".github/workflows/"));
  if (listed.length === 0) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out(listed.map((file) => ({ path: file, type: "file" })));
}
else if (args[0] === "api" && method === "GET" && route.startsWith(contents)) {
  const [file, ref] = route.slice(contents.length).split("?ref=");
  const files = ref === undefined ? held.files : held.branches[ref] ?? {};
  if (files[file] === undefined) { process.stderr.write("gh: Not Found (HTTP 404)\n"); process.exit(1); }
  out({ path: file, sha: "sha-" + file.length, content: Buffer.from(files[file]).toString("base64") });
}
else if (args[0] === "api" && method === "PUT" && route.startsWith(contents)) {
  wrote();
  const branch = fields.branch;
  if (branch === undefined && held.rules.some(({ type }) => type === "pull_request")) { process.stderr.write("gh: Repository rule violations found\n"); process.exit(1); }
  (branch === undefined ? held.files : held.branches[branch])[route.slice(contents.length)] = Buffer.from(fields.content, "base64").toString("utf8");
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
else if (args[0] === "variable" && args[1] === "list") out(held.variables.map((name) => ({ name })));
else if (args[0] === "variable" && args[1] === "set") { wrote(); held.variables.push(args[2]); save(); }
else if (args[0] === "secret" && args[1] === "list") out((args.includes("dependabot") ? held.dependabot : held.secrets).map((name) => ({ name })));
else if (args[0] === "secret" && args[1] === "set") { wrote(); held.writes.at(-1).push("value " + stdin()); (args.includes("dependabot") ? held.dependabot : held.secrets).push(args[2]); save(); }
else if (args[0] === "label" && args[1] === "list") out(held.labels.map((name) => ({ name })));
else if (args[0] === "label" && args[1] === "create") { wrote(); held.labels.push(args[2]); save(); }
else { process.stderr.write("fake gh: unknown call " + said + "\n"); process.exit(9); }
`;

export function bare(extra: Partial<Held> = {}): Held {
  return {
    id: 4242,
    allow_auto_merge: false,
    files: { ".github/workflows/ci.yml": CI, ".github/workflows/deploy.yml": DEPLOY },
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

export function enrolling(held: Held, env: Record<string, string> = { CORE_APP_PRIVATE_KEY: key(), CLAUDE_CODE_OAUTH_TOKEN: "sk-token" }) {
  const root = scratch("enrol-");
  const state = join(root, "held.json");
  writeFileSync(state, JSON.stringify(held));
  writeFileSync(join(root, "gh"), `#!/usr/bin/env node\n${FAKE_GH}`);
  chmodSync(join(root, "gh"), 0o755);
  const now = () => JSON.parse(readFileSync(state, "utf8")) as Held;
  return {
    run: (...args: string[]) => execute(join(BIN, "enrol"), root, { PATH: `${root}:${process.env.PATH}`, HELD: state, CORE_APP_PRIVATE_KEY: "", CLAUDE_CODE_OAUTH_TOKEN: "", ...env }, args.length === 0 ? [ENROLLED] : args),
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
export const PC_RUNNER_COUNT = 6;

export const pcRunner = (name: string, status = "online", busy = false) => ({ name, status, busy, labels: [{ name: "self-hosted" }, { name: "pc" }] });

export function switching({ isPrivate = true, runners = [] as object[], variable = "", startsOnline = true, userExists = true } = {}) {
  const root = scratch("runner-");
  const at = (name: string) => join(root, name);
  writeFileSync(at("runners.json"), JSON.stringify({ runners }));
  if (variable !== "") writeFileSync(at("variable"), variable);
  const online = JSON.stringify({ runners: Array.from({ length: PC_RUNNER_COUNT }, (_, at) => at + 1).map((n) => pcRunner(`${PC_HOST}-${n}`)) });
  script(
    at("bin/gh"),
    [
      `printf '%s\\n' "$*" >>"${at("gh-calls")}"`,
      'case "$*" in',
      `  "api repos/${PC_REPO}/actions/runners") cat "${at("runners.json")}" ;;`,
      `  "api repos/${PC_REPO}") printf '{"private":${isPrivate}}\\n' ;;`,
      `  "variable get"*) [ -f "${at("variable")}" ] || { printf 'variable CI_RUNNER was not found\\n' >&2; exit 1; }; cat "${at("variable")}" ;;`,
      `  "variable set"*) printf '%s' "\${@: -1}" >"${at("variable")}" ;;`,
      `  "variable delete"*) rm "${at("variable")}" ;;`,
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
      startsOnline ? `case "$*" in *"svc.sh start"*) printf '%s' '${online}' >"${at("runners.json")}" ;; esac` : "",
      "",
    ].join("\n"),
  );
  script(at("bin/id"), `exit ${userExists ? 0 : 1}\n`);
  script(at("bin/curl"), "printf '%s\\n' '[{\"version\":\"v25.1.0\",\"lts\":false},{\"version\":\"v24.11.0\",\"lts\":\"Krypton\"}]'\n");
  script(at("bin/sleep"), "");
  const lines = (name: string) => (existsSync(at(name)) ? readFileSync(at(name), "utf8").trim().split("\n") : []);
  return {
    run: (...args: string[]) => execute(join(BIN, "runner"), root, { PATH: `${at("bin")}:${process.env.PATH}`, RUNNER_WAIT_SECONDS: "0" }, [PC_REPO, ...args]),
    variable: () => (existsSync(at("variable")) ? readFileSync(at("variable"), "utf8") : undefined),
    sudo: () => lines("sudo-calls"),
    gh: () => lines("gh-calls"),
    placed: (path: string) => readFileSync(join(at("placed"), path.replaceAll("/", "_")), "utf8"),
  };
}
