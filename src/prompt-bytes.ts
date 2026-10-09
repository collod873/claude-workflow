import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stages } from "./stages.ts";

const HIRES = /(spawn|execFile)\w*\(\s*"claude"/;
const STAGED = /from "\.\/stage\.ts"/;
const STAGE_MODULE = "src/stage.ts";

export interface Prompt {
  name: string;
  file: string;
  cap: number;
  slots: string[];
  build: (filled: Record<string, string>) => string;
}

const PROMPTS: Prompt[] = (await stages()).flatMap((stage) => stage.prompts ?? []);

function ownWords(prompt: Prompt): number {
  return Buffer.byteLength(prompt.build({}));
}

export function sized(prompts: Prompt[]): string {
  const sizes = prompts.map((prompt) => ({ name: prompt.name, bytes: ownWords(prompt) }));
  const total = sizes.reduce((sum, { bytes }) => sum + bytes, 0);
  const largest = sizes.reduce((most, size) => (size.bytes > most.bytes ? size : most));
  return `prompt-bytes: ${prompts.length} prompts, ${total} bytes of their own words, the largest the ${largest.name} at ${largest.bytes}`;
}

export function uncapped(prompts: Prompt[]): string[] {
  return prompts.flatMap((prompt) =>
    prompt.slots.flatMap((slot) => {
      const bytes = Buffer.byteLength(prompt.build({ [slot]: "x".repeat(prompt.cap * 2) }));
      return bytes > prompt.cap ? [`the ${prompt.name} prompt pastes ${slot} in with no cap: ${bytes} bytes, over ${prompt.cap}`] : [];
    }),
  );
}

const modules = (repo: string) =>
  readdirSync(join(repo, "src"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => `src/${name}`)
    .sort();

export function unmeasured(repo: string, prompts: Prompt[]): string[] {
  const measured = new Set(prompts.map((prompt) => prompt.file));
  return modules(repo)
    .filter((file) => !measured.has(file) && (STAGED.test(readFileSync(join(repo, file), "utf8")) || hiresItself(repo, file)))
    .map((file) => `${file} hires a model and no prompt of that name is measured`);
}

const hiresItself = (repo: string, file: string) => file !== STAGE_MODULE && HIRES.test(readFileSync(join(repo, file), "utf8"));

export function unlaunched(repo: string): string[] {
  return modules(repo)
    .filter((file) => hiresItself(repo, file))
    .map((file) => `${file} starts claude itself; hire through ${STAGE_MODULE} so it gets the owner's hooks, a transcript and a time cap`);
}

if (import.meta.main) {
  const repo = join(import.meta.dirname, "..");
  const refusals = [...uncapped(PROMPTS), ...unmeasured(repo, PROMPTS), ...unlaunched(repo)];
  for (const refusal of refusals) console.error(refusal);
  if (refusals.length === 0) console.log(sized(PROMPTS));
  process.exit(refusals.length > 0 ? 1 : 0);
}
