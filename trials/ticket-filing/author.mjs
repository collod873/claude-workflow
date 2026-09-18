import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CORE = process.env.TRIAL_CORE;
const { brief, onDisk } = await import(join(CORE, "brief.ts"));
const { checks, ticketRefusals } = await import(join(CORE, "ticket-shape.ts"));
const { denyFlags, stageRefusals } = await import(join(CORE, "deny-list.ts"));
const { uncovered } = await import(join(CORE, "test-author.ts"));

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1]?.startsWith("--") || arr[i + 1] === undefined ? "1" : arr[i + 1]]);
    return acc;
  }, []),
);

const TICKET = args.ticket;
const CELL = args.cell;
const OUT = args.out;
const TRANSCRIPT = args.transcript && args.transcript !== "1" ? args.transcript : null;
const REWRITE = args.rewrite === "1";
const MODEL = "sonnet";
const WRITES = ["Read", "Edit", "Write"];

mkdirSync(OUT, { recursive: true });

function gh(argv) {
  const r = spawnSync("gh", argv, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`gh ${argv[0]} ${argv[1]} failed: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

function runClaude(prompt, commands, tag) {
  const argv = [
    "--print", "--output-format", "stream-json", "--verbose",
    "--model", MODEL, "--setting-sources", "",
    "--allowedTools", [...WRITES, ...commands.map((c) => `Bash(${c})`)].join(","),
    ...denyFlags(),
  ];
  const fenced = stageRefusals("test author", argv);
  if (fenced.length > 0) throw new Error(fenced.join("; "));
  const started = Date.now();
  const spent = spawnSync("claude", argv, { input: prompt, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const wall = Date.now() - started;
  writeFileSync(join(OUT, `${tag}.stream.jsonl`), spent.stdout || "");
  writeFileSync(join(OUT, `${tag}.prompt.txt`), prompt);
  return { wall, stdout: spent.stdout || "", status: spent.status, stderr: spent.stderr || "" };
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

const body = gh(["issue", "view", TICKET, "--json", "body", "--jq", ".body"]);
const commands = checks(body).map(({ command }) => command);
const briefed = brief({ ticket: TICKET, body, tests: [], read: onDisk });
if (briefed.refusals.length > 0) {
  writeFileSync(join(OUT, "refusals.txt"), briefed.refusals.join("\n"));
  console.error(briefed.refusals.join("\n"));
  process.exit(1);
}

const transcriptText = TRANSCRIPT ? readFileSync(TRANSCRIPT, "utf8") : null;

const parts = [briefed.text];
if (transcriptText) {
  parts.push(
    "## The session this ticket came from",
    "The dialogue that produced this ticket, tool noise stripped. The owner often answers only \"yes\" or \"I agree\", so his intent is in what he agreed to, not only in his own sentences.",
    transcriptText,
  );
}
if (commands.length > 0) {
  parts.push(
    "## What to write",
    `Write one failing test for each criterion above, and write nothing else. Your check commands are ${commands.map((c) => `\`${c}\``).join(", ")}.`,
    "Each ends red naming the behaviour its criterion asks for. A criterion with no failing test ends this stage red.",
  );
} else {
  parts.push(
    "## What to write",
    "This ticket carries no acceptance criteria and no claimed files. Decide from the session what must be true, then write one failing test per behaviour, and write nothing else.",
    "Put the tests where this repo's tests live, in a `*.test.ts` file runnable by `npx vitest run <file>`. Each ends red naming the behaviour it asks for.",
  );
}

const authored = runClaude(parts.join("\n\n") + "\n", commands, "author");
const authorMetrics = metrics(authored.stdout);

const written = spawnSync("git", ["status", "--porcelain", "-uall", "--", "*.test.ts"], { encoding: "utf8" }).stdout.trim();
const testFiles = written.split("\n").filter(Boolean).map((l) => l.slice(3));

const record = {
  cell: CELL,
  ticket: TICKET,
  transcript: TRANSCRIPT ? { path: TRANSCRIPT, bytes: transcriptText.length } : null,
  rewrite: REWRITE,
  briefBytes: briefed.text.length,
  promptBytes: parts.join("\n\n").length,
  author: { ...authorMetrics, wallMs: authored.wall, status: authored.status },
  testFiles,
  uncovered: commands.length > 0 ? uncovered(body, process.cwd()) : null,
};

if (REWRITE && testFiles.length > 0) {
  const tests = testFiles.map((f) => {
    let text = "";
    try { text = readFileSync(f, "utf8"); } catch {}
    return `### ${f}\n\n\`\`\`ts\n${text}\n\`\`\``;
  }).join("\n\n");
  const whyMatch = body.match(/## Why\n([\s\S]*?)(?=\n## |$)/);
  const rewritePrompt = [
    "You are rewriting a GitHub ticket body now that its failing tests exist.",
    "## The ticket as it stands",
    body,
    "## The failing tests you just wrote",
    tests,
    "## The rules",
    "Output the complete new ticket body and nothing else. No preamble, no code fence around the whole thing.",
    "You may not change the `## Why` section. Reproduce it byte for byte. It is the owner's own words.",
    "Sharpen, never remove. You may resolve a sentence into a clearer, more specific version of itself. You may never delete a criterion, and you may never narrow the scope of the work to make an ambiguity disappear. A pass that leaves the ticket claiming less than it did before is a failed pass.",
    "`## Files claimed` must list every file the work touches, one per line as `- path`, no globs. You just wrote the tests, so you know what they import and what they exercise.",
    "`## Acceptance criteria` carries 1 to 3 `- [ ]` items, each ending with a trailing marker of the form - check: `<command>`, and at least one command must run tests.",
    "The body must contain no em dashes.",
  ].join("\n\n");
  const rewritten = runClaude(rewritePrompt + "\n", [], "rewrite");
  const rewriteMetrics = metrics(rewritten.stdout);
  let newBody = "";
  for (const line of rewritten.stdout.split("\n")) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === "result" && typeof j.result === "string") newBody = j.result;
  }
  newBody = newBody.replace(/^```(?:markdown)?\n/, "").replace(/\n```$/, "").trim() + "\n";
  writeFileSync(join(OUT, "rewritten-body.md"), newBody);
  const shape = ticketRefusals(newBody);
  const whyKept = whyMatch ? newBody.includes(whyMatch[1].trim()) : null;
  record.rewritePass = { ...rewriteMetrics, wallMs: rewritten.wall, shapeRefusals: shape, whyPreservedByteForByte: whyKept, bodyBytes: newBody.length };
  if (shape.length === 0) {
    const tmp = join(OUT, "post-body.md");
    writeFileSync(tmp, newBody);
    gh(["issue", "edit", TICKET, "--body-file", tmp]);
    record.rewritePass.posted = true;
  } else {
    record.rewritePass.posted = false;
  }
}

writeFileSync(join(OUT, "record.json"), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record, null, 2));
