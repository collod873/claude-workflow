import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { execGh } from "../shared/gh";
import { execGit } from "../shared/git";
import { reason } from "../shared/reason";
import { accept, type AcceptDeps, type Verb } from "./accept";

const MACHINE_ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../..");

const VERBS = new Set<string>(["approved", "parked", "killed"]);

function isVerb(value: string | undefined): value is Verb {
  return value !== undefined && VERBS.has(value);
}

function newAdr(title: string, targetWorkspace: string): string {
  return execFileSync(join(MACHINE_ROOT, "bin/new-adr"), [title], {
    encoding: "utf8",
    env: { ...childEnv(), TARGET_WORKSPACE: targetWorkspace },
    cwd: MACHINE_ROOT,
  });
}

function landAdr(draftPath: string, targetWorkspace: string): string {
  return execFileSync(join(MACHINE_ROOT, "bin/new-adr"), ["--land", draftPath], {
    encoding: "utf8",
    env: { ...childEnv(), TARGET_WORKSPACE: targetWorkspace },
    cwd: MACHINE_ROOT,
  });
}

function usage(): never {
  console.error("usage: run-accept.ts --issue <n> --verb <approved|parked|killed>");
  process.exit(1);
}

export function buildAcceptDeps(targetWorkspace: string): AcceptDeps {
  const resolveInTarget = (path: string) => resolvePath(targetWorkspace, path);

  return {
    gh: execGh,
    git: (args) => execGit(["-C", targetWorkspace, ...args]),
    newAdr: (title) => newAdr(title, targetWorkspace),
    landAdr: (draftPath) => landAdr(draftPath, targetWorkspace),
    readFile: (path) => readFileSync(resolveInTarget(path), "utf8"),
    writeFile: (path, content) => writeFileSync(resolveInTarget(path), content, "utf8"),
  };
}

function main(): void {
  const args = process.argv.slice(2);
  const issueIndex = args.indexOf("--issue");
  const verbIndex = args.indexOf("--verb");

  const issueNumber = issueIndex === -1 ? undefined : Number(args[issueIndex + 1]);
  const verb = verbIndex === -1 ? undefined : args[verbIndex + 1];

  if (issueNumber === undefined || !Number.isInteger(issueNumber) || !isVerb(verb)) {
    usage();
  }

  const targetWorkspace = process.env.TARGET_WORKSPACE || process.cwd();

  console.log(`accept: ${JSON.stringify(accept(buildAcceptDeps(targetWorkspace), issueNumber, verb))}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(`accept failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}
