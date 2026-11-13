import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LIST_CAP, onDisk } from "./brief.ts";
import { BRIEFS_CAP, ONE_REVIEWER_CAP, onTheBranch, OUT_OF_TIME } from "./finish.ts";
import { authored, BIN, execute, labelsJson, linesIn, ghArgv, git, key, nulSplit, plant, type Said, scratch, script, wellFormedSpec } from "./scenarios.ts";
import { PAUSED } from "./spelled.ts";
import { declarePart, HANDED_ON } from "./part-files.ts";
import { SPEC_CAP } from "./ticket-shape.ts";

const FINISHED_PR = "https://github.com/collod873/claude-workflow/pull/9974";
const POSTED = "https://github.com/collod873/claude-workflow/issues/974#issuecomment-1";
const FILED_NOTE = "https://github.com/collod873/claude-workflow/issues/975";
const APPROVED: object = { outcome: "approve", reason: "reason $CALL" };

export interface Answered {
  line: number;
  outcome: string;
  ran: string;
}

const specWith = (closing: string[]) => wellFormedSpec.replace(/- \[ \] .*\n$/, closing.map((line) => `- [ ] ${line}\n`).join(""));

export interface Slice {
  id?: string;
  files: Record<string, string>;
  message?: string;
}

export function finishing({
  slices = [{ id: "tenant-time-zone", files: { "src/zone.ts": "export const zone = 1;\n" } }] as Slice[],
  labels = ["spec"] as string[],
  state = "OPEN",
  labelsAtLand = undefined as string[] | undefined,
  closing = ["see the spec land on main"],
  lines = [{ line: 1, outcome: "held", ran: "saw it on main" }] as Answered[],
  reviewer = "",
  answer = APPROVED,
  answerFrom = undefined as { call: number; answer: object } | undefined,
  check = "printf 'check: ok\\n'\n",
  land = "",
  said = [] as Said[],
  appKeyed = false,
  contract = undefined as string | undefined,
  unsetKeys = "",
  gh = "",
  stageMinutes = "",
} = {}) {
  const root = scratch("finish-");
  const session = join(root, "session");
  const bin = join(root, "bin");
  const prompts = join(root, "prompts");
  const hires = join(root, "hires");
  const wheres = join(root, "wheres");
  const tokens = join(root, "tokens");
  const lands = join(root, "lands");
  const approvals = join(root, "approvals");
  const envs = join(root, "envs");
  const checks = join(root, "checks");
  const marks = join(root, "marks");
  const origin = join(root, "origin.git");
  const { setup, calls } = ghArgv(join(root, "gh-argv"));
  git(root, "init", "--quiet", "--initial-branch=main", session);
  git(session, "config", "user.email", "builder@test");
  git(session, "config", "user.name", "builder");
  plant(session, "README.md", "what the spec stands on\n");
  if (contract !== undefined) plant(session, ".claude/contract.json", contract);
  git(session, "add", ".");
  git(session, "commit", "--quiet", "-m", "what the spec stands on");
  git(root, "init", "--quiet", "--bare", origin);
  git(session, "remote", "add", "origin", origin);
  git(session, "update-ref", "refs/remotes/origin/main", "HEAD");
  git(session, "checkout", "--quiet", "-b", "spec/974");
  for (const { id, files, message } of slices) {
    for (const [path, text] of Object.entries(files)) plant(session, path, text);
    git(session, "add", ".");
    git(session, "commit", "--quiet", "-m", id === undefined ? "Build what no slice names" : `${message ?? `Build slice ${id}`}\n\nSlice: ${id}`);
  }
  plant(root, "issue.json", JSON.stringify({ title: "A spec worth finishing", body: specWith(closing), labels: labels.map((name) => ({ name })), state }));
  plant(root, "labels-at-land", (labelsAtLand ?? labels).map((label) => `${label}\n`).join(""));
  plant(root, "comments.json", authored(said));
  const answering = (answered: object) =>
    `${JSON.stringify({ type: "system", session_id: "review-$CALL" })}\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "review-$CALL", structured_output: { lines, ...answered } })}\n`;
  script(
    join(bin, "claude"),
    [
      `mkdir -p "${prompts}" "${hires}" "${wheres}" "${envs}"`,
      `ASKED=$(mktemp "${root}/asked.XXXXXX")`,
      'cat >"$ASKED"',
      `CALL=$(( $(ls "${prompts}" | wc -l) + 1 ))`,
      `printf '%s\\0' "$@" >"${hires}/$CALL"`,
      `mv "$ASKED" "${prompts}/$CALL"`,
      `pwd >"${wheres}/$CALL"`,
      `printf '%s\\n' "\${DATABASE_URL:-}" "\${PORT:-}" "\${TMPDIR:-}" >"${envs}/$CALL"`,
      `ROOT="${root}"`,
      `PROMPT="${prompts}/$CALL"`,
      reviewer,
      ...(answerFrom === undefined
        ? [`cat <<ANSWER\n${answering(answer)}ANSWER`]
        : [`if [ "$CALL" -ge ${answerFrom.call} ]; then`, `cat <<ANSWER\n${answering(answerFrom.answer)}ANSWER`, "else", `cat <<ANSWER\n${answering(answer)}ANSWER`, "fi"]),
      "",
    ].join("\n"),
  );
  script(
    join(bin, "gh"),
    [
      setup,
      `mkdir -p "${tokens}"`,
      `printf '%s' "\${GH_TOKEN:-}" >"${tokens}/$n"`,
      'case "$*" in',
      gh,
      "  *\"repos/{owner}/{repo}/installation\"*) printf '4242\\n' ;;",
      "  *\"access_tokens\"*) printf 'minted-%s\\n' \"$n\" ;;",
      `  *"issue view"*"title,body,labels"*) cat "${join(root, "issue.json")}" ;;`,
      `  *"--json labels,state"*) ${labelsJson(join(root, "labels-at-land"))} ;;`,
      `  *"api"*"issues/974/comments"*) cat "${join(root, "comments.json")}" ;;`,
      `  *"issue comment"*) printf '%s\\n' '${POSTED}' ;;`,
      `  *"issue create"*) printf '%s\\n' '${FILED_NOTE}' ;;`,
      `  *"--jq .id"*) printf '4242\\n' ;;`,
      "esac",
      "",
    ].join("\n"),
  );
  script(join(bin, "check"), `printf '%s\\n' "$*" >>"${checks}"\n${check}`);
  script(join(bin, "docker"), `printf '%s\\n' "$*" >>"${join(root, "docker-calls")}"\ncase $1 in\n  port) printf '127.0.0.1:49153\\n' ;;\nesac\n`);
  script(join(bin, "mark"), `printf '%s\\n' "$*" >>"${marks}"\n`);
  script(join(bin, "land"), `ls "${join(root, "gh-argv")}" | wc -l >>"${join(root, "gh-calls-at-land")}"\nprintf '%s %s %s\\n' "\${GH_TOKEN:-}" "$(git rev-parse HEAD)" "$1 $2" >>"${lands}"\nprintf '%s\\0' "$4" >>"${approvals}"\n${land}\nprintf 'Landed ${FINISHED_PR}\\n'\n`);
  const keyFile = join(root, "app-key.json");
  if (appKeyed) plant(root, "app-key.json", JSON.stringify({ clientId: "Iv1.finish", key: key() }));
  const listed = linesIn;
  const numbered = (dir: string) => (existsSync(dir) ? readdirSync(dir).map((_, at) => readFileSync(join(dir, String(at + 1)), "utf8")) : []);
  return {
    root,
    session,
    handed: () => numbered(prompts),
    isolation: () => numbered(envs).map((env) => env.trimEnd().split("\n")),
    ghCallsAtLand: () => listed(join(root, "gh-calls-at-land")).map(Number),
    dockered: () => linesIn(join(root, "docker-calls")),
    serverPid: () => Number(onDisk(join(root, "server-pid"))),
    wheres: () => numbered(wheres).map((where) => where.trim()),
    hired: () => numbered(hires).map((argv) => argv.split("\0").filter((part) => part !== "")),
    landed: () => listed(lands).map((line) => line.split(" ")),
    approved: () => nulSplit(approvals),
    checked: () => listed(checks),
    marked: () => listed(marks),
    calls,
    tokenOf: (made: (args: string[]) => boolean) => calls().flatMap((args, at) => (made(args) ? [readFileSync(join(tokens, String(at + 1)), "utf8")] : [])),
    log: (...args: string[]) => git(session, "log", ...args),
    pushed: () => git(origin, "log", "--format=%s", "spec/974"),
    run: (...args: string[]) =>
      execute(join(BIN, "finish"), session, { PATH: `${bin}:${process.env.PATH}`, MACHINE_BIN: bin, GH_TOKEN: "job-token", UNSET_KEYS: unsetKeys, STAGE_MINUTES: stageMinutes, ...(appKeyed ? { APP_KEY_FILE: keyFile } : {}) }, args.length === 0 ? ["974"] : args),
  };
}

