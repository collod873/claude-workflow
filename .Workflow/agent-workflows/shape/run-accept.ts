import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { execGh } from "../shared/gh";
import { execGit } from "../shared/git";
import { reason } from "../shared/reason";
import { accept, type AcceptDeps, type Verb } from "./accept";

/**
 * The accept's entrypoint: one owner verb, applied to one idea.
 *
 * Separate from `shape.ts` because they are separate lanes of traffic through
 * the same lane — the chain fires on `idea` and spends models, the accept
 * fires on a verb label and spends none. A single entrypoint would make every
 * accept carry the chain's `CLAUDE_CODE_OAUTH_TOKEN` preflight for a job that
 * never spawns a model.
 */

const VERBS = new Set<string>(["approved", "parked", "killed"]);

function isVerb(value: string | undefined): value is Verb {
  return value !== undefined && VERBS.has(value);
}

/**
 * `bin/new-adr`, shelled out to. It prints the path it created, and execs an
 * editor only when its stdout is a terminal — which this never is, because
 * `execFileSync` gives it a pipe.
 *
 * That condition used to be `EDITOR` merely being set, on the reasoning that a
 * runner does not set one. A runner does: the hosted image ships `EDITOR=vi`,
 * so the first accept to reach this line exec'd vi against no terminal and
 * blocked until the job's 10-minute timeout, having already written the ADR it
 * would never push. The guard is in the script rather than in this call's
 * `env`, so a caller cannot forget it.
 */
function newAdr(title: string): string {
  return execFileSync("bin/new-adr", [title], { encoding: "utf8", env: childEnv() });
}

function usage(): never {
  console.error("usage: run-accept.ts --issue <n> --verb <approved|parked|killed>");
  process.exit(1);
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

  const deps: AcceptDeps = {
    gh: execGh,
    git: execGit,
    newAdr,
    readFile: (path) => readFileSync(path, "utf8"),
    writeFile: (path, content) => writeFileSync(path, content, "utf8"),
  };

  console.log(`accept: ${JSON.stringify(accept(deps, issueNumber, verb))}`);
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
