import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const HERE = import.meta.dirname;
const REPO = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: HERE, encoding: "utf8" }).stdout.trim();
const CORE = join(REPO, "core");
const { ticketRefusals } = await import(join(CORE, "ticket-shape.ts"));
const { DENIED, stageRefusals } = await import(join(CORE, "deny-list.ts"));

const PROJECTS = "/home/collin/.claude/projects/-home-collin-Claude-Projects-Workflow";
const STRIPPED = "/home/collin/Claude Projects/Knowledge-Base/raw/sessions";

const SUBJECTS = {
  603: {
    asked: "the ticket the owner approved at the end of this session",
    sessions: [{ id: "ca7a2c5c-ae56-44e4-8fcc-87d7ab02e039", until: "Do that yes" }],
    stripped: ["2026-09-16-ca7a2c5c.md"],
    filedAt: "2026-09-16T15:29:10Z",
  },
  586: {
    asked: "the ticket for #586, which the owner approved ticketifying at the end of this session",
    sessions: [
      { id: "0c62c7f3-452a-4b6a-a8ed-7246a8582ef7", until: null },
      { id: "4af6f9ae-0624-450d-9969-494415c0b36c", until: "Yes but you" },
    ],
    stripped: ["2026-09-15-0c62c7f3.md", "2026-09-16-4af6f9ae.md"],
    filedAt: "2026-09-16T01:01:27Z",
  },
};

const MODEL = "opus[1m]";
const EFFORT = "high";

const DOOR = ["bin/file-issue", "check-runner.ts", "post.ts", "ticket-shape.ts", "em-dash.ts", "parts.ts"];

const OFF = [
  "Agent", "CronCreate", "CronDelete", "CronList", "DesignSync", "EnterWorktree", "ExitWorktree",
  "ListAgents", "Monitor", "NotebookEdit", "PushNotification", "RemoteTrigger", "ReportFindings",
  "SendMessage", "Skill", "TaskCreate", "TaskGet", "TaskList", "TaskStop", "TaskUpdate", "ToolSearch",
  "Workflow",
];

const ABSENT = [
  "/home/collin/Claude Projects",
  "/home/collin/.claude/projects",
  "/home/collin/.claude/CLAUDE.md",
  "/home/collin/Claude Projects/Knowledge-Base",
];

const NODE = "/home/collin/.local/node";
const CLAUDE = spawnSync("readlink", ["-f", "/home/collin/.local/bin/claude"], { encoding: "utf8" }).stdout.trim();

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
    return acc;
  }, []),
);

const TICKET = args.subject;
const OUT = args.out;
const CHECK = args.check === "1";
const subject = SUBJECTS[TICKET];
if (subject === undefined) throw new Error(`no subject ${TICKET}: ${Object.keys(SUBJECTS).join(", ")}`);
if (OUT === undefined) throw new Error("no --out");

mkdirSync(OUT, { recursive: true });

