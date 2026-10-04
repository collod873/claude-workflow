import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CHECK_CAP, handedOn, repaired, TAIL_CAP } from "./builder.ts";
import { DIFF_CAP, LIST_CAP, TICKET_CAP } from "./reviewer.ts";
import { authored, BIN, execute, FIXED_TICKET, ghArgv, git, gitRefusing, openedCases, OWNER, type Parent, plant, refusedMark, type Said, scratch, script } from "./scenarios.ts";
import { declareStage, HANDED_ON } from "./stages.ts";

export const FULL_CHECK_RED_ONCE = [
  "if [ -f ../checked ]; then exit 0; fi",
  "touch ../checked",
  "mkdir -p .git/machine-logs",
  "printf -- '--- test ---\\nOTHER-TEST-BROKE in src/stops.test.ts\\n' >.git/machine-logs/check-red.log",
  "printf 'bin/check: FAILED test src/stops.test.ts; log .git/machine-logs/check-red.log\\n'",
  "exit 1",
  "",
].join("\n");

const AUTHORED_TEST = 'import { it } from "vitest";\nit("names the behaviour the criterion asks for", () => {});\n';

export const BUILDER_SESSION = "sess-fix";

const RED_RUN = "555";

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
  answer = { outcome: "code", reason: "the export was never renamed" } as { outcome: string; reason: string; body?: string; tickets?: unknown[] },
  onPr = [] as Said[] | undefined,
  onTicket = [] as Said[],
  logged = {} as Record<string, string>,
  leftover = {} as Record<string, string>,
  claude = "",
  npx = "exit 0\n",
  check = "exit 0\n",
  save = "exit 0\n",
  failedRun = "",
  ranAs = "Build",
  attempt = 1,
  rerun = "exit 0",
  savedSession = undefined as string | undefined,
  reason = undefined as string | undefined,
  captures = {} as Record<string, string>,
  opener = OWNER,
  parent = undefined as Parent,
  labels = ["ticket"],
  markRefusal = undefined as string | undefined,
  unreadable = undefined as string | undefined,
  gitUnreadable = undefined as string | undefined,
  hooks = "",
} = {}) {
  const root = scratch("builder-");
  const session = join(root, "session");
  const home = join(root, "home");
  const spent = join(root, "claude-calls");
  const hires = join(root, "claude-argv");
  const marks = join(root, "mark-calls");
  const saves = join(root, "save-calls");
  const argvDir = join(root, "gh-argv");
  const { setup, calls } = ghArgv(argvDir);
  mkdirSync(spent, { recursive: true });
  mkdirSync(hires, { recursive: true });
  script(join(session, "bin", "check"), check);
  script(join(session, "bin", "mark"), `printf '%s\\n' "$*" >>"${marks}"\n${refusedMark(markRefusal)}`);
  script(join(session, "bin", "save"), `printf '%s\\n' "$*" >>"${saves}"\n${save}`);
  branchedSession(session, "builder", { "src/ticket-shape.ts": "export const shaped = 1;\n" }, { "src/ticket-shape.test.ts": AUTHORED_TEST }, "ticket/811");
  git(session, "commit", "--quiet", "--allow-empty", "-m", "Build #811 against its failing tests");
  const redAt = git(session, "rev-parse", "HEAD");
  for (const [name, text] of Object.entries(logged)) plant(session, `.git/machine-logs/${name}`, text);
  for (const [path, text] of Object.entries(leftover)) plant(session, path, text);
  if (savedSession !== undefined) plant(home, ".claude/builder/811", `${savedSession}\n`);
  for (const [name, text] of Object.entries(captures)) plant(root, `captures/${name}`, text);
  plant(root, "ticket.json", JSON.stringify({ title: "Build what the ticket asks", body, labels: labels.map((name) => ({ name })) }));
  plant(root, "on-pr.json", authored(onPr ?? []));
  plant(root, "on-ticket.json", authored(onTicket));
  plant(root, "failed-run.log", failedRun);
  const result = { type: "result", subtype: "success", is_error: false, session_id: BUILDER_SESSION, structured_output: answer };
  plant(root, "answer.jsonl", `${JSON.stringify({ type: "system", session_id: BUILDER_SESSION })}\n${JSON.stringify(result)}\n`);
  script(join(root, "bin", "npx"), npx);
  script(
    join(root, "bin", "gh"),
    [
      setup,
      'case "$*" in',
      ...(unreadable === undefined ? [] : [`  ${unreadable}) printf 'gh: Server Error (HTTP 502)\\n' >&2; exit 1 ;;`]),
      `  *"api"*"issues/9811/comments"*) cat "${join(root, "on-pr.json")}" ;;`,
      `  *"api"*"issues/811/comments"*) cat "${join(root, "on-ticket.json")}" ;;`,
      ...openedCases(root, opener, body, parent),
      `  *"issue create"*) n=$(( $(cat "${join(root, "created")}" 2>/dev/null || echo 900) + 1 )); printf '%s\\n' "$n" >"${join(root, "created")}"; printf 'https://github.com/collod873/claude-workflow/issues/%s\\n' "$n" ;;`,
      `  *"issue view"*"title,body,labels"*) cat "${join(root, "ticket.json")}" ;;`,
      `  *"pr view"*"number"*) ${onPr === undefined ? "printf 'no pull requests found for branch \"ticket/811\"\\n' >&2; exit 1" : "printf '{\"number\":9811}\\n'"} ;;`,
      `  *"run view"*"--json"*) printf '%s %s %s\\n' '${ranAs}' '${redAt}' '${attempt}' ;;`,
      `  *"run view"*) cat "${join(root, "failed-run.log")}" ;;`,
      `  *"run rerun"*) ${rerun} ;;`,
      "  *\"pr view\"*) exit 22 ;;",
      "  *) printf 'https://github.com/collod873/claude-workflow/issues/811#issuecomment-1\\n' ;;",
      "esac",
      "",
    ].join("\n"),
  );
  if (gitUnreadable !== undefined) gitRefusing(root, gitUnreadable);
  script(
    join(root, "bin", "claude"),
    [`CALL=$(( $(ls "${spent}" | wc -l) + 1 ))`, `printf '%s\\0' "$@" >"${hires}/$CALL"`, `cat >"${spent}/$CALL"`, claude, `cat "${join(root, "answer.jsonl")}"`, ""].join("\n"),
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
    saved: () => listed(saves),
    calls,
    ticketComments: () => calls().filter((args) => args[0] === "issue" && args[1] === "comment").map(bodyOf),
    edits: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit" && args.includes("--body")).map(bodyOf),
    labelled: () => calls().filter((args) => args[0] === "issue" && args[1] === "edit" && !args.includes("--body")).map((args) => args.slice(2).join(" ")),
    filed: () => calls().filter((args) => args[0] === "issue" && args[1] === "create").map(bodyOf),
    closes: () => calls().filter((args) => (args[0] === "issue" || args[0] === "pr") && args[1] === "close"),
    reruns: () => calls().filter((args) => args[0] === "run" && args[1] === "rerun"),
    keptSession: (under = "builder") => {
      const file = join(home, ".claude", under, "811");
      return existsSync(file) ? readFileSync(file, "utf8").trim() : undefined;
    },
    captured: (name: string) => join(root, "captures", name),
    log: (...args: string[]) => git(session, "log", ...args),
    run: (...args: string[]) =>
      execute(join(BIN, "fix"), session, { PATH: `${join(root, "bin")}:${process.env.PATH}`, HOME: home, AGENT_HOOKS_SETTINGS: hooks, SESSION_CAPTURES: join(root, "captures"), ...(reason === undefined ? {} : { REASON: reason }) }, args.length === 0 ? ["811", RED_RUN] : args),
  };
}

