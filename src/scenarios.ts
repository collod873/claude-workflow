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
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST")));

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
  return { repo, run: (cwd = repo, args: string[] = []) => execute(join(cwd, "bin", "check"), cwd, {}, args) };
}

export const wellFormedTicket = [
  "## Why",
  "",
  'The owner, in session: "a ticket is the only way in, so its shape is where intent survives".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The filing command refuses a misshapen body - check: `npx vitest run --config vitest.config.ts ticket-shape`",
  "",
  "## Files claimed",
  "",
  "- src/ticket-shape.ts",
  "",
].join("\n");

export const misshapenTicket = [
  "## Why",
  "",
  "The session decided this was worth building.",
  "",
  "## Acceptance criteria",
  "",
  "- [ ] one",
  "- [ ] two",
  "- [ ] three",
  "- [ ] four",
  "",
  "## Files claimed",
  "",
  "- src/**",
  "",
].join("\n");

export const wellFormedNote = ["## Why", "", "Three passes over the standards left four proposals nobody can build until the owner weighs them.", ""].join("\n");

export function filing({ gh, body, title = "A ticket the machine can build", npx = "exit 1\n" }: { gh: string; body: string; title?: string; npx?: string }) {
  const root = scratch("file-issue-");
  const repo = join(root, "repo");
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "--quiet", "--initial-branch=main");
  writeFileSync(join(repo, "body.md"), body);
  script(join(root, "bin", "gh"), gh);
  script(join(root, "bin", "npx"), npx);
  return {
    repo,
    run: (args = ["ticket", "--title", title, "--body-file", "body.md"]) =>
      execute(join(BIN, "file-issue"), repo, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args),
  };
}

