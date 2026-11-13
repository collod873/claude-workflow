import { rmSync } from "node:fs";
import { commandRefusedIn, git, gitRead } from "./post.ts";
import { quoted } from "./ticket-shape.ts";

type Derived = { files: string[]; run: string };

interface Stop {
  why: string;
  said: string;
}

const CONTRACT = ".claude/contract.json";
const UNREBASED = 3;

const pathsIn = (nulSeparated: string) => nulSeparated.split("\0").filter((path) => path !== "");

const untrackedPaths = () => pathsIn(gitRead(["ls-files", "--others", "--exclude-standard", "-z"], "the untracked files could not be listed"));

function settleMapOf(onto: string): [string, Derived][] {
  const contract = git(["show", `${onto}:${CONTRACT}`]);
  return contract.status === 0 ? Object.entries((JSON.parse(contract.stdout) as { settle?: Record<string, Derived> }).settle ?? {}) : [];
}

const rebuilds = ({ files }: Derived, path: string) => files.map((file) => file.replace(/\/+$/, "")).some((file) => path === file || path.startsWith(`${file}/`));

function ontoSideTaken(onto: string, paths: string[]): void {
  const held = paths.filter((path) => git(["cat-file", "-e", `${onto}:${path}`]).status === 0);
  const absent = paths.filter((path) => !held.includes(path));
  if (held.length > 0) gitRead(["--literal-pathspecs", "checkout", onto, "--", ...held], `${onto}'s ${held.join(", ")} could not be taken`);
  if (absent.length > 0) gitRead(["--literal-pathspecs", "rm", "--quiet", "--force", "--", ...absent], `${absent.join(", ")}, which ${onto} does not have, could not be removed`);
}

async function stoppedSettlingOnto(onto: string, untracked: Set<string>, setupRefused?: () => Promise<string | undefined>): Promise<Stop | undefined> {
  const conflicted = new Set<string>();
  const settling = new Map<string, Derived>();
  const conflicting = () => (conflicted.size === 0 ? "" : `, conflicting in ${[...conflicted].join(", ")}`);
  let settleMap: [string, Derived][] | undefined;
  let step = git(["rebase", "--quiet", onto]);
  while (step.status !== 0) {
    const unmerged = pathsIn(git(["diff", "--name-only", "--diff-filter=U", "-z"]).stdout);
    for (const path of unmerged) conflicted.add(path);
    const entries = (settleMap ??= settleMapOf(onto));
    const rebuilding = unmerged.flatMap((path) => entries.filter(([, derived]) => rebuilds(derived, path)).slice(0, 1));
    if (unmerged.length === 0 || rebuilding.length < unmerged.length) return { why: conflicting(), said: step.stderr };
    ontoSideTaken(onto, unmerged);
    for (const [name, derived] of rebuilding) settling.set(name, derived);
    step = git(["-c", "core.editor=true", "rebase", "--continue"]);
  }
  if (settling.size === 0) return undefined;
  const names = [...settling.keys()].join(", ");
  const unready = await setupRefused?.();
  if (unready !== undefined) return { why: `${conflicting()}, which the settle map's ${names} could not rebuild: its tree's setup failed: ${quoted(unready)}`, said: "" };
  for (const [name, { run }] of settling) {
    const refused = await commandRefusedIn(process.cwd(), run);
    if (refused !== undefined) return { why: `${conflicting()}, which the settle map's ${name} could not rebuild: ${quoted(refused.lastLine)}`, said: refused.output };
  }
  const changed = [...new Set(pathsIn(gitRead(["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z"], "what the settle map changed could not be listed")))].filter((path) => !untracked.has(path));
  const strays = changed.filter((path) => ![...settling.values()].some((derived) => rebuilds(derived, path)));
  if (strays.length > 0) return { why: `${conflicting()}, which the settle map's ${names} rebuilt while changing ${strays.join(", ")} outside its files`, said: "" };
  if (changed.length === 0) return undefined;
  const base = gitRead(["rev-parse", "--short=7", onto], `${onto} could not be read`);
  gitRead(["--literal-pathspecs", "add", "--all", "--", ...changed], "what the settle map rebuilt could not be staged");
  gitRead(["commit", "--quiet", "-m", `chore: settle ${names} after rebasing onto ${onto} at ${base}`], "what the settle map rebuilt could not be committed");
  return undefined;
}

export async function rebaseRefusedOnto(onto: string, setupRefused?: () => Promise<string | undefined>): Promise<{ refusal: string; said: string } | undefined> {
  const began = gitRead(["rev-parse", "HEAD"], "the head of this branch could not be read");
  const untracked = new Set(untrackedPaths());
  const stop = await stoppedSettlingOnto(onto, untracked, setupRefused).catch((error: unknown): Stop => ({ why: `: ${error instanceof Error ? error.message : String(error)}`, said: "" }));
  if (stop === undefined) return undefined;
  git(["rebase", "--abort"]);
  if (git(["rev-parse", "HEAD"]).stdout.trim() !== began) gitRead(["reset", "--quiet", "--hard", began], `this branch could not be put back at ${began}`);
  for (const path of untrackedPaths()) if (!untracked.has(path)) rmSync(path, { force: true });
  return { refusal: `does not rebase cleanly onto ${onto}${stop.why}`, said: stop.said };
}

if (import.meta.main) {
  const [onto] = process.argv.slice(2);
  if (onto === undefined) throw new Error("no ref to rebase onto in the arguments");
  process.chdir(gitRead(["rev-parse", "--show-toplevel"], "the tree's root could not be read"));
  const unrebased = await rebaseRefusedOnto(onto);
  if (unrebased !== undefined) {
    process.stderr.write(unrebased.said);
    console.log(unrebased.refusal);
    process.exit(UNREBASED);
  }
}