function gh(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${argv[0]} ${argv[1]} failed: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

function lines(id) {
  return readFileSync(join(PROJECTS, `${id}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}

function spoken(entry) {
  const content = entry.message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

function endsAt(entries, until) {
  if (until === null) return entries.length;
  const at = entries.filter((entry) => entry.type === "user" && !entry.isMeta && !entry.isSidechain && spoken(entry).trim().startsWith(until));
  if (at.length === 0) throw new Error(`no owner message starting ${JSON.stringify(until)}`);
  if (at.length > 1) throw new Error(`${at.length} owner messages start ${JSON.stringify(until)}, so the cut is ambiguous`);
  return entries.indexOf(at[0]) + 1;
}

function blocks(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  return Array.isArray(content) ? content : [];
}

function rendered(entry) {
  const role = entry.message?.role;
  if (role === undefined) return null;
  const said = [];
  for (const block of blocks(entry.message.content)) {
    if (block.type === "text" && block.text?.trim()) said.push(block.text.trim());
    else if (block.type === "thinking" && block.thinking?.trim()) said.push(`[thinking] ${block.thinking.trim()}`);
    else if (block.type === "tool_use") said.push(`[tool ${block.name}] ${JSON.stringify(block.input)}`);
    else if (block.type === "tool_result") {
      const text = blocks(block.content).filter((inner) => inner.type === "text").map((inner) => inner.text).join("\n");
      if (text.trim()) said.push(`[tool result] ${text.trim()}`);
    }
  }
  return said.length === 0 ? null : `### ${role}\n\n${said.join("\n\n")}`;
}

function trimmed({ id, until }) {
  const all = lines(id);
  const cut = endsAt(all, until);
  const kept = all.slice(0, cut).filter((entry) => (entry.type === "user" || entry.type === "assistant") && !entry.isMeta && !entry.isSidechain);
  const text = kept.map(rendered).filter(Boolean).join("\n\n");
  return { id, rawBytes: readFileSync(join(PROJECTS, `${id}.jsonl`), "utf8").length, entries: all.length, keptThrough: cut, trimmedBytes: text.length, text };
}

function criteriaOf(body) {
  return body
    .replaceAll(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => /^[ \t]*-[ \t]*\[[ xX]\]/.test(line))
    .map((line) => line.replace(/^[ \t]*-[ \t]*\[[ xX]\][ \t]*/, "").split(" - check:")[0].trim())
    .filter((line) => line.length > 40);
}

function leaks(context, body) {
  return criteriaOf(body).filter((criterion) => context.includes(criterion));
}

const historical = gh(["issue", "view", String(TICKET), "--json", "body", "--jq", ".body"]);
const cuts = subject.sessions.map(trimmed);
const context = cuts.map(({ id, text }) => `## Session ${id.slice(0, 8)}\n\n${text}`).join("\n\n");
const leaked = leaks(context, historical);
if (leaked.length > 0) {
  writeFileSync(join(OUT, "leaked.txt"), leaked.join("\n"));
  throw new Error(`the filed body reached the context: ${leaked.length} of its criteria appear verbatim, so this cell would measure copying`);
}

const strippedBytes = subject.stripped.reduce((sum, name) => sum + readFileSync(join(STRIPPED, name), "utf8").length, 0);

const prompt = [
  "You are the session that just had the conversation below, and you are ending it now.",
  `Before you go, file ${subject.asked}.`,
  "",
  "## How filing works here",
  "",
  "Write the body to a file, then run `/opt/door/bin/file-issue ticket --title <title> --body-file <path>`.",
  "That path is the filing door, not anything under `bin/` in the working directory.",
  "It validates the body and refuses with reasons rather than posting a bad one. If it refuses, fix what it names and run it again.",
  "",
  "## The conversation",
  "",
  "This is the session, tool noise stripped.",
  "",
  context,
  "",
  "Now file it.",
].join("\n");

writeFileSync(join(OUT, "prompt.txt"), prompt);

const pin = spawnSync("git", ["rev-list", "-1", "--first-parent", `--before=${subject.filedAt}`, "main"], { cwd: REPO, encoding: "utf8" }).stdout.trim();
if (pin === "") throw new Error(`no commit before ${subject.filedAt}`);

const cell = mkdtempSync(join(tmpdir(), "live-floor-"));
const home = join(cell, "home");
const tree = join(home, "work", "tree");
const door = join(cell, "door");
const capture = join(cell, "capture");

function shallowTree() {
  mkdirSync(tree, { recursive: true });
  const init = spawnSync("git", ["init", "-q", tree], { encoding: "utf8" });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr.trim()}`);
  const fetched = spawnSync("git", ["-c", "protocol.file.allow=always", "fetch", "-q", "--depth=1", `file://${REPO}`, pin], { cwd: tree, encoding: "utf8" });
  if (fetched.status !== 0) throw new Error(`fetch ${pin} failed: ${fetched.stderr.trim()}`);
  const out = spawnSync("git", ["checkout", "-q", "FETCH_HEAD"], { cwd: tree, encoding: "utf8" });
  if (out.status !== 0) throw new Error(`checkout ${pin} failed: ${out.stderr.trim()}`);
  const future = spawnSync("git", ["rev-list", "--all", "--count"], { cwd: tree, encoding: "utf8" }).stdout.trim();
  if (future !== "1") throw new Error(`the clone carries ${future} commits, not only the pin`);
  return spawnSync("git", ["log", "-1", "--format=%cI %s", "FETCH_HEAD"], { cwd: tree, encoding: "utf8" }).stdout.trim();
}

function doorway() {
  for (const name of DOOR) {
    mkdirSync(dirname(join(door, name)), { recursive: true });
    cpSync(join(CORE, name), join(door, name));
  }
  const stub = join(door, "bin", "gh");
  writeFileSync(stub, [
    "#!/bin/bash",
    'if [[ ${1:-} != issue || ${2:-} != create ]]; then printf "gh: %s\\n" "unsupported here" >&2; exit 1; fi',
    "shift 2",
    'title=""; body=""',
    "while (( $# > 0 )); do",
    "  case $1 in",
    "    --title) title=${2:-}; shift 2 ;;",
    "    --body) body=${2:-}; shift 2 ;;",
    "    *) shift ;;",
    "  esac",
    "done",
    'printf "%s" "$title" > /var/capture/title.txt',
    'printf "%s" "$body" > /var/capture/body.md',
    'printf "https://github.com/collod873/claude-workflow/issues/999\\n"',
  ].join("\n"));
  chmodSync(stub, 0o755);
  return readdirSync(door, { recursive: true }).filter((name) => !name.includes("/")).length;
}

function sandbox(argv) {
  return [
    "--ro-bind", "/usr", "/usr",
    "--ro-bind", "/etc", "/etc",
    "--ro-bind", "/mnt/wsl", "/mnt/wsl",
    "--symlink", "usr/bin", "/bin",
    "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64",
    "--symlink", "usr/sbin", "/sbin",
    "--bind", home, "/home/collin",
    "--ro-bind", NODE, NODE,
    "--ro-bind", CLAUDE, "/opt/claude",
    "--ro-bind", door, "/opt/door",
    "--overlay-src", join(REPO, "node_modules"), "--tmp-overlay", "/home/collin/work/tree/node_modules",
    "--bind", capture, "/var/capture",
    "--proc", "/proc",
    "--dev", "/dev",
    "--tmpfs", "/tmp",
    "--tmpfs", "/run",
    "--setenv", "HOME", "/home/collin",
    "--setenv", "PATH", `/opt/door/bin:${NODE}/bin:/usr/local/bin:/usr/bin:/bin`,
    "--chdir", "/home/collin/work/tree",
    ...argv,
  ];
}

function fakeHome() {
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(capture, { recursive: true });
  cpSync("/home/collin/.claude/.credentials.json", join(home, ".claude", ".credentials.json"));
  const real = JSON.parse(readFileSync("/home/collin/.claude.json", "utf8"));
  const kept = { projects: {} };
  for (const key of ["installMethod", "userID", "oauthAccount", "hasCompletedOnboarding", "firstStartTime", "numStartups", "subscriptionNoticeCount", "hasAvailableSubscription"]) {
    if (key in real) kept[key] = real[key];
  }
  writeFileSync(join(home, ".claude.json"), JSON.stringify(kept));
}

function contained() {
  const probe = [
    ...ABSENT.map((path) => `[[ -e "${path}" ]] && printf 'REACHABLE %s\\n' "${path}"`),
    "git -C /home/collin/work/tree rev-list --all --count",
    "command -v file-issue",
    "command -v gh",
    "node -v",
    "ls /home/collin/work/tree/node_modules/.bin/vitest",
    "touch /home/collin/work/tree/node_modules/.write-probe && echo 'node_modules writable'",
  ].join("\n");
  const run = spawnSync("bwrap", sandbox(["bash", "-c", probe]), { encoding: "utf8" });
  const said = `${run.stdout}${run.stderr}`;
  const reachable = said.split("\n").filter((line) => line.startsWith("REACHABLE"));
  if (reachable.length > 0) throw new Error(`the cell can reach what it must not: ${reachable.join("; ")}`);
  if (!said.includes("/opt/door/bin/file-issue")) throw new Error(`the filing door is not on the cell's PATH: ${said.trim()}`);
  if (!said.includes("/opt/door/bin/gh")) throw new Error(`the capture stub is not ahead of gh: ${said.trim()}`);
  return said.trim().split("\n");
}

const argv = [
  "--print", "--output-format", "stream-json", "--verbose",
  "--model", MODEL, "--effort", EFFORT,
  "--setting-sources", "",
  "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
  "--allowedTools", ["Bash", "Read", "Glob", "Grep", "Write", "Edit"].join(","),
  "--disallowedTools", [...DENIED, ...OFF].join(","),
];
const refused = stageRefusals("live floor", argv);
if (refused.length > 0) throw new Error(refused.join("; "));

const record = {
  subject: TICKET,
  floor: "live",
  model: MODEL,
  effort: EFFORT,
  asked: subject.asked,
  context: {
    sessions: cuts.map(({ id, rawBytes, entries, keptThrough, trimmedBytes }) => ({ id, rawBytes, entries, keptThrough, trimmedBytes })),
    rawBytes: cuts.reduce((sum, { rawBytes }) => sum + rawBytes, 0),
    trimmedBytes: context.length,
    strippedBytes,
    againstStripped: Number((context.length / strippedBytes).toFixed(2)),
  },
  historical: { bytes: historical.length, refusals: ticketRefusals(historical) },
  promptBytes: prompt.length,
};

fakeHome();
record.tree = { pin, filedAt: subject.filedAt, at: shallowTree() };
record.door = { files: DOOR, entries: doorway(), posts: false };
record.contained = contained();

if (CHECK) {
  writeFileSync(join(OUT, "record.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  rmSync(cell, { recursive: true, force: true });
  process.exit(0);
}

const started = Date.now();
const spent = spawnSync("bwrap", sandbox(["/opt/claude", ...argv]), { input: prompt, encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
const wall = Date.now() - started;
writeFileSync(join(OUT, "stream.jsonl"), spent.stdout || "");

const tools = [];
let result = null;
for (const line of (spent.stdout || "").split("\n")) {
  if (!line.trim()) continue;
  let parsed;
  try { parsed = JSON.parse(line); } catch { continue; }
  if (parsed.type === "assistant") {
    for (const block of parsed.message?.content ?? []) if (block.type === "tool_use") tools.push({ name: block.name, input: block.input });
  } else if (parsed.type === "result") {
    result = parsed;
  }
}

const filings = tools.filter(({ name, input }) => name === "Bash" && /file-issue[ \t]+ticket\b/.test(input?.command ?? ""));
const throughDoor = filings.filter(({ input }) => input.command.includes("/opt/door/bin/file-issue"));
const captured = readdirSync(capture).includes("body.md");
const body = captured ? readFileSync(join(capture, "body.md"), "utf8") : "";
const title = captured ? readFileSync(join(capture, "title.txt"), "utf8") : "";
if (captured) {
  writeFileSync(join(OUT, "filed-body.md"), body);
  writeFileSync(join(OUT, "filed-title.txt"), title);
}

record.run = {
  wallMs: wall,
  status: spent.status,
  toolCalls: tools.length,
  toolNames: tools.map(({ name }) => name),
  filingAttempts: filings.length,
  throughDoor: throughDoor.length,
  throughOldDoor: filings.length - throughDoor.length,
  durationMs: result?.duration_ms ?? null,
  costUsd: result?.total_cost_usd ?? null,
  inputTokens: (result?.usage?.input_tokens ?? 0) + (result?.usage?.cache_creation_input_tokens ?? 0) + (result?.usage?.cache_read_input_tokens ?? 0),
  outputTokens: result?.usage?.output_tokens ?? 0,
  numTurns: result?.num_turns ?? null,
  isError: result?.is_error ?? null,
};
record.filed = null;
record.captured = captured ? { title, bytes: body.length, refusals: ticketRefusals(body) } : null;

writeFileSync(join(OUT, "record.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
rmSync(cell, { recursive: true, force: true });