declarePart({
  part: { name: "bin/finish", file: "bin/finish", stops: "https://github.com/collod873/claude-workflow/issues/1509", lines: 3, printsData: true },
  prompts: [
    {
      name: "spec's reviewer",
      file: "src/finish.ts",
      cap: 2 * SPEC_CAP + 2 * LIST_CAP + ONE_REVIEWER_CAP + BRIEFS_CAP + 2 * HANDED_ON,
      slots: ["commits", "diff", "stat", "title", "body", "closing", "briefs", "unset"],
      build: (filled) =>
        onTheBranch(
          { commits: filled.commits ?? "", diff: filled.diff ?? "", stat: filled.stat ?? "" },
          { spec: "", title: filled.title ?? "", body: filled.body ?? "", closing: [filled.closing ?? ""], commitlint: true, briefs: filled.briefs ?? "", unset: [filled.unset ?? "KEY"] },
        ),
    },
    { name: "spec's reviewer out of time", file: "src/finish.ts", cap: HANDED_ON, slots: [], build: () => OUT_OF_TIME },
  ],
  scenarios: [
    { label: "finishing a spec whose closing line held", run: () => finishing().run() },
    { label: "standing down on paused", run: () => finishing({ labels: ["spec", PAUSED] }).run() },
    { label: "refusing a ticket", run: () => finishing({ labels: ["ticket"] }).run() },
    { label: "refusing a call it does not take", run: () => finishing().run("974", "--now") },
  ],
});
