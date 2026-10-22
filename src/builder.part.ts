import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handedOn, repaired } from "./builder.ts";
import { handedOn as reviewing } from "./reviewer.ts";
import { DIFF_CAP, LIST_CAP, TAIL_CAP, TICKET_CAP } from "./brief.ts";
import { authored, BIN, execute, FIXED_TICKET, ghArgv, git, gitRefusing, openedCases, type Parent, plant, refusedMark, type Said, scratch, script } from "./scenarios.ts";
import { OWNER } from "./spelled.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const CHECK_PASSES = "printf 'check: ok, 8 steps in 1.0s\\n'\n";
export const CHECK_RED = "printf 'check: red test src/stops.test.ts:4; log /nowhere/check-full.log\\n'\nexit 1\n";

export const FULL_CHECK_RED_ONCE = [
  `if [ -f ../checked ]; then ${CHECK_PASSES.trim()}; exit 0; fi`,
  "touch ../checked",
  "mkdir -p .git/check/logs",
  "printf -- '--- test ---\\nOTHER-TEST-BROKE in src/stops.test.ts\\n' >.git/check/logs/check-full-red.log",
  "printf 'check: red test src/stops.test.ts:4; log %s/.git/check/logs/check-full-red.log\\n' \"$PWD\"",
  "exit 1",
  "",
].join("\n");

const AUTHORED_TEST = 'import { it } from "vitest";\nit("names the behaviour the criterion asks for", () => {});\n';

export const BUILDER_SESSION = "sess-fix";
export const SPENT_BY_THE_THIRD_ROUND = '[ "$CALL" -ge 3 ] && exit 124\n';

function branchedSession(session: string, who: string, onMain: Record<string, string>, tests: Record<string, string>, branch: string): void {
  mkdirSync(session, { recursive: true });
  git(session, "init", "--quiet", "--initial-branch=main");
  git(session, "config", "user.email", `${who}@test`);
  git(session, "config", "user.name", who);
  for (const [path, content] of Object.entries(onMain)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the build stands on");
  git(session, "remote", "add", "origin", session);
  git(session, "update-ref", "refs/remotes/origin/main", "HEAD");
  if (Object.keys(tests).length === 0) return;
  git(session, "checkout", "--quiet", "-b", branch);
  for (const [path, content] of Object.entries(tests)) plant(session, path, content);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "the author's failing test");
}

