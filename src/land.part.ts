import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BIN, LANDED_PR, NOISE, clonedOn, execute, git, harnessEnv, plant, scratch, script, type Run } from "./scenarios.ts";
import { declarePart } from "./part-files.ts";

export function agedLogs(logs: string, tool: string) {
  mkdirSync(logs, { recursive: true });
  const stale = join(logs, `${tool}-0000000-old.log`);
  const fresh = join(logs, `${tool}-1111111-new.log`);
  writeFileSync(stale, "old failure");
  writeFileSync(fresh, "new failure");
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
  utimesSync(stale, eightDaysAgo, eightDaysAgo);
  return { stale, fresh };
}

export const MERGE_REFUSAL = "GraphQL: Pull Request is not mergeable (mergePullRequest)";
export const MAIN_RACED = "GraphQL: Base branch was modified. Review and try the merge again. (mergePullRequest)";
export const GITHUB_ERRED = "GraphQL: Something went wrong while executing your query. Please include `C0B4:2D8E:1A2B3C:1D4E5F:671234AB` when reporting this issue.";

const REFUSALS = { refused: MERGE_REFUSAL, raced: MAIN_RACED, erred: GITHUB_ERRED, blip: "HTTP 502: Bad Gateway (https://api.github.com/graphql)" };

const REQUIRED_CHECKS_EXIT = { pending: 8, passed: 0, failed: 1 };

type RequiredChecks = keyof typeof REQUIRED_CHECKS_EXIT;

export type Merge = "merged" | "mergedErred" | keyof typeof REFUSALS;

export const TICKET_TITLE = "Build what the ticket asks";

function landedBeside(root: string, remote: string, files: Record<string, string>): string {
  const elsewhere = join(root, "elsewhere");
  git(root, "clone", "--quiet", remote, elsewhere);
  for (const [path, content] of Object.entries(files)) plant(elsewhere, path, content);
  git(elsewhere, "add", "-A");
  git(elsewhere, "-c", "user.email=other@test", "-c", "user.name=other", "commit", "--quiet", "--allow-empty", "-m", "another session landed");
  git(remote, "fetch", "--quiet", elsewhere, "HEAD");
  return git(elsewhere, "rev-parse", "HEAD");
}

export type LandStage = "check" | "rebase" | "merge wait";

