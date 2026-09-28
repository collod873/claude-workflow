import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, matchesGlob } from "node:path";
import { parse } from "yaml";
import { onTestFinished } from "vitest";
import vitest from "../vitest.config.ts";

export const LINE_LIMIT = 200;
export const MOST_LINES = 5;

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
const BIN = join(SRC, "..", "bin");
const WORKFLOWS = join(SRC, "..", ".github", "workflows");
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST") && name !== "AGENT_HOOKS_SETTINGS"));
const OWNER = "collod873";
const MACHINE = "collod873-machine[bot]";

interface WorkflowStep {
  run?: string;
  with?: Record<string, unknown>;
  env?: Record<string, unknown>;
}

export interface WorkflowJob {
  if?: string;
  permissions?: Record<string, string>;
  steps: WorkflowStep[];
}

export function onlyJob(file: string): WorkflowJob {
  const { jobs } = parse(readFileSync(join(WORKFLOWS, file), "utf8")) as { jobs: Record<string, WorkflowJob> };
  const [job] = Object.values(jobs);
  if (job === undefined) throw new Error(`no job in ${file}`);
  return job;
}

export type Said = string | { author: string; type: string; body: string };
const authored = (comments: Said[]) => comments.map((said) => `${JSON.stringify(typeof said === "string" ? { author: MACHINE, type: "Bot", body: said } : said)}\n`).join("");

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
  },
): boolean {
  const bare = condition.replace(/^\s*\$\{\{|\}\}\s*$/g, "");
  const source = (/\b(success|failure|always|cancelled)\(\)/.test(bare) ? bare : `success() && (${bare})`)
    .replace(/github\.event\.action/g, JSON.stringify(action))
    .replace(/github\.event\.label\.name/g, JSON.stringify(label))
    .replace(/github\.event\.sender\.login/g, JSON.stringify(sender))
    .replace(/contains\(\s*github\.event\.issue\.body\s*,\s*('[^']*')\s*\)/g, `${JSON.stringify(body)}.includes($1)`)
    .replace(/github\.repository_owner/g, JSON.stringify(OWNER))
    .replace(/contains\(\s*github\.event\.issue\.labels\.\*\.name\s*,\s*('[^']*')\s*\)/g, "labels.includes($1)")
    .replace(/steps\.([\w-]+)\.(outcome|conclusion)/g, 'steps["$1"].$2')
    .replace(/steps\.([\w-]+)\.outputs\.([\w-]+)/g, '(steps["$1"].outputs ?? {})["$2"]')
    .replace(/needs\.([\w-]+)\.result/g, 'needs["$1"].result');
  const evaluate = new Function("labels", "steps", "needs", "success", "failure", "always", "cancelled", `return Boolean(${source});`) as (...scope: unknown[]) => boolean;
  return evaluate(
    labels,
    steps,
    needs,
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

function commitAt(cwd: string, date: string, args: string[], committed = date): string {
  return execFileSync("git", args, { cwd, env: { ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: committed }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

export function script(path: string, body: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/bash\n${body}`);
  chmodSync(path, 0o755);
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
  'The owner, in session: "a spec is filed once, so the cold read and the slicer share one document".',
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
  "The cold read and the slicer.",
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

function branchedSession(session: string, who: string, onMain: Record<string, string>, tests: Record<string, string>, branch: string): void {
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", `${who}@test`);
  git(session, "config", "user.name", who);
  for (const [path, content] of Object.entries(onMain)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the build stands on");
  git(session, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (Object.keys(tests).length === 0) return;
  git(session, "checkout", "--quiet", "-b", branch);
  for (const [path, content] of Object.entries(tests)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "the author's failing test");
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

export const FULL_CHECK_RED_ONCE = [
  "if [ -f ../checked ]; then exit 0; fi",
  "touch ../checked",
  "mkdir -p .git/machine-logs",
  "printf -- '--- test ---\\nOTHER-TEST-BROKE in src/stops.test.ts\\n' >.git/machine-logs/check-red.log",
  "printf 'bin/check: FAILED test src/stops.test.ts; log .git/machine-logs/check-red.log\\n'",
  "exit 1",
  "",
].join("\n");

const AUTHORED_TEST = 'import { it } from "vitest";\nit("names the behaviour the criterion asks for", () => {});\n';

export const SAVED_PR = "https://github.com/collod873/claude-workflow/pull/9726";

function readEvent(path: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: path } }] } });
}

function ghArgv(dir: string): { setup: string; calls: () => string[][] } {
  mkdirSync(dir, { recursive: true });
  return {
    setup: `n=$(( $(ls "${dir}" 2>/dev/null | wc -l) + 1 ))\nprintf '%s\\0' "$@" >"${dir}/$n"`,
    calls: () => readdirSync(dir).map((_, index) => readFileSync(join(dir, String(index + 1)), "utf8").split("\0").filter((part) => part !== "")),
  };
}

const CONSENT_ONLY_WHY = 'The owner, in session: "a plan carrying its own intent, spoken plainly, at length, right where it was proposed".';

export function saving({
  remoteRefuses,
  brief,
  streams = {} as Partial<Record<string, string[]>>,
  alreadyOpen = false,
  autoMergeRefused = false,
  why = CONSENT_ONLY_WHY,
}: {
  remoteRefuses?: string;
  brief?: string;
  streams?: Partial<Record<string, string[]>>;
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
  if (brief !== undefined) plant(session, ".git/machine-logs/brief-726.md", brief);
  for (const [stage, paths] of Object.entries(streams)) {
    const lines = (paths ?? []).map((path) => readEvent(join(session, path))).join("\n");
    plant(session, `.git/machine-logs/${stage}-726.jsonl`, lines === "" ? "" : `${lines}\n`);
  }
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
    ticketComments: () =>
      argvCalls()
        .filter((args) => args[0] === "issue" && args[1] === "comment")
        .map((args) => args[args.indexOf("--body") + 1]),
    run: (ticket = "726") => execute(join(BIN, "save"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

const CLOSER_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a ticket closes once its PR merges".',
  "",
  "## Done when",
  "",
  "- The fix lands.",
  "",
].join("\n");

const FAST_TIMING = {
  filed: "2026-01-01T00:00:00Z",
  firstCommit: "2026-01-01T00:00:01Z",
  prOpened: "2026-01-01T00:00:02Z",
  checksGreen: "2026-01-01T00:00:03Z",
  merged: "2026-01-01T00:00:04Z",
};

export function closing({
  ticket = "812",
  ticketBody = CLOSER_TICKET,
  readable = true,
  timing = FAST_TIMING,
  closedAs,
  behindPrs = [] as { number: string; ticket: string; branch?: string; refused?: string; mergeStateStatus?: string }[],
  splitFrom,
  openedPr,
  prComments = [] as Said[],
  prCommentsUnreadable = false,
}: {
  ticket?: string;
  ticketBody?: string;
  readable?: boolean;
  timing?: { filed: string; firstCommit: string; rebased?: string; prOpened: string; checksGreen: string; merged: string };
  closedAs?: "COMPLETED" | "NOT_PLANNED";
  behindPrs?: { number: string; ticket: string; branch?: string; refused?: string; mergeStateStatus?: string }[];
  splitFrom?: { parent: string; labels: string; said: string; siblings: Record<string, string> };
  openedPr?: string;
  prComments?: Said[];
  prCommentsUnreadable?: boolean;
} = {}) {
  const root = scratch("closer-");
  const session = join(root, "session");
  const callsDir = join(root, "gh-calls");
  const tokensDir = join(root, "gh-tokens");
  mkdirSync(callsDir, { recursive: true });
  mkdirSync(tokensDir, { recursive: true });
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", "closer@test");
  git(session, "config", "user.name", "closer");
  plant(session, "src/built.ts", "export const built = 1;\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "base");
  git(session, "checkout", "--quiet", "-b", `ticket/${ticket}`);
  git(session, "add", "-A");
  commitAt(session, timing.firstCommit, ["commit", "--quiet", "--allow-empty", "-m", `Build #${ticket} against its failing tests`], timing.rebased);
  git(session, "checkout", "--quiet", "main");
  commitAt(session, timing.merged, ["merge", "--quiet", "--no-ff", "-m", `Merge pull request #900 from collod873/ticket/${ticket}`, `ticket/${ticket}`]);
  plant(root, "pr-comments.json", authored(prComments));
  script(
    join(root, "bin", "gh"),
    [
      `n=$(( $(ls "${callsDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\n' "$@" >"${callsDir}/$n"`,
      `printf '%s' "$GH_TOKEN" >"${tokensDir}/$n"`,
      'case "$*" in',
      ...(splitFrom === undefined
        ? []
        : [
            `  *"issue view ${splitFrom.parent} "*"labels"*) printf '${splitFrom.labels}' ;;`,
            `  *"api"*"issues/${splitFrom.parent}/comments"*) cat <<'SAID'\n${JSON.stringify({ author: MACHINE, type: "Bot", body: splitFrom.said })}\nSAID\n    ;;`,
            ...Object.entries(splitFrom.siblings).map(([sibling, state]) => `  *"issue view ${sibling} "*"state"*) printf '%s\\n' '${state}' ;;`),
          ]),
      `  *"issue view"*"createdAt"*) printf '%s\\n' '${timing.filed}' ;;`,
      `  *"issue view"*"state"*) printf '%s\\n' '${closedAs === undefined ? "OPEN REOPENED" : `CLOSED ${closedAs}`}' ;;`,
      "  *\"issue view\"*)",
      ...(readable ? [] : ["    printf 'GraphQL: Could not resolve to an issue\\n' >&2", "    exit 1"]),
      "    cat <<'BODY'",
      ticketBody,
      "BODY",
      "    ;;",
      `  *"pr list"*) printf '%s\\n' '${JSON.stringify(behindPrs.map((behind) => ({ number: Number(behind.number), headRefName: behind.branch ?? `ticket/${behind.ticket}`, mergeStateStatus: behind.mergeStateStatus ?? "BEHIND" })))}' ;;`,
      ...behindPrs.map(
        (behind) => `  *"pr update-branch ${behind.number}"*) ${behind.refused === undefined ? "exit 0" : `printf '%s\\n' '${behind.refused}' >&2; exit 1`} ;;`,
      ),
      `  *"pr view"*) printf '%s\\n' '${timing.prOpened}' ;;`,
      `  *"pr checks"*) printf '%s\\n' '${timing.checksGreen}' ;;`,
      `  *"issues/900/comments"*) ${prCommentsUnreadable ? "printf 'GraphQL: comments could not be read\\n' >&2; exit 1" : `cat "${join(root, "pr-comments.json")}"`} ;;`,
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  return {
    session,
    calls: () => readdirSync(callsDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(callsDir, file), "utf8")),
    tokens: () => readdirSync(tokensDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(tokensDir, file), "utf8")),
    run: () =>
      execute(join(BIN, "close"), session, {
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        GH_TOKEN: "app",
        QUIET_GH_TOKEN: "quiet",
        ...(openedPr === undefined ? {} : { OPENED_PR: openedPr }),
      }),
  };
}

export const REVIEWED_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a green build is read against what was meant before it merges".',
  "",
  "## Done when",
  "",
  "- A drift verdict posts every gap.",
  "",
].join("\n");

export const JUDGEMENT = "https://github.com/collod873/claude-workflow/pull/9810#issuecomment-1";
const FOLLOW_UP_FILED = "https://github.com/collod873/claude-workflow/issues/9811";
const LATER_POSTED = "https://github.com/collod873/claude-workflow/issues/810#issuecomment-2";

export function fileDiff(path: string, added: string): string {
  return `diff --git a/${path} b/${path}\nindex 0000000..1111111 100644\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${added}\n`;
}

export const JUDGED_GAP = "the fixer is woken on finds that should have been follow-ups";
export const EARLY_REPAIR = "export const repairedBeforeJudgement = 1;";
export const FIXER_LINE = "export const repairedAfterJudgement = 1;";
export const FROM_MAIN = "export const broughtInByMain = 1;";
export const RESOLVED = "line 3 as ticket A changed it, ticket B's intent kept";

const SHARED = `${Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;

function judgedHistory(root: string, turn: "merged" | "ticket"): string {
  const commit = (message: string) => {
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", message);
  };
  plant(root, "src/shared.ts", SHARED);
  commit("Share lines with main");
  git(root, "branch", "main");
  plant(root, "src/shared.ts", SHARED.replace("line 3", "line 3 as ticket B changed it"));
  commit("Build #810 against its failing tests");
  plant(root, "src/early.ts", `${EARLY_REPAIR}\n`);
  commit("Repair #810 as its fixer");
  const head = git(root, "rev-parse", "HEAD");
  if (turn === "merged") {
    git(root, "checkout", "--quiet", "main");
    plant(root, "src/shared.ts", SHARED.replace("line 3", "line 3 as ticket A changed it"));
    plant(root, "src/main.ts", `${FROM_MAIN}\n`);
    commit("Build #800");
    git(root, "checkout", "--quiet", "ticket/810");
    plant(root, "src/fixed.ts", `${FIXER_LINE}\n`);
    commit("Repair #810 as its fixer");
    try {
      git(root, "merge", "--quiet", "--no-edit", "main");
    } catch {
      plant(root, "src/shared.ts", SHARED.replace("line 3", RESOLVED));
      git(root, "add", ".");
      git(root, "commit", "--quiet", "--no-edit");
    }
  }
  git(root, "update-ref", "refs/remotes/origin/main", "main");
  return head;
}

const judgedAt = (head: string) =>
  `The reviewer read this PR against the Why of #810 and found drift.\n\n- ${JUDGED_GAP}\n\nFingerprint: \`judged-before\`\nHead: \`${head}\`\n`;

export function reviewing({
  bin = "review",
  branch = "ticket/810",
  verdict = { verdict: "match", gaps: [], readback: "It now reads a green build against what was meant before it merges." } as object,
  diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;"),
  turns = [] as Said[],
  onPr = [] as Said[],
  repair = undefined as string | undefined,
  body = REVIEWED_TICKET,
  prCommentFails = false,
  prBody = "Builds #810\n",
  prBodyUnreadable = false,
  prEditFails = false,
  diffAfter = undefined as string | undefined,
  bodyAfter = undefined as string | undefined,
  judged = undefined as "merged" | "ticket" | undefined,
}: {
  bin?: string;
  branch?: string;
  verdict?: object;
  diff?: string;
  turns?: Said[];
  onPr?: Said[];
  repair?: string;
  body?: string;
  prCommentFails?: boolean;
  prBody?: string;
  prBodyUnreadable?: boolean;
  prEditFails?: boolean;
  diffAfter?: string;
  bodyAfter?: string;
  judged?: "merged" | "ticket";
} = {}) {
  const root = scratch("review-");
  const argvDir = join(root, "gh-argv");
  const handed = join(root, "claude-stdin");
  const hired = join(root, "claude-argv");
  const judgedOnce = join(root, "model-answered");
  const { setup, calls } = ghArgv(argvDir);
  git(root, "init", "--quiet", "--initial-branch=ticket/810");
  git(root, "config", "user.email", "review@test");
  git(root, "config", "user.name", "review");
  git(root, "commit", "--quiet", "--allow-empty", "-m", "Build #810 against its failing tests");
  if (repair !== undefined) {
    plant(root, "src/repaired.ts", repair);
    git(root, "add", "src/repaired.ts");
    git(root, "commit", "--quiet", "-m", "Repair #810 as its fixer");
    git(root, "commit", "--quiet", "--allow-empty", "-m", "Merge branch 'main' into ticket/810");
  }
  if (judged !== undefined) onPr = [...onPr, judgedAt(judgedHistory(root, judged))];
  plant(root, "pr.diff", diff);
  plant(root, "pr-after.diff", diffAfter ?? diff);
  plant(root, "ticket.md", body);
  plant(root, "ticket-after.md", bodyAfter ?? body);
  plant(root, "pr-body.md", prBody);
  plant(root, "turns.json", authored(turns));
  plant(root, "on-pr.json", authored(onPr));
  plant(root, "answer.json", `${JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: verdict })}\n`);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      `  *"api"*"issues/810/comments"*) cat "${join(root, "turns.json")}" ;;`,
      `  *"api"*"/comments"*) cat "${join(root, "on-pr.json")}" ;;`,
      `  *"pr view"*"--json body"*) ${prBodyUnreadable ? "printf 'the PR body could not be read\\n' >&2; exit 1" : `cat "${join(root, "pr-body.md")}"`} ;;`,
      `  *"pr edit"*) ${prEditFails ? "printf 'the PR body could not be edited\\n' >&2; exit 1" : "exit 0"} ;;`,
      `  *"pr view"*) printf '%s\\n' '${branch}' ;;`,
      `  *"issue view"*) [ -f "${judgedOnce}" ] && cat "${join(root, "ticket-after.md")}" || cat "${join(root, "ticket.md")}" ;;`,
      `  *"pr diff"*) [ -f "${judgedOnce}" ] && cat "${join(root, "pr-after.diff")}" || cat "${join(root, "pr.diff")}" ;;`,
      prCommentFails ? "  *\"pr comment\"*) printf 'the readback could not be posted\\n' >&2; exit 1 ;;" : `  *"pr comment"*) printf '%s\\n' '${JUDGEMENT}' ;;`,
      `  *"issue comment"*) printf '%s\\n' '${LATER_POSTED}' ;;`,
      `  *"issue create"*) printf '%s\\n' '${FOLLOW_UP_FILED}' ;;`,
      "  *) exit 22 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  script(join(root, "bin", "claude"), `touch "${judgedOnce}"\nprintf '%s\\0' "$@" >"${hired}"\ncat >"${handed}"\ncat "${join(root, "answer.json")}"\n`);
  const bodyOf = (args: string[]) => args[args.indexOf("--body") + 1];
  return {
    root,
    hired: () => (existsSync(hired) ? readFileSync(hired, "utf8").split("\0") : []),
    spent: () => existsSync(handed),
    handed: () => (existsSync(handed) ? readFileSync(handed, "utf8") : ""),
    ticketComments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyOf),
    filed: () => calls().filter((args) => args[0] === "issue" && args[1] === "create").map((args) => ({ title: args[args.indexOf("--title") + 1], body: bodyOf(args) })),
    order: () => calls().map((args) => `${args[0]} ${args[1]}`),
    comments: () => calls().filter((args) => args[0] === "pr" && args[1] === "comment").map(bodyOf),
    edited: () => calls().filter((args) => args[0] === "pr" && args[1] === "edit").map(bodyOf),
    read: () => calls().some((args) => args[0] === "pr" && args[1] === "view"),
    run: (pr = "9810", extra: Record<string, string> = {}, flags: string[] = []) => execute(join(BIN, bin), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, ...extra }, [...flags, pr]),
  };
}

const FIXED_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a red ticket stays with its fixer until it merges, never the owner".',
  "",
  "## Done when",
  "",
  "- The fixer clears a red ticket.",
  "",
].join("\n");

export const FIXER_SESSION = "sess-fix";
const RED_RUN = "555";

export function fixing({
  body = FIXED_TICKET,
  answer = { outcome: "code", reason: "the export was never renamed" } as { outcome: string; reason: string; body?: string; tickets?: unknown[] },
  onPr = [] as Said[] | undefined,
  logged = {} as Record<string, string>,
  leftover = {} as Record<string, string>,
  claude = "",
  npx = "exit 0\n",
  check = "exit 0\n",
  save = "exit 0\n",
  failedRun = "",
  ranAs = "Build",
  attempt = 1,
  rerun = "exit 0",
  savedSession = undefined as string | undefined,
  reason = undefined as string | undefined,
  captures = {} as Record<string, string>,
} = {}) {
  const root = scratch("fixer-");
  const session = join(root, "session");
  const home = join(root, "home");
  const spent = join(root, "claude-calls");
  const hires = join(root, "claude-argv");
  const marks = join(root, "mark-calls");
  const saves = join(root, "save-calls");
  const argvDir = join(root, "gh-argv");
  const { setup, calls } = ghArgv(argvDir);
  mkdirSync(spent, { recursive: true });
  mkdirSync(hires, { recursive: true });
  script(join(session, "bin", "check"), check);
  script(join(session, "bin", "mark"), `printf '%s\\n' "$*" >>"${marks}"\n`);
  script(join(session, "bin", "save"), `printf '%s\\n' "$*" >>"${saves}"\n${save}`);
  branchedSession(session, "fixer", { "src/ticket-shape.ts": "export const shaped = 1;\n" }, { "src/ticket-shape.test.ts": AUTHORED_TEST }, "ticket/811");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "Build #811 against its failing tests");
  const redAt = git(session, "rev-parse", "HEAD");
  for (const [name, text] of Object.entries(logged)) plant(session, `.git/machine-logs/${name}`, text);
  for (const [path, text] of Object.entries(leftover)) plant(session, path, text);
  if (savedSession !== undefined) plant(home, ".claude/fixer/811", `${savedSession}\n`);
  for (const [name, text] of Object.entries(captures)) plant(root, `captures/${name}`, text);
  plant(root, "ticket.md", body);
  plant(root, "on-pr.json", authored(onPr ?? []));
  plant(root, "failed-run.log", failedRun);
  const result = { type: "result", subtype: "success", is_error: false, session_id: FIXER_SESSION, structured_output: answer };
  plant(root, "answer.jsonl", `${JSON.stringify({ type: "system", session_id: FIXER_SESSION })}\n${JSON.stringify(result)}\n`);
  script(join(root, "bin", "npx"), npx);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      `  *"api"*"issues/9811/comments"*) cat "${join(root, "on-pr.json")}" ;;`,
      `  *"issue create"*) n=$(( $(cat "${join(root, "created")}" 2>/dev/null || echo 900) + 1 )); printf '%s\\n' "$n" >"${join(root, "created")}"; printf 'https://github.com/collod873/claude-workflow/issues/%s\\n' "$n" ;;`,
      `  *"issue view"*) cat "${join(root, "ticket.md")}" ;;`,
      `  *"pr view"*"number"*) ${onPr === undefined ? "exit 1" : "printf '9811\\n'"} ;;`,
      `  *"run view"*"--json"*) printf '%s %s %s\\n' '${ranAs}' '${redAt}' '${attempt}' ;;`,
      `  *"run view"*) cat "${join(root, "failed-run.log")}" ;;`,
      `  *"run rerun"*) ${rerun} ;;`,
      "  *\"pr view\"*) exit 22 ;;",
      "  *) printf 'https://github.com/collod873/claude-workflow/issues/811#issuecomment-1\\n' ;;",
      "esac",
      "",
    ].join("\n"),
  );
  script(
    join(root, "bin", "claude"),
    [`CALL=$(( $(ls "${spent}" | wc -l) + 1 ))`, `printf '%s\\0' "$@" >"${hires}/$CALL"`, `cat >"${spent}/$CALL"`, claude, `cat "${join(root, "answer.jsonl")}"`, ""].join("\n"),
  );
  const listed = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : []);
  const numbered = (dir: string) => readdirSync(dir).map((_, index) => readFileSync(join(dir, String(index + 1)), "utf8"));
  const bodyOf = (args: string[]) => args[args.indexOf("--body") + 1];
  return {
    body,
    session,
    handed: () => numbered(spent),
    hired: () => numbered(hires).map((argv) => argv.split("\0").filter((part) => part !== "")),
    marked: () => listed(marks),
    saved: () => listed(saves),
    calls,
    ticketComments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyOf),
    edits: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit" && args.includes("--body")).map(bodyOf),
    labelled: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit" && !args.includes("--body")).map((args) => args.slice(2).join(" ")),
    filed: () => calls().filter((args) => args[0] === "issue" && args[1] === "create").map(bodyOf),
    closes: () => calls().filter((args) => (args[0] === "issue" || args[0] === "pr") && args[1] === "close"),
    reruns: () => calls().filter((args) => args[0] === "run" && args[1] === "rerun"),
    keptSession: () => readFileSync(join(home, ".claude", "fixer", "811"), "utf8").trim(),
    captured: (name: string) => join(root, "captures", name),
    log: (...args: string[]) => git(session, "log", ...args),
    run: (...args: string[]) =>
      execute(join(BIN, "fix"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, HOME: home, SESSION_CAPTURES: join(root, "captures"), ...(reason === undefined ? {} : { REASON: reason }) }, args.length === 0 ? ["811", RED_RUN] : args),
  };
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

export function marking({ gh = "exit 0\n" }: { gh?: string } = {}) {
  return onGh("mark", gh);
}

export function closingNote(labels: string, { gh = "exit 0\n" }: { gh?: string } = {}) {
  return onGh("close-note", `[[ $2 == view ]] && { printf '${labels}'; exit 0; }\n${gh}`);
}

export const READING_SESSION = "reading-session";
export const FINDINGS_POSTED ="https://github.com/collod873/claude-workflow/issues/902#issuecomment-1";

function issueStage(prefix: string, issue: object, answer: object, posted: string, gh: string, cutOff = "") {
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

export function researching({
  labels = ["note", "research"],
  findings = "The closer judges only an issue with checks, so a note waits on a session.",
  gh = "",
  sources = "",
  readsPastCap = false,
}: { labels?: string[]; findings?: string; gh?: string; sources?: string; readsPastCap?: boolean } = {}) {
  const cutOff = readsPastCap ? `case "$*" in *--resume*) ;; *) printf '%s\\n' '${JSON.stringify({ type: "system", session_id: READING_SESSION })}'; exit 124 ;; esac\n` : "";
  const { root, ...stage } = issueStage("research-", { title: "What does the closer judge", body: wellFormedNote, labels: labels.map((name) => ({ name })) }, { findings }, FINDINGS_POSTED, gh, cutOff);
  return {
    ...stage,
    run: (...args: string[]) => execute(join(BIN, "research"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, RESEARCH_SOURCES: sources, STAGE_MINUTES: readsPastCap ? "40" : "" }, args.length > 0 ? args : ["902"]),
  };
}

export const COLD_READ_POSTED = "https://github.com/collod873/claude-workflow/issues/968#issuecomment-1";

export function coldReading({
  labels = ["spec"],
  title = "A spec worth a cold read",
  body = wellFormedSpec,
  build = "A cold reader that hires one opus stage to read a filed spec, and posts what it would build.",
  choices = [] as { guess: string; why: string }[],
  gh = "",
}: { labels?: string[]; title?: string; body?: string; build?: string; choices?: { guess: string; why: string }[]; gh?: string } = {}) {
  const { root, argv, ...stage } = issueStage("cold-read-", { title, body, labels: labels.map((name) => ({ name })) }, { build, choices }, COLD_READ_POSTED, gh);
  return {
    ...stage,
    edits: () => argv().filter((args) => args[1] === "edit"),
    closes: () => argv().filter((args) => args[1] === "close"),
    run: (...args: string[]) => execute(join(BIN, "cold-read"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args.length > 0 ? args : ["968"]),
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
