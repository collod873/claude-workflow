import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { makeBareRepo, makeTempRepo, type TempRepo } from "./temp-repo.fixture.ts";

/**
 * @fixture Reached only from `new-adr.proc.test.ts` and `new-research.proc.test.ts`, by design.
 */

const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const MAX_BUFFER = 10 * 1024 * 1024;

export function vendorBin(dir: string, ...names: string[]): void {
  mkdirSync(join(dir, "bin"), { recursive: true });
  for (const name of names) {
    writeFileSync(join(dir, "bin", name), readFileSync(join(REPO_ROOT, "bin", name), "utf8"), { mode: 0o755 });
  }
}

export function newAdrRepo(prefix: string): TempRepo {
  const repo = makeTempRepo(prefix);
  vendorBin(repo.dir, "new-adr", "node-on-path.sh");
  return repo;
}

export function twoAuthorRepo(taken: string): TempRepo {
  const origin = makeBareRepo("new-adr-origin");

  const seed = makeTempRepo("new-adr-seed", { origin });
  seed.write(`docs/adr/${taken}-landed.md`, `# The other author got here first\n\nRecorded 2026-08-27.\n`);
  seed.commit("seed");
  seed.git("push", "--quiet", "origin", "main");

  const work = makeTempRepo("new-adr-work", { origin });
  vendorBin(work.dir, "new-adr", "node-on-path.sh");
  mkdirSync(join(work.dir, "docs/adr"), { recursive: true });
  return work;
}

export function runNewAdr(root: string, args: string[], extraEnv: Record<string, string> = {}): string {
  const env = { ...process.env, ...extraEnv };
  delete env.EDITOR;
  delete env.VISUAL;
  return execFileSync(join(root, "bin/new-adr"), args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
