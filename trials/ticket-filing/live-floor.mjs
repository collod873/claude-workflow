import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CORE = process.env.TRIAL_CORE;
const { ticketRefusals } = await import(join(CORE, "ticket-shape.ts"));
const { DENIED, stageRefusals } = await import(join(CORE, "deny-list.ts"));

const PROJECTS = "/home/collin/.claude/projects/-home-collin-Claude-Projects-Workflow";
const STRIPPED = "/home/collin/Claude Projects/Knowledge-Base/raw/sessions";

const SUBJECTS = {
  603: {
    asked: "the follow-up on the blocked-by edges that the owner approved at the end of this session, which also replaces #407",
    sessions: [{ id: "ca7a2c5c-ae56-44e4-8fcc-87d7ab02e039", until: "Do that yes" }],
    stripped: ["2026-09-16-ca7a2c5c.md"],
    filedAt: "2026-09-16T15:29:10Z",
  },
  586: {
    asked: "issue #586, carry or rediscover, which the owner approved ticketifying at the end of this session",
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
const READS = ["Read", "Glob", "Grep"];
const WRITES = ["Write", "Edit"];

const FENCED = [
  "//home/collin/Claude Projects/Workflow/**",
  "//home/collin/Claude Projects/Knowledge-Base/**",
  "//home/collin/.claude/**",
];
const SHELL_READERS = ["cat", "head", "tail", "sed", "awk", "less", "more", "grep", "rg", "find", "ls", "cp", "mv", "node", "python3", "python", "bash", "sh", "xargs", "git", "cd"];

function fenceFlags() {
  return [
    ...FENCED.flatMap((path) => [`Read(${path})`, `Edit(${path})`]),
    ...SHELL_READERS.map((command) => `Bash(${command}:*)`),
  ];
}

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
    return acc;
  }, []),
);

const TICKET = args.subject;
const OUT = args.out;
const DRY = args.dry === "1";
const subject = SUBJECTS[TICKET];
if (subject === undefined) throw new Error(`no subject ${TICKET}: ${Object.keys(SUBJECTS).join(", ")}`);

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
  const at = entries.findIndex(
    (entry) => entry.type === "user" && !entry.isMeta && !entry.isSidechain && spoken(entry).trim().startsWith(until),
  );
  if (at === -1) throw new Error(`no owner message starting ${JSON.stringify(until)}`);
  return at + 1;
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
  `Before you go, file the ticket for ${subject.asked}.`,
  "",
  "## How filing works here",
  "",
  "Write the body to a file, then run `core/bin/file-issue ticket --title <title> --body-file <path>`.",
  "Run it as one bare command from the working directory. No `cd`, no `&&`, no `;`, or it will be refused before it starts.",
  "It validates the body and refuses with reasons rather than posting a bad one. If it refuses, fix what it names and run it again.",
  "`docs/agents/ticket-format.md` and `CONTEXT.md` say what a body has to carry, and you may read anything in this working directory.",
  "Your shell runs nothing but that one command. Read, Glob and Grep are how you look around.",
  "",
  "## The conversation",
  "",
  "This is the session, tool noise stripped. The owner often answers only \"yes\" or \"I agree\", so what he asked for is in what he agreed to, not only in his own sentences.",
  "",
  context,
  "",
  "Now file it.",
].join("\n");

writeFileSync(join(OUT, "prompt.txt"), prompt);

const repo = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).stdout.trim();
const pin = spawnSync("git", ["rev-list", "-1", "--first-parent", `--before=${subject.filedAt}`, "main"], { encoding: "utf8" }).stdout.trim();
if (pin === "") throw new Error(`no commit before ${subject.filedAt}`);
const tree = join(mkdtempSync(join(tmpdir(), "live-floor-")), `tree-${TICKET}`);

function pinnedTree() {
  spawnSync("git", ["worktree", "remove", "--force", tree], { encoding: "utf8" });
  const added = spawnSync("git", ["worktree", "add", "--detach", tree, pin], { encoding: "utf8" });
  if (added.status !== 0) throw new Error(`worktree ${pin} failed: ${added.stderr.trim()}`);
  spawnSync("ln", ["-s", join(repo, "node_modules"), join(tree, "node_modules")], { encoding: "utf8" });
  const copied = spawnSync("cp", ["-r", join(repo, "core"), join(tree, "core")], { encoding: "utf8" });
  if (copied.status !== 0) throw new Error(`core would not copy in: ${copied.stderr.trim()}`);
  return { pin, at: spawnSync("git", ["log", "-1", "--format=%cI %s", pin], { encoding: "utf8" }).stdout.trim() };
}

const argv = [
  "--print", "--output-format", "stream-json", "--verbose",
  "--model", MODEL, "--effort", EFFORT, "--setting-sources", "",
  "--allowedTools", [...READS, ...WRITES, "Bash(core/bin/file-issue:*)"].join(","),
  "--disallowedTools", [...DENIED, ...fenceFlags()].join(","),
];
const fenced = stageRefusals("live floor", argv);
if (fenced.length > 0) throw new Error(fenced.join("; "));

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
  tree: { pin, filedAt: subject.filedAt, fenced: FENCED, shellReadersDenied: SHELL_READERS.length },
  promptBytes: prompt.length,
};

if (DRY) {
  writeFileSync(join(OUT, "record.json"), JSON.stringify(record, null, 2));
  console.log(JSON.stringify(record, null, 2));
  process.exit(0);
}

record.tree.built = pinnedTree();
const started = Date.now();
const spent = spawnSync("claude", argv, { input: prompt, encoding: "utf8", cwd: tree, maxBuffer: 512 * 1024 * 1024 });
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

const filings = tools.filter(({ name, input }) => name === "Bash" && /file-issue/.test(input?.command ?? ""));
const posted = (result?.result ?? "").match(/https:\/\/github\.com\/[\w-]+\/[\w-]+\/issues\/(\d+)/);
const filed = posted === null ? null : Number(posted[1]);
const body = filed === null ? "" : gh(["issue", "view", String(filed), "--json", "body", "--jq", ".body"]);
if (filed !== null) writeFileSync(join(OUT, "filed-body.md"), body);

record.run = {
  wallMs: wall,
  status: spent.status,
  toolCalls: tools.length,
  toolNames: tools.map(({ name }) => name),
  filingAttempts: filings.length,
  durationMs: result?.duration_ms ?? null,
  costUsd: result?.total_cost_usd ?? null,
  inputTokens: (result?.usage?.input_tokens ?? 0) + (result?.usage?.cache_creation_input_tokens ?? 0) + (result?.usage?.cache_read_input_tokens ?? 0),
  outputTokens: result?.usage?.output_tokens ?? 0,
  numTurns: result?.num_turns ?? null,
  isError: result?.is_error ?? null,
};
record.filed = filed;
record.body = filed === null ? null : { bytes: body.length, refusals: ticketRefusals(body) };

writeFileSync(join(OUT, "record.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
