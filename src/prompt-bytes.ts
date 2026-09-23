import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brief, CAP } from "./brief.ts";
import { handedOn as builderHandedOn, repaired, TAIL_CAP } from "./builder.ts";
import { handedOn } from "./test-author.ts";

export const CEILINGS: Record<string, number> = { "brief": 146, "test author": 860, "builder": 388, "repair": 84 };

const AUTHORED = "src/planted.test.ts";
const HIRES = /(spawn|execFile)\w*\(\s*"claude"/;
const STAGED = /from "\.\/stage\.ts"/;
const STAGE_MODULE = "src/stage.ts";
const HANDED_ON = 1024;

export interface Prompt {
  name: string;
  file: string;
  cap: number;
  slots: string[];
  build: (filled: Record<string, string>) => string;
}

function briefText(filled: Record<string, string>): string {
  return brief({
    ticket: filled.ticket ?? "",
    body: filled.body ?? "",
    tests: filled.tests === undefined ? [] : [AUTHORED],
    read: () => filled.tests,
  }).text;
}

export const PROMPTS: Prompt[] = [
  { name: "brief", file: "src/brief.ts", cap: CAP, slots: ["ticket", "body", "tests"], build: briefText },
  {
    name: "test author",
    file: "src/test-author.ts",
    cap: CAP + HANDED_ON,
    slots: ["ticket", "body", "tests", "commands"],
    build: (filled) => handedOn(briefText(filled), filled.commands === undefined ? [] : [filled.commands]),
  },
  {
    name: "builder",
    file: "src/builder.ts",
    cap: CAP + HANDED_ON,
    slots: ["ticket", "body", "tests", "commands"],
    build: (filled) => builderHandedOn(briefText(filled), filled.commands === undefined ? [] : [filled.commands]),
  },
  {
    name: "repair",
    file: "src/builder.ts",
    cap: TAIL_CAP + HANDED_ON,
    slots: ["output"],
    build: (filled) => repaired(filled.output ?? ""),
  },
];

function ownWords(prompt: Prompt): number {
  return Buffer.byteLength(prompt.build({}));
}

export function grown(prompts: Prompt[], ceilings: Record<string, number>): string[] {
  return prompts.flatMap((prompt) => {
    const ceiling = ceilings[prompt.name];
    if (ceiling === undefined) return [`the ${prompt.name} prompt has no recorded ceiling`];
    const bytes = ownWords(prompt);
    return bytes > ceiling ? [`the ${prompt.name} prompt writes ${bytes} bytes of its own words, over its ceiling of ${ceiling}`] : [];
  });
}

export function shrunk(prompts: Prompt[], ceilings: Record<string, number>): Record<string, number> {
  const paid = { ...ceilings };
  for (const prompt of prompts) {
    const bytes = ownWords(prompt);
    if (paid[prompt.name] !== undefined && bytes < paid[prompt.name]) paid[prompt.name] = bytes;
  }
  return paid;
}

export function uncapped(prompts: Prompt[]): string[] {
  return prompts.flatMap((prompt) =>
    prompt.slots.flatMap((slot) => {
      const bytes = Buffer.byteLength(prompt.build({ [slot]: "x".repeat(prompt.cap * 2) }));
      return bytes > prompt.cap ? [`the ${prompt.name} prompt pastes ${slot} in with no cap: ${bytes} bytes, over ${prompt.cap}`] : [];
    }),
  );
}

export function unmeasured(repo: string, prompts: Prompt[]): string[] {
  const measured = new Set(prompts.map((prompt) => prompt.file));
  return readdirSync(join(repo, "src"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => `src/${name}`)
    .filter((file) => {
      const text = readFileSync(join(repo, file), "utf8");
      return !measured.has(file) && (STAGED.test(text) || (file !== STAGE_MODULE && HIRES.test(text)));
    })
    .sort()
    .map((file) => `${file} hires a model and no prompt of that name is measured`);
}

export function record(file: string, ceilings: Record<string, number>): void {
  const rendered = Object.entries(ceilings).map(([name, bytes]) => `"${name}": ${bytes}`).join(", ");
  const source = readFileSync(file, "utf8");
  writeFileSync(file, source.replace(/(CEILINGS: Record<string, number> = )\{[^}]*\}/, `$1{ ${rendered} }`));
}

if (import.meta.main) {
  const repo = join(import.meta.dirname, "..");
  const refusals = [...grown(PROMPTS, CEILINGS), ...uncapped(PROMPTS), ...unmeasured(repo, PROMPTS)];
  for (const refusal of refusals) console.error(refusal);
  if (refusals.length === 0) {
    const paid = shrunk(PROMPTS, CEILINGS);
    const cut = Object.keys(paid).filter((name) => paid[name] !== CEILINGS[name]);
    if (cut.length > 0) record(join(import.meta.dirname, "prompt-bytes.ts"), paid);
    console.log(`prompt-bytes: ${PROMPTS.length} prompts${cut.length > 0 ? `, recorded ${cut.join(", ")} smaller` : " at their ceilings"}`);
  }
  process.exit(refusals.length > 0 ? 1 : 0);
}
