import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

const CORE = import.meta.dirname;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST")));

export interface Step {
  id?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
  run?: string;
}

export function workflowSteps(file: string): Step[] {
  const workflow = parse(readFileSync(join(CORE, "..", file), "utf8")) as { jobs: Record<string, { steps?: Step[] }> };
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
  mkdirSync(join(repo, "core"), { recursive: true });
  copyFileSync(join(CORE, "check"), join(repo, "core", "check"));
  chmodSync(join(repo, "core", "check"), 0o755);
  for (const tool of TOOLS) stubTool(repo, tool, failing[tool]);
  git(repo, "init", "--quiet", "--initial-branch=main");
  git(repo, "config", "user.email", "check@test");
  git(repo, "config", "user.name", "check");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "base");
  return { repo, run: (cwd = repo) => execute(join(cwd, "core", "check"), cwd) };
}

export const wellFormedTicket = [
  "## Why",
  "",
  'The owner, in session: "a ticket is the only way in, so its shape is where intent survives".',
  "",
  "## Acceptance criteria",
  "",
  "- [ ] The filing command refuses a misshapen body - check: `npx vitest run --config core/vitest.config.ts ticket-shape`",
  "",
  "## Files claimed",
  "",
  "- core/ticket-shape.ts",
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
  "- core/**",
  "",
].join("\n");

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
      execute(join(CORE, "bin", "file-issue"), repo, { PATH: `${join(root, "bin")}:${process.env.PATH}` }, args),
  };
}

export function checking(npx: string) {
  const dir = scratch("check-runner-");
  script(join(dir, "bin", "npx"), npx);
  return {
    run: (): Run => {
      const { status, stdout, stderr } = spawnSync("node", [join(CORE, "check-runner.ts")], {
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
      execute(join(CORE, "bin", "app-token"), dir, {
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        GITHUB_ENV: handedOn,
        GITHUB_REPOSITORY: "collod873/claude-workflow",
        CORE_APP_CLIENT_ID: id,
        CORE_APP_PRIVATE_KEY: key,
      }),
  };
}

export function landSession({ gh, remoteRefuses, messages = ["change"] }: { gh: string; remoteRefuses?: string; messages?: string[] }) {
  const root = scratch("land-");
  const remote = join(root, "remote.git");
  const session = join(root, "session");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(root, "clone", "--quiet", remote, session);
  git(session, "config", "user.email", "session@test");
  git(session, "config", "user.name", "session");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "base");
  git(session, "push", "--quiet", "origin", "main");
  for (const message of messages) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
  if (remoteRefuses !== undefined) script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\ncat >&2 <<'REFUSAL'\n${remoteRefuses}\nREFUSAL\nexit 1\n`);
  script(join(root, "bin", "gh"), gh);
  return {
    remote,
    session,
    run: () => execute(join(CORE, "bin", "land"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, LAND_WAIT_SECONDS: "0" }),
  };
}
