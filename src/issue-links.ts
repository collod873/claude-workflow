import { gh, ghRead, MISSING, Stopped, unread } from "./post.ts";
import type { Blocker } from "./reconcile.ts";

interface Linked {
  number: number;
  state: string;
  repository_url: string;
}

const REPO_OF = /repos\/([^/]+\/[^/]+)$/;
const issuePath = (repo: string, number: number) => `repos/${repo}/issues/${number}`;
const named = (repo: string, number: number) => `${repo}#${number}`;
const linkedOf = ({ number, state, repository_url: url }: Linked): Blocker => ({ repo: REPO_OF.exec(url)?.[1] ?? url, number, open: state === "open" });

const idOf = (repo: string, number: number): string => ghRead(["api", issuePath(repo, number), "--jq", ".id"], `${named(repo, number)} could not be read, so nothing is linked`);

function linked(path: string, field: string, id: string, line: string): void {
  ghRead(["api", "--method", "POST", path, "-F", `${field}=${id}`], line);
}

export const blockersOf = (repo: string, number: number): Blocker[] =>
  (JSON.parse(ghRead(["api", "--paginate", "--slurp", `${issuePath(repo, number)}/dependencies/blocked_by`], `the blockers of ${named(repo, number)} could not be read`)) as Linked[][]).flat().map(linkedOf);

export function addBlocker(repo: string, number: number, blockerRepo: string, blockerNumber: number): void {
  linked(`${issuePath(repo, number)}/dependencies/blocked_by`, "issue_id", idOf(blockerRepo, blockerNumber), `${named(repo, number)} could not be marked blocked by ${named(blockerRepo, blockerNumber)}`);
}

export function parentOf(repo: string, number: number): Blocker | undefined {
  const got = gh(["--missing-answers", "api", `${issuePath(repo, number)}/parent`]);
  if (got.status !== 0 && MISSING.test(got.stderr)) return undefined;
  return got.status === 0 ? linkedOf(JSON.parse(got.stdout) as Linked) : unread(`the parent of ${named(repo, number)} could not be read`);
}

export function addParent(repo: string, number: number, parentRepo: string, parentNumber: number): void {
  linked(`${issuePath(parentRepo, parentNumber)}/sub_issues`, "sub_issue_id", idOf(repo, number), `${named(repo, number)} could not be filed under ${named(parentRepo, parentNumber)}`);
}

const USAGE = "issue-links: usage: issue-links blockers|parent <repo> <number> | add-blocker|add-parent <repo> <number> <other repo> <other number>";
const COMMANDS: Record<string, (args: string[]) => unknown> = {
  blockers: ([repo = "", number = ""]) => blockersOf(repo, Number(number)),
  parent: ([repo = "", number = ""]) => parentOf(repo, Number(number)) ?? null,
  "add-blocker": ([repo = "", number = "", other = "", otherNumber = ""]) => addBlocker(repo, Number(number), other, Number(otherNumber)),
  "add-parent": ([repo = "", number = "", other = "", otherNumber = ""]) => addParent(repo, Number(number), other, Number(otherNumber)),
};

if (import.meta.main) {
  const [command = "", ...args] = process.argv.slice(2);
  const run = COMMANDS[command];
  const arity = command.startsWith("add-") ? 4 : 2;
  if (run === undefined || args.length !== arity || args.some((arg, at) => at % 2 === 1 && !/^\d+$/.test(arg))) {
    console.error(USAGE);
    process.exit(2);
  }
  try {
    const answer = run(args);
    if (answer !== undefined) console.log(JSON.stringify(answer));
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    console.error(`issue-links: ${error.message}`);
    process.exit(1);
  }
}