export function landSession({
  gh,
  remoteRefuses,
  messages = ["change"],
  merges = ["merged"],
  views = ["BLOCKED"],
  mainMovesOnRefusal,
  rounds = "3",
  covered = true,
  green = true,
  changes = {},
  defaultBranch = "main",
  openPr = false,
  treeNode = false,
  required = [],
  hold,
  privateRepo = false,
}: { hold?: LandStage; privateRepo?: boolean; gh?: string; remoteRefuses?: string; messages?: string[]; merges?: Merge[]; views?: string[]; mainMovesOnRefusal?: Record<string, string>; rounds?: string; covered?: boolean; green?: boolean; changes?: Record<string, string>; defaultBranch?: string; openPr?: boolean; treeNode?: boolean; required?: RequiredChecks[] } = {}) {
  const root = scratch("land-");
  const { remote, session } = clonedOn(root, defaultBranch, ["base"]);
  git(remote, "config", "user.email", "github@test");
  git(remote, "config", "user.name", "github");
  for (const [path, content] of Object.entries(changes)) plant(session, path, content);
  if (Object.keys(changes).length > 0) git(session, "add", "-A");
  for (const message of messages) git(session, "commit", "--quiet", "--allow-empty", "-m", message);
  const movedMain = mainMovesOnRefusal === undefined ? undefined : landedBeside(root, remote, mainMovesOnRefusal);
  if (remoteRefuses !== undefined) script(join(remote, "hooks", "pre-receive"), `cat >/dev/null\ncat >&2 <<'REFUSAL'\n${remoteRefuses}\nREFUSAL\nexit 1\n`);
  const state = join(root, "gh-state");
  mkdirSync(state);
  const log = join(state, "argv.jsonl");
  const held = join(state, "held");
  const holding = (stage: LandStage) => (hold === stage ? `[[ -e ${JSON.stringify(held)} ]] || { : >${JSON.stringify(held)}; exec sleep 30; }\n` : "");
  if (hold === "rebase")
    script(join(root, "bin", "git"), `if [[ $1 == rebase && $2 != --abort && ! -e ${JSON.stringify(held)} ]]; then shift; PATH="\${PATH#*:}" exec git rebase -x ${JSON.stringify(`: >${held}; exec sleep 30`)} "$@"; fi\nPATH="\${PATH#*:}" exec git "$@"\n`);
  const counted = (name: string) => `$(( $(ls ${JSON.stringify(state)} | grep -c ${name}-) + 1 ))`;
  script(
    join(root, "bin", "gh"),
    gh ??
      [
        `python3 -c 'import json,sys; print(json.dumps(sys.argv[1:]))' "$@" >> ${JSON.stringify(log)}`,
        `remote=${JSON.stringify(remote)}`,
        `merges=(${merges.join(" ")})`,
        `views=(${views.join(" ")})`,
        `pending=(${required.map((checks) => REQUIRED_CHECKS_EXIT[checks]).join(" ")})`,
        'case "$1 $2" in',
        `  "issue view") echo ${JSON.stringify(TICKET_TITLE)} ;;`,
        `  "api repos/{owner}/{repo}") echo ${String(privateRepo)} ;;`,
        ...(openPr
          ? ['  "pr list") echo ' + LANDED_PR + " ;;", `  "pr create") printf 'a pull request for branch "%s" into branch "${defaultBranch}" already exists:\\n%s\\n' "$5" ${LANDED_PR} >&2; exit 1 ;;`]
          : [`  "pr create") echo ${LANDED_PR} ;;`]),
        '  "api -X")',
        "    sha=${4##*/}",
        '    git -C "$remote" cat-file -e "$sha^{commit}" 2>/dev/null || { printf "gh: No commit found for SHA: %s (HTTP 422)\\n" "$sha" >&2; exit 1; }',
        "    ;;",
        '  "pr view")',
        `    n=${counted("view")}; touch ${JSON.stringify(state)}/view-$n`,
        "    (( n > ${#views[@]} )) && n=${#views[@]}",
        '    echo "${views[n - 1]}"',
        "    ;;",
        '  "pr checks")',
        ...(hold === "merge wait" ? [`    [[ $* == *--watch* ]] && { ${holding("merge wait").trim()}; }`] : []),
        `    n=${counted("checks")}; touch ${JSON.stringify(state)}/checks-$n`,
        "    (( n > ${#pending[@]} )) && exit 0",
        '    exit "${pending[n - 1]}"',
        "    ;;",
        '  "pr close")',
        '    for arg in "$@"; do [[ $arg == --delete-branch ]] && git checkout --quiet ' + defaultBranch + ' 2>/dev/null && git branch --quiet -D "$3"; done',
        "    ;;",
        '  "pr merge")',
        `    n=${counted("merge")}; touch ${JSON.stringify(state)}/merge-$n`,
        "    (( n > ${#merges[@]} )) && n=${#merges[@]}",
        "    if [[ ${merges[n - 1]} == merged* ]]; then",
        "      for (( at = 1; at <= $#; at++ )); do [[ ${!at} == --match-head-commit ]] && { next=$(( at + 1 )); sha=${!next}; }; done",
        `      git -C "$remote" update-ref refs/heads/${defaultBranch} "$(git -C "$remote" commit-tree "$sha^{tree}" -p ${defaultBranch} -p "$sha" -m merged)"`,
        `      [[ \${merges[n - 1]} == mergedErred ]] && { printf '%s\\n' '${GITHUB_ERRED}' >&2; exit 1; }`,
        "    else",
        ...Object.entries(REFUSALS).map(([merge, refusal]) => `      [[ \${merges[n - 1]} == ${merge} ]] && printf '%s\\n' '${refusal}' >&2`),
        ...(movedMain === undefined ? [] : [`      git -C "$remote" update-ref refs/heads/${defaultBranch} ${movedMain}`]),
        "      exit 1",
        "    fi",
        "    ;;",
        "esac",
        "exit 0",
        "",
      ].join("\n"),
  );
  const checks = join(state, "check-calls");
  const covering = covered ? "printf 'check: covered, all 9 steps\\n'" : "printf 'check: due test\\n'\nexit 3";
  const publishing = green ? "printf 'check: green, all 9 steps\\n'" : "printf 'check: red test; log .git/check-logs/test.log\\n'\nexit 1";
  const checkNodes = join(state, "check-nodes");
  const checkCallers = join(state, "check-callers");
  const treeBin = join(root, "tree-bin");
  if (treeNode) script(join(treeBin, "node"), "exit 9\n");
  script(join(root, "bin", "check"), `${holding("check")}printf '%s\\n' "$*" >>${JSON.stringify(checks)}\ncommand -v node >>${JSON.stringify(checkNodes)}\nprintf '%s\\n' "\${CHECK_CALLER-unset}" >>${JSON.stringify(checkCallers)}\nif [[ $* == *--publish* ]]; then\n${publishing}\nelse\n${covering}\nfi\n`);
  const head = git(session, "rev-parse", "HEAD");
  const landEnv = { PATH: `${join(root, "bin")}:${process.env.PATH}`, LAND_ROUNDS: rounds, LAND_PAUSE_SECONDS: "0", ...(treeNode ? { TREE_PATH: treeBin } : {}) };
  return {
    root,
    remote,
    session,
    head,
    branch: `land/${head.slice(0, 12)}`,
    run: (args: string[] = [], from = session) => execute(join(BIN, "land"), from, landEnv, args),
    stoppedWhileHeld: (signal: NodeJS.Signals) => stoppedOnceHeld(join(BIN, "land"), session, { MACHINE_BIN: join(session, "bin"), ...harnessEnv, ...landEnv }, held, signal),
    calls: (): string[][] => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as string[]) : []),
    merged: (call: string[]) => call[0] === "pr" && call[1] === "merge",
    posted: (call: string[]) => call[0] === "api" && call[3]?.startsWith("repos/{owner}/{repo}/statuses/") === true,
    checked: () => (existsSync(checks) ? readFileSync(checks, "utf8").trim().split("\n") : []),
    checkedOn: () => (existsSync(checkNodes) ? readFileSync(checkNodes, "utf8").trim().split("\n") : []),
    checkedAs: () => (existsSync(checkCallers) ? readFileSync(checkCallers, "utf8").trim().split("\n") : []),
    treeBin,
  };
}

