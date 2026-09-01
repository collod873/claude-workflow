import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import { childEnv } from "../shared/child-env";
import { writeCorpusFixture } from "../shared/generate-corpus-fixture";
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
 *
 * `cwd` is the target repo, not wherever this process itself started —
 * `bin/new-adr` reads and writes `docs/adr/` relative to the directory it
 * runs in, and once the machine and target are separate checkouts (#314,
 * ADR-0055) that is never the same directory this file was launched from.
 */
function newAdr(title: string, cwd: string): string {
  return execFileSync("bin/new-adr", [title], { encoding: "utf8", env: childEnv(), cwd });
}

/**
 * `bin/new-adr --land`, the other half of the same tool: it fetches `origin/main`, renames the
 * draft onto the next free number and prints the landed path (ADR-0080). Same `cwd` reasoning as
 * `newAdr` above — the fetch, the rename and the push it makes all have to land in the target's
 * own tree and the target's own `origin`, never the machine's.
 */
function landAdr(draftPath: string, cwd: string): string {
  return execFileSync("bin/new-adr", ["--land", draftPath], { encoding: "utf8", env: childEnv(), cwd });
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

  // `TARGET_WORKSPACE` is set only by the reusable workflow (#314, ADR-0055): the machine checkout
  // this script runs from is a different directory than the checkout `bin/new-adr`, `CONTEXT.md`
  // and the ADR corpus live in once a caller's own checkout is a separate step — the same seam
  // `back-stamp-walk.ts` and `missing-trailer-counter.ts` read for the same reason. Falling back to
  // `process.cwd()` is what lets a local run (or the owner's own shell) hand in nothing and still
  // work, since there the checkout root and the process's own cwd are the same directory.
  const targetWorkspace = process.env.TARGET_WORKSPACE || process.cwd();
  // `path.resolve`, not `path.join`: `newAdr`/`landAdr` hand back an absolute path (`bin/new-adr`
  // derives its own repo root the same way, from where it runs), while `accept.ts` also passes a
  // bare relative one ("CONTEXT.md"). `resolve` leaves the former alone and anchors the latter to
  // the target, which is what `join` cannot do for both in one call.
  const resolveInTarget = (path: string) => resolvePath(targetWorkspace, path);

  const deps: AcceptDeps = {
    gh: execGh,
    git: execGit,
    newAdr: (title) => newAdr(title, targetWorkspace),
    landAdr: (draftPath) => landAdr(draftPath, targetWorkspace),
    regenerateCorpus: () => writeCorpusFixture(targetWorkspace),
    readFile: (path) => readFileSync(resolveInTarget(path), "utf8"),
    writeFile: (path, content) => writeFileSync(resolveInTarget(path), content, "utf8"),
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