declareStage({
  part: { name: "bin/fix", file: "bin/fix", stops: "https://github.com/collod873/claude-workflow/issues/663" },
  prompts: [
    {
      name: "builder building",
      file: "src/builder.ts",
      cap: TICKET_CAP + CHECK_CAP + LIST_CAP + 2 * HANDED_ON,
      slots: ["body", "check", "woken"],
      build: (filled) => handedOn({ ticket: "", body: filled.body ?? "", check: filled.check ?? "", woken: filled.woken ?? "" }),
    },
    {
      name: "builder",
      file: "src/builder.ts",
      cap: TICKET_CAP + TAIL_CAP + DIFF_CAP + 3 * LIST_CAP + HANDED_ON,
      slots: ["body", "failed", "diff", "gaps", "woken"],
      build: (filled) => handedOn({ ticket: "", body: filled.body ?? "", red: { failed: filled.failed ?? "", diff: filled.diff ?? "", gaps: filled.gaps ?? "" }, woken: filled.woken ?? "" }),
    },
    {
      name: "repair",
      file: "src/builder.ts",
      cap: TAIL_CAP + HANDED_ON,
      slots: ["output"],
      build: (filled) => repaired(filled.output ?? ""),
    },
  ],
  scenarios: [
    { label: "pushing a fix", run: () => fixing({ claude: "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n" }).run() },
    { label: "building a ticket", run: () => fixing({ claude: "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n" }).run("811") },
    { label: "with its PR unreadable", run: () => fixing({ unreadable: '*"pr view"*"number"*' }).run() },
    { label: "calling the owner when two rounds in a row change nothing", run: () => fixing({ check: "printf 'bin/check: FAILED test\\n'\nexit 1\n" }).run() },
  ],
});
