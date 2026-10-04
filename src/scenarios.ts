import { execFile, execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, matchesGlob } from "node:path";
import { parse } from "yaml";
import { onTestFinished } from "vitest";
import vitest from "../vitest.config.ts";

export const LINE_LIMIT = 200;
export const MOST_LINES = 6;

export function overLimit(said: string, allowed: number): string[] {
  const spoken = said.replace(/\n$/, "").split("\n");
  const long = spoken.filter((line) => line.length > LINE_LIMIT).map((line) => `said a line of ${line.length} characters, over ${LINE_LIMIT}`);
  return spoken.length > allowed ? [...long, `said ${spoken.length} lines, over ${allowed}`] : long;
}

export function coveredByCheck(check: string): (file: string) => boolean {
  const fedToTools = new Set([...check.matchAll(/^run .*$/gm)].flatMap(([line]) => line.match(/[\w./-]+\.(json|m?js|ts)\b/g) ?? []));
  const collects = vitest.test?.include ?? [];
  return (file) => fedToTools.has(file) || collects.some((glob) => matchesGlob(file, glob));
}

const TOOLS = ["tsc", "eslint", "knip", "jscpd", "vitest", "node"] as const;
type Tool = (typeof TOOLS)[number];

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const SRC = import.meta.dirname;
export const BIN = join(SRC, "..", "bin");
const WORKFLOWS = join(SRC, "..", ".github", "workflows");
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST") && name !== "REASON")), AGENT_HOOKS_SETTINGS: "" };
export const OWNER = "collod873";
export const MACHINE = "collod873-machine[bot]";