export function fixing({
  body = FIXED_TICKET,
  answer = { outcome: "code", reason: "the export was never renamed" } as { outcome: string; reason: string; body?: string; tickets?: unknown[]; steps?: unknown[] },
  review = { outcome: "approve", reason: "it builds the Why" } as { outcome: string; reason: string; steps?: unknown[] },
  reviewer = "",
  land = "",
  onTicket = [] as Said[],
  leftover = {} as Record<string, string>,
  claude = "",
  npx = "exit 0\n",
  check = CHECK_PASSES,
  contract = undefined as string | undefined,
  onMain = {} as Record<string, string>,
  savedSession = undefined as string | undefined,
  captures = {} as Record<string, string>,
  opener = OWNER,
  parent = undefined as Parent,
  labels = ["ticket"],
  markRefusal = undefined as string | undefined,
  unreadable = undefined as string | undefined,
  gitUnreadable = undefined as string | undefined,
  treePath = {} as Record<string, string>,
  nodeLauncher = false,
  calledFrom = undefined as string | undefined,
  stageMinutes = "",
  ticket = "811",
  repo = "collod873/Lumaria",
  openTickets = [] as { number: number; title: string; body: string }[],
} = {}) {
  const root = scratch("builder-");
  const session = join(root, "session");
  const home = join(root, "home");
  const spent = join(root, "claude-calls");
  const hires = join(root, "claude-argv");
  const marks = join(root, "mark-calls");
  const lands = join(root, "land-calls");
  const closes = join(root, "close-calls");
  const argvDir = join(root, "gh-argv");
  const machine = join(root, "machine", "bin");
  const ranIn = join(root, "ran-in");
  const opens = join(root, "pr-opens");
  const caps = join(root, "caps");
  const { setup, calls } = ghArgv(argvDir);
  mkdirSync(spent, { recursive: true });
  mkdirSync(hires, { recursive: true });
  script(join(root, "bin", "check"), `printf 'check %s\\n' "$PWD" >>"${ranIn}"\n${check}`);
  script(join(machine, "mark"), `printf '%s\\n' "$*" >>"${marks}"\n${refusedMark(markRefusal)}`);
  script(join(machine, "land"), `printf '%s %s\\n' "$(git rev-parse HEAD)" "$*" >>"${lands}"\n${land}\nprintf 'Landed https://github.com/%s/pull/9${ticket}\\n' "\${GH_REPO:-collod873/claude-workflow}"\n`);
  script(join(root, "bin", "timeout"), `printf '%s\\n' "$2" >>"${caps}"\nshift 2\nexec "$@"\n`);
  script(join(machine, "close"), `printf '%s\\n' "$*" >>"${closes}"\n`);
  branchedSession(session, "builder", { "src/ticket-shape.ts": "export const shaped = 1;\n", ...onMain, ...(contract === undefined ? {} : { ".claude/contract.json": contract }) }, { "src/ticket-shape.test.ts": AUTHORED_TEST }, `ticket/${ticket}`);
  git(session, "commit", "--quiet", "--allow-empty", "-m", `Build #${ticket} against its failing tests`);
  for (const [path, text] of Object.entries(leftover)) plant(session, path, text);
  if (savedSession !== undefined) plant(home, `.claude/builder/${ticket}`, `${savedSession}\n`);
  for (const [name, text] of Object.entries(captures)) plant(root, `captures/${name}`, text);
  plant(root, "ticket.json", JSON.stringify({ title: "Build what the ticket asks", body, labels: labels.map((name) => ({ name })) }));
  plant(root, "ticket-body", body);
  plant(root, "on-ticket.json", authored(onTicket));
  plant(root, "labels", labels.map((label) => `${label}\n`).join(""));
  plant(root, "open-tickets.json", JSON.stringify(openTickets));
  const answering = (output: object) => `${JSON.stringify({ type: "system", session_id: BUILDER_SESSION })}\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: BUILDER_SESSION, structured_output: output })}\n`;
  plant(root, "answer.jsonl", answering(answer));
  plant(root, "review.jsonl", answering(review));
  script(join(root, "bin", "npx"), npx);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      `printf 'gh %s\\n' "$PWD" >>"${ranIn}"`,
      'case "$*" in',
      ...(unreadable === undefined ? [] : [`  ${unreadable}) printf 'gh: Bad credentials (HTTP 401)\\n' >&2; exit 1 ;;`]),
      `  *"api"*"issues/${ticket}/comments"*) cat "${join(root, "on-ticket.json")}" ;;`,
      ...openedCases(root, opener, body, parent, ticket),
      `  *"issue list"*) cat "${join(root, "open-tickets.json")}" ;;`,
      `  *"issue create"*) n=$(( $(cat "${join(root, "created")}" 2>/dev/null || echo 900) + 1 )); printf '%s\\n' "$n" >"${join(root, "created")}"; printf 'https://github.com/collod873/claude-workflow/issues/%s\\n' "$n" ;;`,
      `  *"issue view"*"title,body,labels"*) cat "${join(root, "ticket.json")}" ;;`,
      `  *"issue view"*"body,title"*) printf 'Build what the ticket asks\\001%s' "$(cat "${join(root, "ticket-body")}")" ;;`,
      `  *"issue view"*"labels"*"--jq"*) cat "${join(root, "labels")}" ;;`,
      `  *) printf 'https://github.com/collod873/claude-workflow/issues/${ticket}#issuecomment-1\\n' ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  for (const [name, body] of Object.entries(treePath)) script(join(root, "tree-bin", name), body);
  if (gitUnreadable !== undefined) gitRefusing(root, gitUnreadable);
  if (nodeLauncher) {
    writeFileSync(join(root, "bin", "claude"), `#!/usr/bin/env node\nrequire("node:fs").appendFileSync("../pinned-ran", \`launcher \${process.version}\\n\`);\nprocess.exitCode = require("node:child_process").spawnSync("bash", [${JSON.stringify(join(root, "bin", "claude-sh"))}, ...process.argv.slice(2)], { stdio: "inherit" }).status ?? 1;\n`);
    chmodSync(join(root, "bin", "claude"), 0o755);
  }
  script(
    join(root, "bin", nodeLauncher ? "claude-sh" : "claude"),
    [
      `CALL=$(( $(ls "${spent}" | wc -l) + 1 ))`,
      `printf 'claude %s\\n' "$PWD" >>"${ranIn}"`,
      `printf '%s\\0' "$@" >"${hires}/$CALL"`,
      `cat >"${spent}/$CALL"`,
      `if grep -q '"approve"' "${hires}/$CALL"; then`,
      reviewer,
      `  cat "${join(root, "review.jsonl")}"`,
      "else",
      claude,
      `  cat "${join(root, "answer.jsonl")}"`,
      "fi",
      "",
    ].join("\n"),
  );
  const listed = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").trimEnd().split("\n") : []);
  const numbered = (dir: string) => readdirSync(dir).map((_, index) => readFileSync(join(dir, String(index + 1)), "utf8"));
  const bodyOf = (args: string[]) => args[args.indexOf("--body") + 1];
  return {
    body,
    session,
    handed: () => numbered(spent),
    hired: () => numbered(hires).map((argv) => argv.split("\0").filter((part) => part !== "")),
    marked: () => listed(marks),
    landed: () => listed(lands),
    closed: () => listed(closes),
    capped: () => listed(caps),
    calls,
    ranIn: () => [...new Set(listed(ranIn))],
    ticketComments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyOf),
    edits: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit" && args.includes("--body")).map(bodyOf),
    labelled: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit" && !args.includes("--body")).map((args) => args.slice(2).join(" ")),
    filed: () => calls().filter((args) => args[0] === "issue" && args[1] === "create").map(bodyOf),
    closes: () => calls().filter((args) => (args[0] === "issue" || args[0] === "pr") && args[1] === "close"),
    keptSession: (under = "builder") => {
      const file = join(home, ".claude", under, ticket);
      return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
    },
    captured: (name: string) => join(root, "captures", name),
    log: (...args: string[]) => git(session, "log", ...args),
    run: (...args: string[]) =>
      execute(join(BIN, "fix"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, HOME: home, MACHINE_BIN: machine, SESSION_CAPTURES: join(root, "captures"), STAGE_MINUTES: stageMinutes, ...(calledFrom === undefined ? {} : { CALLED_FROM: calledFrom, GH_REPO: repo }), ...(Object.keys(treePath).length === 0 ? {} : { TREE_PATH: join(root, "tree-bin") }) }, args.length === 0 ? [ticket] : args),
  };
}