function stoppedOnceHeld(file: string, cwd: string, environment: NodeJS.ProcessEnv, held: string, signal: NodeJS.Signals): Promise<Run> {
  return new Promise((resolve) => {
    const child = spawn(file, [], { cwd, env: environment, detached: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const waiting = setInterval(() => {
      if (!existsSync(held)) return;
      clearInterval(waiting);
      process.kill(-(child.pid ?? 0), signal);
    }, 20);
    child.on("close", (status) => {
      clearInterval(waiting);
      resolve({ status, stdout, stderr });
    });
  });
}


declarePart({
  part: {
    name: "bin/land",
    file: "bin/land",
    stops: "https://github.com/collod873/claude-workflow/issues/652",
  },
  scenarios: [
    { label: "landing while gh chatters", run: () => landSession({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\n[[ $2 == create ]] && echo ${LANDED_PR}\nexit 0\n` }).run() },
    { label: "with GitHub refusing the merge while gh chatters", run: () => landSession({ gh: `cat >&2 <<'NOISE'\n${NOISE}\nNOISE\n[[ $2 == create ]] && echo ${LANDED_PR}\n[[ $2 == view ]] && echo BLOCKED\n[[ $2 == merge ]] && exit 1\nexit 0\n` }).run() },
    { label: "with gh pr create failing", run: () => landSession({ gh: `[[ $2 == create ]] || exit 0\ncat >&2 <<'NOISE'\n${NOISE}\nNOISE\nexit 1\n` }).run() },
    { label: "with the push refused", run: () => landSession({ gh: "exit 0\n", remoteRefuses: NOISE }).run() },
    { label: "refusing an em dash in a commit message", run: () => landSession({ gh: "exit 0\n", messages: ["change \u2014 dashed"] }).run() },
  ],
});