export interface WorkflowStep {
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

interface WorkflowJob {
  if?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

export interface IssueEvent {
  labels?: string[];
  sender?: string;
  action?: string;
  label?: string;
  head?: string;
  fork?: boolean;
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

export function heldBy(step: WorkflowStep, cwd: string, { labels, action = "opened", label = "", sender = OWNER, head }: IssueEvent): Promise<{ failed: boolean; held: string | undefined }> {
  const root = scratch("labelled-");
  const event = join(root, "event.json");
  const output = join(root, "output");
  writeFileSync(event, JSON.stringify({ action, sender: { login: sender }, ...(label === "" ? {} : { label: { name: label } }), ...(labels === undefined ? {} : { issue: { labels: labels.map((name) => ({ name })) } }), ...(head === undefined ? {} : { pull_request: { head: { ref: head } } }) }));
  return new Promise((resolve) => {
    execFile("bash", ["-e", "-c", step.run ?? ""], { cwd, env: { ...env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output } }, (error) => {
      const held = existsSync(output) ? /^held=(.*)$/m.exec(readFileSync(output, "utf8"))?.[1] : undefined;
      resolve({ failed: error !== null, held });
    });
  });
}

const HELD = new Map<string, ReturnType<typeof heldBy>>();

export async function starts(file: string, gated: string, event: IssueEvent): Promise<boolean> {
  const job = workflowJobs(file)[gated];
  if (job === undefined) throw new Error(`no ${gated} job in ${file}`);
  const { labels, ...rest } = event;
  if (!holds(job.if ?? "true", rest)) return false;
  const seen = `${file} ${JSON.stringify([labels, rest.action, rest.label, rest.head])}`;
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
  }: {
    labels?: string[];
    steps?: Record<string, StepOutcome>;
    needs?: Record<string, { result: string }>;
    failed?: boolean;
    cancelled?: boolean;
    sender?: string;
    body?: string;
    action?: string;
    label?: string;
    head?: string;
    fork?: boolean;
  },
): boolean {
  const bare = condition.replace(/^\s*\$\{\{|\}\}\s*$/g, "");
  const source = (/\b(success|failure|always|cancelled)\(\)/.test(bare) ? bare : `success() && (${bare})`)
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
    .replace(/needs\.([\w-]+)\.result/g, 'needs["$1"].result');
  const evaluate = new Function("labels", "steps", "needs", "startsWith", "success", "failure", "always", "cancelled", `return Boolean(${source});`) as (...scope: unknown[]) => boolean;
  return evaluate(
    labels,
    steps,
    needs,
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
  for (const name of ["mark", "spelled"]) copyFileSync(join(BIN, name), join(root, "bin", name));
  copyFileSync(join(SRC, "spelled.ts"), join(root, "src", "spelled.ts"));
}

export function execute(file: string, cwd: string, extra: Record<string, string> = {}, args: string[] = []): Run {
  const { status, stdout, stderr } = spawnSync(file, args, { cwd, env: { ...env, ...extra }, encoding: "utf8" });
  return { status, stdout, stderr };
}

export function inRepo(cwd: string, path: string): string {
  return isAbsolute(path) ? path : join(cwd, path);
}

export function stubTool(repo: string, tool: Tool, output?: string): void {
  script(join(repo, "node_modules", ".bin", tool), output === undefined ? "exit 0\n" : `cat <<'OUTPUT'\n${output}\nOUTPUT\nexit 1\n`);
}

export function checkRepo(failing: Partial<Record<Tool, string>> = {}) {
  const repo = join(scratch("check-"), "repo");
  mkdirSync(join(repo, "bin"), { recursive: true });
  copyFileSync(join(BIN, "check"), join(repo, "bin", "check"));
  chmodSync(join(repo, "bin", "check"), 0o755);
  for (const tool of TOOLS) stubTool(repo, tool, failing[tool]);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "check@test");
  git(repo, "config", "user.name", "check");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  return { repo, run: (cwd = repo, args: string[] = [], extra: Record<string, string> = {}) => execute(join(cwd, "bin", "check"), cwd, extra, args) };
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
  why = CONSENT_ONLY_WHY,
}: {
  remoteRefuses?: string;
  alreadyOpen?: boolean;
  autoMergeRefused?: boolean;
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
      "  *\"issue view\"*) printf 'Push the branch before anything can refuse it\\n' ;;",
      alreadyOpen ? "  *\"pr create\"*) exit 1 ;;" : `  *"pr create"*) printf '%s\\n' '${SAVED_PR}' ;;`,
      `  *"pr view"*) printf '%s\\n' '${SAVED_PR}' ;;`,
      autoMergeRefused ? "  *\"pr merge\"*) printf 'auto-merge is not enabled for this repository\\n' >&2; exit 1 ;;" : "",
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

export function openedCases(root: string, opener: string, body: string, parent: Parent): string[] {
  plant(root, "opened.json", JSON.stringify({ number: 811, user: { login: opener }, body }));
  return [`  *"api"*"issues/811/parent") ${parentSays(root, parent)} ;;`, `  *"api"*"issues/811") cat "${join(root, "opened.json")}" ;;`];
}

export const gitRefusing = (root: string, unreadable: string) =>
  script(join(root, "bin", "git"), `case "$*" in\n  ${unreadable}) printf 'fatal: unable to read\\n' >&2; exit 128 ;;\nesac\nPATH="\${PATH#*:}" exec git "$@"\n`);

export function parentSays(root: string, parent: Parent): string {
  plant(root, "parent.json", JSON.stringify(parent ?? {}));
  if (parent === undefined) return "printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1";
  if (parent === "unreadable") return "printf 'gh: Server Error (HTTP 502)\\n' >&2; exit 1";
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

type Left = "uncommitted" | "unlanded" | "landed" | "held by a live session";

export function launching({
  gh = "exit 0\n",
  claude = "exit 0\n",
  left = {} as Record<string, Left>,
  mainMoves = "moved.txt",
  diverged = false,
}: { gh?: string; claude?: string; left?: Record<string, Left>; mainMoves?: string; diverged?: boolean } = {}) {
  const root = scratch("session-");
  const { remote, session: main } = cloned(root, "base");
  for (const [name, state] of Object.entries(left)) {
    const at = join(main, ".claude", "worktrees", name);
    git(main, "worktree", "add", "--quiet", "-b", `worktree-${name}`, at);
    if (state === "uncommitted" || state === "held by a live session") plant(at, "edit.txt", "half done\n");
    if (state === "unlanded") git(at, "commit", "--quiet", "--allow-empty", "-m", "unlanded");
    if (state === "held by a live session") git(main, "worktree", "lock", "--reason", `claude session ${name} (pid ${process.pid} start 1)`, at);
  }
  if (diverged) git(main, "commit", "--quiet", "--allow-empty", "-m", "edited in the main checkout");
  const other = join(root, "other");
  git(root, "clone", "--quiet", remote, other);
  git(other, "config", "user.email", "other@test");
  git(other, "config", "user.name", "other");
  plant(other, mainMoves, "moved\n");
  git(other, "add", mainMoves);
  git(other, "commit", "--quiet", "-m", "a merge since the last session");
  git(other, "push", "--quiet", "origin", "main");
  const argv = (tool: string) => () => (existsSync(join(root, tool)) ? readFileSync(join(root, tool), "utf8").trimEnd().split("\n") : undefined);
  script(join(root, "bin", "claude"), `printf '%s\\n' "$PWD" "$@" >"${join(root, "claude")}"\n${claude}`);
  script(join(root, "bin", "npm"), `printf '%s\\n' "$PWD" "$@" >"${join(root, "npm")}"\n`);
  script(join(root, "bin", "gh"), gh);
  return {
    remote,
    main,
    claude: argv("claude"),
    npm: argv("npm"),
    run: (...args: string[]) => execute(join(BIN, "session"), main, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args),
  };
}
