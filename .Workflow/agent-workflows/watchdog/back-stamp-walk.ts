import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ADR_DIR, INDEX_RELATIVE_PATH, regenerateAdrIndex } from "../shared/adr-index";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { deriveBackStamps, type BackStampWrite, type DocFile } from "./back-stamp";

export { INDEX_RELATIVE_PATH };

export interface WalkDeps {
  repoRoot: string;
  readDir: (dir: string) => string[];
  readFile: (path: string) => string;
  writeFile: (path: string, content: string) => void;
  regenerateIndex: () => boolean;
  git: GitExec;
  log?: (line: string) => void;
}

export type WalkAction = "committed" | "clean";

export interface WalkOutcome {
  action: WalkAction;
  stamped: string[];
}

function readCorpus(deps: Pick<WalkDeps, "repoRoot" | "readDir" | "readFile">): DocFile[] {
  let names: string[];
  try {
    names = deps.readDir(join(deps.repoRoot, ADR_DIR));
  } catch {
    return []; 
  }

  return names
    .filter((name) => name.endsWith(".md"))
    .map((name) => `${ADR_DIR}/${name}`)
    .map((path) => ({ path, content: deps.readFile(join(deps.repoRoot, path)) }));
}

export function backStampWalk(deps: WalkDeps): WalkOutcome {
  const log = deps.log ?? ((line: string) => console.log(line));

  const writes = deriveBackStamps(readCorpus(deps));
  if (writes.length === 0) {
    log("clean: no predecessor needs a back-stamp");
    return { action: "clean", stamped: [] };
  }

  for (const write of writes) deps.writeFile(join(deps.repoRoot, write.path), write.content);
  commitAndPush(deps, writes);

  const stamped = writes.map((write) => write.path);
  log(`stamped ${stamped.length}: ${stamped.join(", ")}`);
  return { action: "committed", stamped };
}

function commitAndPush(deps: WalkDeps, writes: BackStampWrite[]): void {
  const { repoRoot } = deps;
  const paths = writes.map((write) => write.path);

  if (deps.regenerateIndex()) paths.push(INDEX_RELATIVE_PATH);

  deps.git(["-C", repoRoot, "add", ...paths]);
  deps.git(["-C", repoRoot, "commit", "-m", commitMessage(writes)]);
  deps.git(["-C", repoRoot, "fetch", "origin", "main"]);
  deps.git(["-C", repoRoot, "rebase", "origin/main"]);
  deps.git(["-C", repoRoot, "push", "origin", "HEAD:main"]);
}

function commitMessage(writes: BackStampWrite[]): string {
  const names = writes.map((write) => write.path.split("/").pop()).join(", ");
  return `Back-stamp ${writes.length} predecessor${writes.length === 1 ? "" : "s"} a trailer already names

docs/adr/README.md said a superseded ADR gains a status line all along, and zero of 43 ever carried
one (ADR-0044); a convention with no reader does not hold. This derives it from the Amends: trailer
its successor already wrote, so nobody has to remember: ${names}.`;
}

async function main(): Promise<void> {
  try {
    const repoRoot = process.env.TARGET_WORKSPACE ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
    const outcome = backStampWalk({
      repoRoot,
      readDir: (dir) => readdirSync(dir),
      readFile: (path) => readFileSync(path, "utf8"),
      writeFile: (path, content) => writeFileSync(path, content),
      regenerateIndex: () => regenerateAdrIndex(repoRoot),
      git: execGit,
    });
    console.log(`${outcome.action}: ${outcome.stamped.length} stamped`);
  } catch (err) {
    console.error(`back-stamp-walk failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