declareStage({
  part: { name: "bin/fix", file: "bin/fix", stops: "https://github.com/collod873/claude-workflow/issues/663", lines: 2 },
  prompts: [
    {
      name: "builder building",
      file: "src/builder.ts",
      cap: TICKET_CAP + 2 * LIST_CAP + 2 * HANDED_ON,
      slots: ["body", "woken", "alongside"],
      build: (filled) => handedOn({ ticket: "", body: filled.body ?? "", woken: filled.woken ?? "", alongside: filled.alongside ?? "", commitlint: true, foreign: true }),
    },
    {
      name: "repair",
      file: "src/builder.ts",
      cap: TAIL_CAP + HANDED_ON,
      slots: ["output"],
      build: (filled) => repaired(filled.output ?? ""),
    },
    {
      name: "reviewer",
      file: "src/reviewer.ts",
      cap: TICKET_CAP + 2 * LIST_CAP + DIFF_CAP + HANDED_ON,
      slots: ["body", "commits", "diff", "stat", "alongside"],
      build: (filled) => reviewing({ ticket: "", body: filled.body ?? "", commits: filled.commits ?? "", diff: filled.diff ?? "", stat: filled.stat ?? "", alongside: filled.alongside ?? "", commitlint: true }),
    },
  ],
  scenarios: [
    { label: "building, reviewing and landing a ticket", run: () => fixing({ claude: "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n" }).run() },
    { label: "with its labels unreadable at review", run: () => fixing({ claude: "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n", unreadable: '*"issue view"*"labels"*"--jq"*' }).run() },
    { label: "calling the owner when the check stays red to the stage's time cap", run: () => fixing({ check: CHECK_RED, claude: SPENT_BY_THE_THIRD_ROUND, stageMinutes: "1" }).run() },
  ],
});
