import { rmSync, writeFileSync } from "node:fs";
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

type OntoStage = 2 | 3;

function ontoSideTaken(onto: string, paths: string[], ontoStage: OntoStage): void {
  const whole = paths.filter((path) => !ontoHunksTaken(path, ontoStage));
  const held = whole.filter((path) => git(["cat-file", "-e", `${onto}:${path}`]).status === 0);
  const absent = whole.filter((path) => !held.includes(path));
  if (held.length > 0) gitRead(["--literal-pathspecs", "checkout", onto, "--", ...held], `${onto}'s ${held.join(", ")} could not be taken`);
  if (absent.length > 0) gitRead(["--literal-pathspecs", "rm", "--quiet", "--force", "--", ...absent], `${absent.join(", ")}, which ${onto} does not have, could not be removed`);
}

function ontoHunksTaken(path: string, ontoStage: OntoStage): boolean {
  const [base = ".", stage2 = ".", stage3 = "."] = gitRead(["--literal-pathspecs", "checkout-index", "--stage=all", "--temp", "--", path], `the sides of ${path} could not be read`).split("\t")[0]?.split(" ") ?? [];
  const [ontoSide, branchSide] = ontoStage === 2 ? [stage2, stage3] : [stage3, stage2];
  try {
    if (ontoSide === "." || branchSide === ".") return false;
    const merged = git(["merge-file", "-p", "--ours", ontoSide, base === "." ? "/dev/null" : base, branchSide]);
    if (merged.status !== 0) return false;
    writeFileSync(path, merged.stdout);
    gitRead(["--literal-pathspecs", "add", "--", path], `${path}, settled on the onto side, could not be staged`);
    return true;
  } finally {
    for (const temp of [base, stage2, stage3]) if (temp !== ".") rmSync(temp, { force: true });
  }
}

type SetupRefused = () => Promise<string | undefined>;

const unmergedPaths = () => pathsIn(git(["diff", "--name-only", "--diff-filter=U", "-z"]).stdout);

const conflictingIn = (paths: Iterable<string>) => {
  const listed = [...paths];
  return listed.length === 0 ? "" : `, conflicting in ${listed.join(", ")}`;
};

function rebuildersOf(entries: [string, Derived][], unmerged: string[]): [string, Derived][] | undefined {
  const rebuilding = unmerged.flatMap((path) => entries.filter(([, derived]) => rebuilds(derived, path)).slice(0, 1));
  return unmerged.length > 0 && rebuilding.length === unmerged.length ? rebuilding : undefined;
}

async function rebuiltPaths(settling: Map<string, Derived>, conflicting: string, untracked: Set<string>, setupRefused?: SetupRefused): Promise<Stop | string[]> {
  const names = [...settling.keys()].join(", ");
  const unready = await setupRefused?.();
  if (unready !== undefined) return { why: `${conflicting}, which the settle map's ${names} could not rebuild: its tree's setup failed: ${quoted(unready)}`, said: "" };
  for (const [name, { run }] of settling) {
    const refused = await commandRefusedIn(process.cwd(), run);
    if (refused !== undefined) return { why: `${conflicting}, which the settle map's ${name} could not rebuild: ${quoted(refused.lastLine)}`, said: refused.output };
  }
  const changed = [...new Set(pathsIn(gitRead(["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z"], "what the settle map changed could not be listed")))].filter((path) => !untracked.has(path));
  const strays = changed.filter((path) => ![...settling.values()].some((derived) => rebuilds(derived, path)));
  if (strays.length > 0) return { why: `${conflicting}, which the settle map's ${names} rebuilt while changing ${strays.join(", ")} outside its files`, said: "" };
  if (changed.length > 0) gitRead(["--literal-pathspecs", "add", "--all", "--", ...changed], "what the settle map rebuilt could not be staged");
  return changed;
}

async function stoppedSettlingOnto(onto: string, untracked: Set<string>, setupRefused?: SetupRefused): Promise<Stop | undefined> {
  const conflicted = new Set<string>();
  const settling = new Map<string, Derived>();
  let settleMap: [string, Derived][] | undefined;
  let step = git(["rebase", "--quiet", onto]);
  while (step.status !== 0) {
    const unmerged = unmergedPaths();
    for (const path of unmerged) conflicted.add(path);
    const rebuilding = rebuildersOf((settleMap ??= settleMapOf(onto)), unmerged);
    if (rebuilding === undefined) return { why: conflictingIn(conflicted), said: step.stderr };
    ontoSideTaken(onto, unmerged, 2);
    for (const [name, derived] of rebuilding) settling.set(name, derived);
    step = git(["-c", "core.editor=true", "rebase", "--continue"]);
  }
  if (settling.size === 0) return undefined;
  const rebuilt = await rebuiltPaths(settling, conflictingIn(conflicted), untracked, setupRefused);
  if (!Array.isArray(rebuilt)) return rebuilt;
  if (rebuilt.length === 0) return undefined;
  const base = gitRead(["rev-parse", "--short=7", onto], `${onto} could not be read`);
  gitRead(["commit", "--quiet", "-m", `chore: settle ${[...settling.keys()].join(", ")} after rebasing onto ${onto} at ${base}`], "what the settle map rebuilt could not be committed");
  return undefined;
}

async function stoppedMergingOnto(onto: string, untracked: Set<string>, setupRefused?: SetupRefused): Promise<Stop | undefined> {
  const base = gitRead(["rev-parse", "--short=7", onto], `${onto} could not be read`);
  const message = `chore: merge ${onto} at ${base}, since this branch's commits replay into a conflict its merge does not have`;
  const merge = git(["merge", "--quiet", "--no-edit", "-m", message, onto]);
  if (merge.status === 0) return undefined;
  const unmerged = unmergedPaths();
  const rebuilding = rebuildersOf(settleMapOf(onto), unmerged);
  if (rebuilding === undefined) return { why: conflictingIn(unmerged), said: merge.stderr };
  ontoSideTaken(onto, unmerged, 3);
  const settling = new Map(rebuilding);
  const rebuilt = await rebuiltPaths(settling, conflictingIn(unmerged), untracked, setupRefused);
  if (!Array.isArray(rebuilt)) return rebuilt;
  gitRead(["commit", "--quiet", "-m", `${message}, settling ${[...settling.keys()].join(", ")}`], "the merge the settle map rebuilt could not be committed");
  return undefined;
}

const stopOf = (error: unknown): Stop => ({ why: `: ${error instanceof Error ? error.message : String(error)}`, said: "" });

function putBack(began: string, untracked: Set<string>): void {
  gitRead(["reset", "--quiet", "--hard", began], `this branch could not be put back at ${began}`);
  for (const path of untrackedPaths()) if (!untracked.has(path)) rmSync(path, { force: true });
}

export async function rebaseRefusedOnto(onto: string, setupRefused?: SetupRefused): Promise<{ refusal: string; said: string } | undefined> {
  const began = gitRead(["rev-parse", "HEAD"], "the head of this branch could not be read");
  const untracked = new Set(untrackedPaths());
  const rebaseStop = await stoppedSettlingOnto(onto, untracked, setupRefused).catch(stopOf);
  if (rebaseStop === undefined) return undefined;
  git(["rebase", "--abort"]);
  putBack(began, untracked);
  const mergeStop = await stoppedMergingOnto(onto, untracked, setupRefused).catch(stopOf);
  if (mergeStop === undefined) return undefined;
  git(["merge", "--abort"]);
  putBack(began, untracked);
  return { refusal: `does not merge cleanly with ${onto}${mergeStop.why}`, said: `${rebaseStop.said}${mergeStop.said}` };
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