export function checking(npx: string) {
  const dir = scratch("check-runner-");
  script(join(dir, "bin", "npx"), npx);
  return {
    run: (): Run => {
      const { status, stdout, stderr } = spawnSync("node", [join(SRC, "check-runner.ts")], {
        cwd: dir,
        input: wellFormedTicket,
        encoding: "utf8",
        env: { ...env, PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}` },
      });
      return { status, stdout, stderr };
    },
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
    run: () => execute(join(BIN, "land"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, LAND_WAIT_SECONDS: "0" }),
  };
}

const CHECK_RED = "printf ' FAIL  src/ticket-shape.test.ts > names the behaviour\\n      Tests  1 failed (1)\\n'\nexit 1\n";

type Tree = "fresh" | "behind" | "dirty" | "branch" | "unfetchable";

function ghAnswers(body: string, edited?: string): string {
  return [
    'case "$*" in',
    '  *"issue view"*)',
    "    cat <<'TICKET'",
    body,
    "TICKET",
    "    ;;",
    ...(edited === undefined ? [] : [`  *"issue edit"*) printf '%s\\n' "$*" >>"${edited}" ;;`]),
    "  *) exit 22 ;;",
    "esac",
    "",
  ].join("\n");
}

export function plant(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function claimedSession(session: string, who: string, claimed: Record<string, string>, tests: Record<string, string>, branch: string): void {
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", `${who}@test`);
  git(session, "config", "user.name", who);
  for (const [path, content] of Object.entries(claimed)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the claim stands on");
  git(session, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (Object.keys(tests).length === 0) return;
  git(session, "checkout", "--quiet", "-b", branch);
  for (const [path, content] of Object.entries(tests)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "the author's failing test");
}

export function briefing({
  body = wellFormedTicket,
  claimed = { "src/ticket-shape.ts": "export const shaped = 1;\n" } as Record<string, string>,
  tests = {} as Record<string, string>,
  reads = true,
} = {}) {
  const root = scratch("brief-");
  const session = join(root, "session");
  claimedSession(session, "brief", claimed, tests, "ticket/722");
  script(join(root, "bin", "gh"), reads ? ghAnswers(body) : "exit 22\n");
  return {
    written: () => readFileSync(join(session, ".git", "machine-logs", "brief-722.md"), "utf8"),
    run: (ticket = "722") => execute(join(BIN, "brief"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

const WROTE_A_TEST = 'printf \'import { it } from "vitest";\\nit("names the behaviour the criterion asks for", () => {});\\n\' >src/ticket-shape.test.ts\n';

export function writesOutsideRepo(path: string): string {
  const event = { type: "assistant", message: { content: [{ type: "tool_use", name: "Write", input: { file_path: path } }] } };
  return `printf '%s\\n' '${JSON.stringify(event)}'\n`;
}

export function authoring({ body = wellFormedTicket, claude = WROTE_A_TEST, npx = CHECK_RED, reads = true } = {}) {
  const root = scratch("test-author-");
  const session = join(root, "session");
  const argv = join(root, "claude-argv");
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", "author@test");
  git(session, "config", "user.name", "author");
  plant(session, "src/ticket-shape.ts", "export const shaped = 1;\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the claim stands on");
  script(join(root, "bin", "gh"), reads ? ghAnswers(body) : "exit 22\n");
  script(join(root, "bin", "npx"), npx);
  script(join(root, "bin", "claude"), `printf '%s\\n' "$@" >"${argv}"\ncat >/dev/null\n${claude}`);
  return {
    session,
    handedOn: () => (existsSync(argv) ? readFileSync(argv, "utf8") : ""),
    committed: (branch = "ticket/723") => {
      try {
        return git(session, "show", "--name-only", "--format=", branch).split("\n").filter((path) => path !== "");
      } catch {
        return [];
      }
    },
    run: (ticket = "723") => execute(join(BIN, "test-author"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

const AUTHORED_TEST = 'import { it } from "vitest";\nit("names the behaviour the criterion asks for", () => {});\n';

export function building({
  body = wellFormedTicket,
  claimed = { "src/ticket-shape.ts": "export const shaped = 1;\n" } as Record<string, string>,
  tests = { "src/ticket-shape.test.ts": AUTHORED_TEST } as Record<string, string>,
  npx = CHECK_RED,
  sessionId = "sess-42",
  claude = "",
} = {}) {
  const root = scratch("builder-");
  const session = join(root, "session");
  const argvDir = join(root, "claude-argv");
  const stdinDir = join(root, "claude-stdin");
  mkdirSync(argvDir, { recursive: true });
  mkdirSync(stdinDir, { recursive: true });
  claimedSession(session, "builder", claimed, tests, "ticket/724");
  script(join(root, "bin", "gh"), ghAnswers(body));
  script(join(root, "bin", "npx"), npx);
  script(
    join(root, "bin", "claude"),
    [
      `n=$(( $(ls "${argvDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\n' "$@" >"${argvDir}/$n"`,
      `cat >"${stdinDir}/$n"`,
      claude,
      `printf '{"session_id":"${sessionId}"}\\n'`,
      "",
    ].join("\n"),
  );
  return {
    session,
    sessionId,
    calls: () => readdirSync(argvDir).length,
    argv: (call: number) => readFileSync(join(argvDir, String(call)), "utf8"),
    stdin: (call: number) => (existsSync(join(stdinDir, String(call))) ? readFileSync(join(stdinDir, String(call)), "utf8") : ""),
    committed: () => git(session, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter((line) => line !== ""),
    dirty: () => git(session, "status", "--porcelain"),
    run: (ticket = "724") => execute(join(BIN, "build"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

export function renamedAndDeletedHistory(session: string): void {
  plant(session, "vitest.config.ts", "export default {};\n");
  plant(session, "src/old-name.ts", "export const shaped = 1;\n");
  plant(session, "src/soon-deleted.ts", "export const goingAway = 1;\n");
  plant(session, "old.config.ts", "export default {};\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "plant the paths a stale ticket will still claim");
  git(session, "mv", "src/old-name.ts", "src/new-name.ts");
  git(session, "mv", "old.config.ts", "new.config.ts");
  git(session, "rm", "--quiet", "src/soon-deleted.ts");
  git(session, "commit", "--quiet", "-m", "rename one claimed path and delete another");
  git(session, "push", "--quiet", "origin", "main");
}

const OWNER_ON_PATHS = 'The owner, in session: "the flattening a build in flight caught, so paths get checked before a session starts".';

export const RENAMED_CLAIM_TICKET = [
  "## Why",
  "",
  OWNER_ON_PATHS,
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The renamed path still gets built against - check: `npx vitest run --config vitest.config.ts old-name`",
  "",
  "## Files claimed",
  "",
  "- src/old-name.ts",
  "",
].join("\n");

export const RENAMED_BESIDE_WORDS_TICKET = [
  "## Why",
  "",
  'The owner, in session: "leave src/old-name.ts alone where I said it".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The renamed config still runs - check: `npx vitest run --config old.config.ts old-name`",
  "",
  "## Files claimed",
  "",
  "- src/old-name.ts",
  "- src/old-name.tsx",
  "",
].join("\n");

export const DELETED_CLAIM_TICKET = [
  "## Why",
  "",
  OWNER_ON_PATHS,
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The deleted path is caught before a model runs - check: `npx vitest run --config vitest.config.ts soon-deleted`",
  "",
  "## Files claimed",
  "",
  "- src/soon-deleted.ts",
  "",
].join("\n");

export const MISSING_CONFIG_TICKET = [
  "## Why",
  "",
  OWNER_ON_PATHS,
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The missing config is caught before a model runs - check: `npx vitest run --config missing.config.ts new-name`",
  "",
  "## Files claimed",
  "",
  "- src/new-name.ts",
  "",
].join("\n");

export function starting({
  body = wellFormedTicket,
  npx = CHECK_RED,
  tree = "fresh" as Tree,
  history = (_session: string) => {},
} = {}) {
  const root = scratch("start-");
  const { session } = cloned(root, "base", "the commit a stale tree has not got");
  const spent = join(root, "claude-argv");
  const edited = join(root, "gh-edit");
  history(session);
  if (tree === "behind") git(session, "reset", "--quiet", "--hard", "HEAD~1");
  if (tree === "branch") git(session, "checkout", "--quiet", "-b", "ticket/721");
  if (tree === "dirty") writeFileSync(join(session, "left-behind.txt"), "work nobody committed\n");
  if (tree === "unfetchable") git(session, "remote", "set-url", "origin", join(root, "gone.git"));
  script(join(root, "bin", "gh"), ghAnswers(body, edited));
  script(join(root, "bin", "npx"), npx);
  script(join(root, "bin", "claude"), `touch "${spent}"\n`);
  return {
    session,
    spentModel: () => existsSync(spent),
    edited: () => (existsSync(edited) ? readFileSync(edited, "utf8") : ""),
    run: (ticket = "721") => execute(join(BIN, "start"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

export const SAVED_PR = "https://github.com/collod873/claude-workflow/pull/9726";

function readEvent(path: string): string {
  return JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: path } }] } });
}

export function saving({
  remoteRefuses,
  brief,
  streams = {} as Partial<Record<string, string[]>>,
}: { remoteRefuses?: string; brief?: string; streams?: Partial<Record<string, string[]>> } = {}) {
  const root = scratch("save-");
  const { remote, session } = cloned(root, "base");
  const calls = join(root, "gh-calls");
  const argvDir = join(root, "gh-argv");
  const judged = join(root, "judged");
  mkdirSync(argvDir, { recursive: true });
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
      `n=$(( $(ls "${argvDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${argvDir}/$n"`,
      'case "$*" in',
      "  *\"issue view\"*) printf 'Push the branch before anything can refuse it\\n' ;;",
      `  *"pr create"*) printf '%s\\n' '${SAVED_PR}' ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  const argv = (call: number): string[] => readFileSync(join(argvDir, String(call)), "utf8").split("\0").filter((part) => part !== "");
  const argvCalls = (): string[][] => readdirSync(argvDir).map((_, index) => argv(index + 1));
  return {
    session,
    built,
    pushed: () => git(remote, "for-each-ref", "--format=%(objectname)", "refs/heads/ticket/726"),
    judged: () => existsSync(judged),
    calls: () => (existsSync(calls) ? readFileSync(calls, "utf8").trimEnd().split("\n").map((line) => line.split("|")) : []),
    prBody: () => {
      const call = argvCalls().find((args) => args[0] === "pr" && args[1] === "create");
      const at = call?.indexOf("--body") ?? -1;
      return at === -1 ? undefined : call?.[at + 1];
    },
    run: (ticket = "726") => execute(join(BIN, "save"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

const CLOSER_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a closer proves the ticket is done before closing it".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The fix lands - check: `test -f built.txt`",
  "",
  "## Files claimed",
  "",
  "- src/built.ts",
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
  fixes = true,
  readable = true,
  timing = FAST_TIMING,
}: {
  ticket?: string;
  ticketBody?: string;
  fixes?: boolean;
  readable?: boolean;
  timing?: { filed: string; firstCommit: string; rebased?: string; prOpened: string; checksGreen: string; merged: string };
} = {}) {
  const root = scratch("closer-");
  const session = join(root, "session");
  const callsDir = join(root, "gh-calls");
  mkdirSync(callsDir, { recursive: true });
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", "closer@test");
  git(session, "config", "user.name", "closer");
  plant(session, "src/built.ts", "export const built = 1;\n");
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "base");
  git(session, "checkout", "--quiet", "-b", `ticket/${ticket}`);
  if (fixes) plant(session, "built.txt", "done\n");
  git(session, "add", "-A");
  commitAt(session, timing.firstCommit, ["commit", "--quiet", "--allow-empty", "-m", `Build #${ticket} against its failing tests`], timing.rebased);
  git(session, "checkout", "--quiet", "main");
  commitAt(session, timing.merged, ["merge", "--quiet", "--no-ff", "-m", `Merge pull request #900 from collod873/ticket/${ticket}`, `ticket/${ticket}`]);
  script(
    join(root, "bin", "gh"),
    [
      `n=$(( $(ls "${callsDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\n' "$@" >"${callsDir}/$n"`,
      'case "$*" in',
      `  *"issue view"*"createdAt"*) printf '%s\\n' '${timing.filed}' ;;`,
      "  *\"issue view\"*)",
      ...(readable ? [] : ["    printf 'GraphQL: Could not resolve to an issue\\n' >&2", "    exit 1"]),
      "    cat <<'BODY'",
      ticketBody,
      "BODY",
      "    ;;",
      `  *"pr view"*) printf '%s\\n' '${timing.prOpened}' ;;`,
      `  *"pr checks"*) printf '%s\\n' '${timing.checksGreen}' ;;`,
      "  *) exit 0 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  return {
    session,
    calls: () => readdirSync(callsDir).sort((a, b) => Number(a) - Number(b)).map((file) => readFileSync(join(callsDir, file), "utf8")),
    run: () => execute(join(BIN, "close"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }),
  };
}

const REVIEWED_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a green build is read against what was meant before it merges".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] A drift verdict posts every gap - check: `npx vitest run --config vitest.config.ts reviewer`",
  "",
  "## Files claimed",
  "",
  "- src/reviewer.ts",
  "",
].join("\n");

export const JUDGEMENT = "https://github.com/collod873/claude-workflow/pull/9810#issuecomment-1";

export function fileDiff(path: string, added: string): string {
  return `diff --git a/${path} b/${path}\nindex 0000000..1111111 100644\n--- a/${path}\n+++ b/${path}\n@@ -0,0 +1 @@\n+${added}\n`;
}

export function reviewing({
  branch = "ticket/810",
  verdict = { verdict: "match", gaps: [] as string[] },
  diff = fileDiff("src/reviewer.ts", "export const reviewed = 1;"),
}: { branch?: string; verdict?: { verdict: string; gaps: string[] }; diff?: string } = {}) {
  const root = scratch("review-");
  const argvDir = join(root, "gh-argv");
  const handed = join(root, "claude-stdin");
  mkdirSync(argvDir, { recursive: true });
  plant(root, "pr.diff", diff);
  plant(root, "answer.json", `${JSON.stringify({ type: "result", subtype: "success", is_error: false, structured_output: verdict })}\n`);
  script(
    join(root, "bin", "gh"),
    [
      `n=$(( $(ls "${argvDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${argvDir}/$n"`,
      'case "$*" in',
      `  *"pr view"*) printf '%s\\n' '${branch}' ;;`,
      "  *\"issue view\"*)",
      "    cat <<'TICKET'",
      REVIEWED_TICKET,
      "TICKET",
      "    ;;",
      `  *"pr diff"*) cat "${join(root, "pr.diff")}" ;;`,
      `  *"pr comment"*) printf '%s\\n' '${JUDGEMENT}' ;;`,
      "  *) exit 22 ;;",
      "esac",
      "",
    ].join("\n"),
  );
  script(join(root, "bin", "claude"), `cat >"${handed}"\ncat "${join(root, "answer.json")}"\n`);
  const calls = (): string[][] => readdirSync(argvDir).map((_, index) => readFileSync(join(argvDir, String(index + 1)), "utf8").split("\0").filter((part) => part !== ""));
  return {
    spent: () => existsSync(handed),
    handed: () => (existsSync(handed) ? readFileSync(handed, "utf8") : ""),
    comments: () => calls().filter((args) => args[0] === "pr" && args[1] === "comment").map((args) => args[args.indexOf("--body") + 1]),
    run: (pr = "9810") => execute(join(BIN, "review"), root, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [pr]),
  };
}

const FIXED_TICKET = [
  "## Why",
  "",
  'The owner, in session: "a stuck ticket gets one turn from a fresh fixer, never the owner".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The fixer clears a stuck ticket - check: `npx vitest run --config vitest.config.ts ticket-shape`",
  "",
  "## Files claimed",
  "",
  "- src/ticket-shape.ts",
  "",
].join("\n");

export function fixing({
  body = FIXED_TICKET,
  answer = { outcome: "close", reason: "the ticket asks for a stage the ruling has since dropped" } as { outcome: string; reason: string; body?: string },
  turns = [] as string[],
  onPr = [] as string[] | undefined,
  logged = {} as Record<string, string>,
  claude = "",
  npx = CHECK_RED,
} = {}) {
  const root = scratch("fixer-");
  const session = join(root, "session");
  const order = join(root, "order");
  const handed = join(root, "claude-stdin");
  const argvDir = join(root, "gh-argv");
  mkdirSync(argvDir, { recursive: true });
  claimedSession(session, "fixer", { "src/ticket-shape.ts": "export const shaped = 1;\n" }, { "src/ticket-shape.test.ts": AUTHORED_TEST }, "ticket/811");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "Build #811 against its failing tests");
  for (const [name, text] of Object.entries(logged)) plant(session, `.git/machine-logs/${name}`, text);
  plant(root, "ticket.md", body);
  plant(root, "turns.json", JSON.stringify(turns));
  plant(root, "on-pr.json", JSON.stringify(onPr ?? []));
  const result = { type: "result", subtype: "success", is_error: false, session_id: "sess-fix", structured_output: answer };
  plant(root, "answer.jsonl", `${JSON.stringify({ type: "system", session_id: "sess-fix" })}\n${JSON.stringify(result)}\n`);
  script(join(root, "bin", "npx"), npx);
  script(
    join(root, "bin", "gh"),
    [
      `n=$(( $(ls "${argvDir}" 2>/dev/null | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${argvDir}/$n"`,
      `printf 'gh %s %s\\n' "$1" "$2" >>"${order}"`,
      'case "$*" in',
      `  *"issue view"*"comments"*) cat "${join(root, "turns.json")}" ;;`,
      `  *"issue view"*) cat "${join(root, "ticket.md")}" ;;`,
      `  *"pr view"*) ${onPr === undefined ? "exit 1" : `cat "${join(root, "on-pr.json")}"`} ;;`,
      "  *) printf 'https://github.com/collod873/claude-workflow/issues/811#issuecomment-1\\n' ;;",
      "esac",
      "",
    ].join("\n"),
  );
  script(join(root, "bin", "claude"), `printf 'claude\\n' >>"${order}"\ncat >"${handed}"\n${claude}\ncat "${join(root, "answer.jsonl")}"\n`);
  const calls = (): string[][] => readdirSync(argvDir).map((_, index) => readFileSync(join(argvDir, String(index + 1)), "utf8").split("\0").filter((part) => part !== ""));
  const bodyOf = (args: string[]) => args[args.indexOf("--body") + 1];
  return {
    body,
    spent: () => existsSync(handed),
    handed: () => (existsSync(handed) ? readFileSync(handed, "utf8") : ""),
    order: () => (existsSync(order) ? readFileSync(order, "utf8").trimEnd().split("\n") : []),
    calls,
    ticketComments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyOf),
    prComments: () => calls().filter((args) => args[0] === "pr" && args[1] === "comment").map(bodyOf),
    edits: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit").map(bodyOf),
    closes: () => calls().filter((args) => args[0] === "issue" && args[1] === "close"),
    branches: () => git(session, "branch", "--format=%(refname:short)").split("\n"),
    committed: () => git(session, "show", "--name-only", "--format=%s", "HEAD").split("\n").filter((line) => line !== ""),
    run: (ticket = "811") => execute(join(BIN, "fix"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}
