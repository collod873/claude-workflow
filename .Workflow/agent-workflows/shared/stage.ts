import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { handoffPath } from "./handoff-path";
import { reason } from "./reason";
import { createStreamJsonParser } from "./stream-json";
import { rejectedResponse, type StructuredOutput } from "./structured-output";

export type StageExec = (argv: string[], stdin?: string) => Promise<string>;

const MAX_ARG_STRLEN = 32 * 4096;

const STREAM_FLAGS = ["--output-format", "stream-json", "--verbose"];

const STAGE_SESSION_VAR = "WORKFLOW_STAGE";

function stageEnv(): NodeJS.ProcessEnv {
  return { ...process.env, [STAGE_SESSION_VAR]: "1" };
}

export const execClaudeIn =
  (cwd?: string): StageExec =>
  (argv, stdin) =>
  new Promise((resolve, reject) => {
    const parser = createStreamJsonParser((line) => process.stderr.write(`${line}\n`));
    const child = spawn("claude", [...withoutOutputFormat(argv), ...STREAM_FLAGS], {
      stdio: ["pipe", "pipe", "pipe"],
      env: stageEnv(),
      cwd,
    });

    let stdinError: Error | undefined;
    child.stdin.on("error", (err: Error) => {
      stdinError = err;
    });

    child.stdin.end(stdin ?? "", "utf8");

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => parser.push(chunk));

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    child.on("error", (err) => reject(new Error(`could not spawn \`claude\`: ${err.message}`)));

    child.on("close", (code) => {
      const { text, isError, missingResult } = parser.end();
      const prompt = stdinError === undefined ? "" : ` (the prompt never reached it: ${stdinError.message})`;
      if (code !== 0) {
        reject(new Error(`\`claude\` exited ${code}${prompt}${tail(stderr)}`));
        return;
      }
      if (isError) {
        reject(new Error(`\`claude\` reported the run as failed${prompt}${tail(stderr)}`));
        return;
      }
      if (missingResult) {
        reject(new Error(`\`claude\` produced no result event${prompt}${tail(stderr)}`));
        return;
      }
      resolve(text);
    });
  });

function withoutOutputFormat(argv: string[]): string[] {
  const kept: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--output-format") {
      i += 1; 
      continue;
    }
    kept.push(argv[i]);
  }
  return kept;
}

function tail(stderr: string, limit = 2000): string {
  const trimmed = stderr.trim();
  if (trimmed === "") return "";
  const kept = trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
  return `: ${kept}`;
}

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

const DEFAULT_CHECKPOINTS_DIR = ".Workflow/agent-workflows/checkpoints";

function checkpointsDir(): string {
  return process.env.CHECKPOINTS_DIR || DEFAULT_CHECKPOINTS_DIR;
}

export function checkpointPath(stage: string): string {
  return join(checkpointsDir(), `${stage}.json`);
}

export function rawResponsePath(stage: string): string {
  return join(dirname(handoffPath()), `${stage}-raw-response.txt`);
}

function checkpointKey(prompt: string): string | undefined {
  let sha: string;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
  return createHash("sha256").update(sha).update("\0").update(prompt).digest("hex");
}

interface CheckpointEnvelope {
  key: string;
  response: string;
}

function isCheckpointEnvelope(value: unknown): value is CheckpointEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { key: unknown }).key === "string" &&
    typeof (value as { response: unknown }).response === "string"
  );
}

function loadCheckpoint<T>(stage: string, prompt: string, output: StructuredOutput<T>): T | undefined {
  const key = checkpointKey(prompt);
  if (key === undefined) return undefined;

  let raw: string;
  try {
    raw = readFileSync(checkpointPath(stage), "utf8");
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }

  if (!isCheckpointEnvelope(parsed) || parsed.key !== key) return undefined;

  try {
    return output.parse(parsed.response);
  } catch {
    return undefined;
  }
}

function writeCheckpoint(stage: string, prompt: string, response: string): void {
  const key = checkpointKey(prompt);
  if (key === undefined) return;
  try {
    const path = checkpointPath(stage);
    mkdirSync(dirname(path), { recursive: true });
    const envelope: CheckpointEnvelope = { key, response };
    writeFileSync(path, JSON.stringify(envelope), "utf8");
  } catch {
  }
}

async function preservingRaw<R>(stage: string, work: () => Promise<R>): Promise<R> {
  try {
    return await work();
  } catch (err) {
    const raw = rejectedResponse(err);
    if (raw === undefined) throw err;
    const path = rawResponsePath(stage);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, raw, "utf8");
    throw new Error(`${reason(err)}: the model's raw response is saved at ${path}`);
  }
}

export interface StageOptions {
  model?: string;
  disallowedTools?: string[];
  allowedTools?: string[];
  promptViaStdin?: boolean;
  stage: string;
}

export async function runStage<T>(
  promptPath: string,
  vars: Record<string, string>,
  exec: StageExec,
  output: StructuredOutput<T>,
  options: StageOptions,
): Promise<T> {
  if (options.allowedTools?.length && options.disallowedTools?.length) {
    throw new Error(
      "StageOptions set both allowedTools and disallowedTools; pick one: allowedTools says " +
        "'these and no others', disallowedTools says 'everything but these'",
    );
  }

  const template = readFileSync(promptPath, "utf8");
  const prompt = substitute(promptPath, template, vars);

  const stage = options.stage;
  const cached = loadCheckpoint(stage, prompt, output);
  if (cached !== undefined) return cached;

  const model = options.model ? ["--model", options.model] : [];
  const denied = options.disallowedTools?.length
    ? ["--disallowedTools", options.disallowedTools.join(",")]
    : [];
  const allowed = options.allowedTools?.length
    ? ["--allowedTools", options.allowedTools.join(",")]
    : [];
  const flags = [
    "--dangerously-skip-permissions",
    "--json-schema",
    output.jsonSchema,
    ...model,
    ...denied,
    ...allowed,
  ];

  const spawnAndParse = async (): Promise<T> => {
    let responseText: string;
    if (options.promptViaStdin) {
      responseText = await exec(["-p", ...flags], prompt);
    } else {
      if (Buffer.byteLength(prompt, "utf8") > MAX_ARG_STRLEN) {
        throw new Error(
          `${promptPath} renders to ${Buffer.byteLength(prompt, "utf8")} bytes, over the ${MAX_ARG_STRLEN}-byte ` +
            "limit on a single argv element; this stage needs `promptViaStdin`",
        );
      }
      responseText = await exec(["-p", prompt, ...flags]);
    }
    const value = output.parse(responseText);
    writeCheckpoint(stage, prompt, responseText);
    return value;
  };

  return preservingRaw(stage, spawnAndParse);
}

function substitute(promptPath: string, template: string, vars: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    if (!(name in vars)) {
      throw new Error(`${promptPath} references {{${name}}}, which no var was supplied for`);
    }
    return vars[name];
  });
}
