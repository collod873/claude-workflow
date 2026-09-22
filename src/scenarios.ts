import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { parse } from "yaml";
import { onTestFinished } from "vitest";

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

export interface Step {
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
}

export function workflowSteps(file: string): Step[] {
  const workflow = parse(readFileSync(join(SRC, "..", file), "utf8")) as { jobs: Record<string, { steps?: Step[] }> };
  return Object.values(workflow.jobs).flatMap((job) => job.steps ?? []);
}

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

export const MINTED = "ghs_theAppsInstallationToken";

const ANSWERS = [
  "case \"$*\" in",
  `  *access_tokens*) printf '{"token":"${MINTED}","expires_at":"2026-09-18T00:00:00Z"}\\n' ;;`,
  "  *installation*) printf '{\"id\":4242}\\n' ;;",
  "  *) exit 22 ;;",
  "esac",
  "",
].join("\n");

export function minting({ curl = ANSWERS, key = "an App key the stubbed openssl never reads", id = "Iv23lib7IIhXBUGhytcc" } = {}) {
  const dir = scratch("app-token-");
  const handedOn = join(dir, "github-env");
  writeFileSync(handedOn, "");
  script(join(dir, "bin", "curl"), curl);
  script(join(dir, "bin", "openssl"), "cat >/dev/null\nprintf signature\n");
  return {
    handedOn: () => readFileSync(handedOn, "utf8"),
    run: () =>
      execute(join(BIN, "app-token"), dir, {
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        GITHUB_ENV: handedOn,
        GITHUB_REPOSITORY: "collod873/claude-workflow",
        CORE_APP_CLIENT_ID: id,
        CORE_APP_PRIVATE_KEY: key,
      }),
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

const MAIN_GREEN = '{"check_runs":[{"name":"Core check","conclusion":"success"}]}';
const CHECK_RED = "printf '      Tests  1 failed (1)\\n'\nexit 1\n";
export const MAIN_RED = '{"check_runs":[{"name":"Core check","conclusion":"failure"}]}';

type Tree = "fresh" | "behind" | "dirty" | "branch";

function ghAnswers(body: string, checkRuns: string): string {
  return [
    'case "$*" in',
    '  *"issue view"*)',
    "    cat <<'TICKET'",
    body,
    "TICKET",
    "    ;;",
    `  *check-runs*) printf '%s\\n' '${checkRuns}' ;;`,
    "  *) exit 22 ;;",
    "esac",
    "",
  ].join("\n");
}

export function plant(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export function briefing({
  body = wellFormedTicket,
  claimed = { "src/ticket-shape.ts": "export const shaped = 1;\n" } as Record<string, string>,
  tests = {} as Record<string, string>,
  reads = true,
} = {}) {
  const root = scratch("brief-");
  const session = join(root, "session");
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", "brief@test");
  git(session, "config", "user.name", "brief");
  for (const [path, content] of Object.entries(claimed)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the claim stands on");
  git(session, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (Object.keys(tests).length > 0) {
    git(session, "checkout", "--quiet", "-b", "ticket/722");
    for (const [path, content] of Object.entries(tests)) plant(session, path, content);
    git(session, "add", ".");
    git(session, "commit", "--quiet", "-m", "the author's failing test");
  }
  script(join(root, "bin", "gh"), reads ? ghAnswers(body, MAIN_GREEN) : "exit 22\n");
  return {
    written: () => readFileSync(join(session, ".git", "machine-logs", "brief-722.md"), "utf8"),
    run: (ticket = "722") => execute(join(BIN, "brief"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}

const WROTE_A_TEST = 'printf \'import { it } from "vitest";\\nit("names the behaviour the criterion asks for", () => {});\\n\' >src/ticket-shape.test.ts\n';

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
  script(join(root, "bin", "gh"), reads ? ghAnswers(body, MAIN_GREEN) : "exit 22\n");
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

export function starting({ body = wellFormedTicket, checkRuns = MAIN_GREEN, npx = CHECK_RED, tree = "fresh" as Tree } = {}) {
  const root = scratch("start-");
  const { session } = cloned(root, "base", "the commit a stale tree has not got");
  const spent = join(root, "claude-argv");
  if (tree === "behind") git(session, "reset", "--quiet", "--hard", "HEAD~1");
  if (tree === "branch") git(session, "checkout", "--quiet", "-b", "ticket/721");
  if (tree === "dirty") writeFileSync(join(session, "left-behind.txt"), "work nobody committed\n");
  script(join(root, "bin", "gh"), ghAnswers(body, checkRuns));
  script(join(root, "bin", "npx"), npx);
  script(join(root, "bin", "claude"), `touch "${spent}"\n`);
  return {
    session,
    spentModel: () => existsSync(spent),
    run: (ticket = "721") => execute(join(BIN, "start"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, [ticket]),
  };
}
