import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { regenerateAdrIndex } from "./adr-index";
import { execGit, type GitExec } from "./git";
import { gateVerdict, type GateVerdict } from "./run-gauntlet";

export interface TargetCheckout {
  git: GitExec;
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  writeFile: (path: string, content: string) => void;
  removeFile: (path: string) => void;
  regenerateIndex: () => boolean;
  runGate: () => GateVerdict;
}

function isRegularFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function targetCheckout(repoDir: string): TargetCheckout {
  const inRepo = (path: string) => resolve(repoDir, path);
  return {
    git: (args) => execGit(["-C", repoDir, ...args]),
    readFile: (path) => readFileSync(inRepo(path), "utf8"),
    fileExists: (path) => isRegularFile(inRepo(path)),
    writeFile: (path, content) => {
      mkdirSync(dirname(inRepo(path)), { recursive: true });
      writeFileSync(inRepo(path), content, "utf8");
    },
    removeFile: (path) => rmSync(inRepo(path), { force: true }),
    regenerateIndex: () => regenerateAdrIndex(repoDir),
    runGate: () => gateVerdict(repoDir),
  };
}
