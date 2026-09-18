import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CORE = process.env.TRIAL_CORE;
const { checks } = await import(join(CORE, "ticket-shape.ts"));
const { runCheck } = await import(join(CORE, "check-runner.ts"));
const { denyFlags, stageRefusals } = await import(join(CORE, "deny-list.ts"));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
    return acc;
  }, []),
);

const TICKET = args.ticket;
const CELL = args.cell;
const OUT = args.out;
const BRANCH = `trial/${CELL}`;
const MODEL = "sonnet";
const WRITES = ["Read", "Edit", "Write"];

mkdirSync(OUT, { recursive: true });

function git(argv) {
  return spawnSync("git", argv, { encoding: "utf8" });
}

function gh(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${argv[0]} ${argv[1]} failed: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

function testFiles() {
  return git(["status", "--porcelain", "-uall", "--", "*.test.ts"]).stdout.split("\n").filter((l) => l.length > 3).map((l) => l.slice(3));
}

function committedTests() {
  const r = git(["diff", "--name-only", "origin/main...HEAD"]);
  return r.stdout.split("\n").filter((p) => /\.test\.ts$/.test(p));
}

function hashes(paths) {
  return Object.fromEntries(paths.map((p) => [p, git(["hash-object", p]).stdout.trim()]));
}

function metrics(streamText) {
  const tools = [];
  let result = null;
  for (const line of streamText.split("\n")) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "assistant") {
      for (const b of j.message?.content ?? []) if (b.type === "tool_use") tools.push(b.name);
    } else if (j.type === "result") result = j;
  }
  const firstEdit = tools.findIndex((t) => t === "Edit" || t === "Write");
  return {
    toolCalls: tools.length,
    toolCallsBeforeFirstEdit: firstEdit === -1 ? null : firstEdit,
    tools,
    durationMs: result?.duration_ms ?? null,
    costUsd: result?.total_cost_usd ?? null,
    inputTokens: (result?.usage?.input_tokens ?? 0) + (result?.usage?.cache_creation_input_tokens ?? 0) + (result?.usage?.cache_read_input_tokens ?? 0),
    outputTokens: result?.usage?.output_tokens ?? 0,
    numTurns: result?.num_turns ?? null,
    isError: result?.is_error ?? null,
  };
}

const authored = testFiles();
if (authored.length === 0) throw new Error(`${CELL} has no authored test to build against`);
git(["checkout", "--quiet", "-b", BRANCH]);
git(["add", "--", "*.test.ts"]);
const staged = git(["commit", "--quiet", "-m", `Hold #${TICKET} to one failing test per criterion`]);
if (staged.status !== 0) throw new Error(`${CELL} tests would not commit: ${staged.stderr}`);

const briefed = spawnSync(join(CORE, "bin", "brief"), [TICKET], { encoding: "utf8" });
if (briefed.status !== 0) throw new Error(`${CELL} brief refused: ${briefed.stderr.trim()}`);
const briefPath = join(git(["rev-parse", "--path-format=absolute", "--git-common-dir"]).stdout.trim(), "core-logs", `brief-${TICKET}.md`);
const briefText = readFileSync(briefPath, "utf8");
writeFileSync(join(OUT, "brief.md"), briefText);

const body = gh(["issue", "view", TICKET, "--json", "body", "--jq", ".body"]);
const commands = checks(body).map(({ command }) => command);
const before = hashes(committedTests());

const prompt = [
  briefText,
  "## What to build",
  `Make every one of those failing tests pass, and change nothing else. Your check commands are ${commands.map((c) => `\`${c}\``).join(", ")}.`,
  "You may not edit a test file. The tests are the specification; if one of them is wrong, say so and stop rather than changing it.",
  "You are done when every check command ends green.",
  "",
].join("\n\n");

const argv = [
  "--print", "--output-format", "stream-json", "--verbose",
  "--model", MODEL, "--setting-sources", "",
  "--allowedTools", [...WRITES, ...commands.map((c) => `Bash(${c})`)].join(","),
  ...denyFlags(),
];
const fenced = stageRefusals("builder", argv);
if (fenced.length > 0) throw new Error(fenced.join("; "));

const started = Date.now();
const spent = spawnSync("claude", argv, { input: prompt, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
const wallMs = Date.now() - started;
writeFileSync(join(OUT, "builder.stream.jsonl"), spent.stdout || "");
writeFileSync(join(OUT, "builder.prompt.txt"), prompt);

const after = hashes(committedTests());
const verdicts = checks(body).map(({ at, command }) => {
  const { passed, why } = runCheck(command, process.cwd());
  return { at, command, passed, why };
});

const record = {
  cell: CELL,
  ticket: TICKET,
  briefBytes: Buffer.byteLength(briefText),
  promptBytes: Buffer.byteLength(prompt),
  builder: { ...metrics(spent.stdout || ""), wallMs, status: spent.status },
  testsTouched: Object.keys(before).filter((p) => before[p] !== after[p]),
  changed: git(["status", "--porcelain", "-uall"]).stdout.split("\n").filter((l) => l.length > 3).map((l) => l.slice(3)),
  green: verdicts.every(({ passed }) => passed),
  verdicts,
};

writeFileSync(join(OUT, "builder-record.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
