import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { onTestFinished } from "vitest";

const TOOLS = ["tsc", "eslint", "knip", "jscpd", "vitest"] as const;
type Tool = (typeof TOOLS)[number];

export interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

const CORE = import.meta.dirname;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_") && !name.startsWith("VITEST")));

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

export function execute(file: string, cwd: string, extra: Record<string, string> = {}): Run {
  const { status, stdout, stderr } = spawnSync(file, [], { cwd, env: { ...env, ...extra }, encoding: "utf8" });
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

export function landSession({ gh, remoteRefuses }: { gh: string; remoteRefuses?: string }) {
  const root = scratch("land-");
  const remote = join(root, "remote.git");
  const session = join(root, "session");
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", remote);
  git(root, "clone", "--quiet", remote, session);
  git(session, "config", "user.email", "session@test");
  git(session, "config", "user.name", "session");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "base");
  git(session, "push", "--quiet", "origin", "main");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "change");
  if (remoteRefuses !== undefined) script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\ncat >&2 <<'REFUSAL'\n${remoteRefuses}\nREFUSAL\nexit 1\n`);
  script(join(root, "bin", "gh"), gh);
  return {
    session,
    run: () => execute(join(CORE, "bin", "land"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, LAND_WAIT_SECONDS: "0" }),
  };
}
