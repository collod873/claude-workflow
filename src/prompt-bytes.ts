import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { handedOn as coldReaderHandedOn, SPEC_CAP } from "./cold-reader.ts";
import { handedOn as fixerHandedOn, repaired, TAIL_CAP } from "./fixer.ts";
import { handedOn as meterReviewerHandedOn } from "./meter-reviewer.ts";
import { handedOn as researcherHandedOn, NOTE_CAP, OUT_OF_TIME } from "./researcher.ts";
import { DIFF_CAP, handedOn as reviewerHandedOn, LIST_CAP, TICKET_CAP } from "./reviewer.ts";

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

export const PROMPTS: Prompt[] = [
  {
    name: "reviewer",
    file: "src/reviewer.ts",
    cap: 2 * TICKET_CAP + DIFF_CAP + LIST_CAP + HANDED_ON,
    slots: ["body", "diff"],
    build: (filled) => reviewerHandedOn(filled.body ?? "", filled.diff ?? ""),
  },
  {
    name: "reviewer after the fixer's repair",
    file: "src/reviewer.ts",
    cap: 2 * TICKET_CAP + 2 * DIFF_CAP + 2 * LIST_CAP + HANDED_ON,
    slots: ["body", "diff", "earlier", "fix"],
    build: (filled) => reviewerHandedOn(filled.body ?? "", filled.diff ?? "", { earlier: filled.earlier ?? "", fix: filled.fix ?? "" }),
  },
  {
    name: "meter reviewer",
    file: "src/meter-reviewer.ts",
    cap: 2 * TICKET_CAP + DIFF_CAP + LIST_CAP + 3 * HANDED_ON,
    slots: ["body", "diff"],
    build: (filled) => meterReviewerHandedOn(filled.body ?? "", filled.diff ?? ""),
  },
  {
    name: "fixer building",
    file: "src/fixer.ts",
    cap: TICKET_CAP + 2 * HANDED_ON,
    slots: ["body"],
    build: (filled) => fixerHandedOn({ ticket: "", body: filled.body ?? "" }),
  },
  {
    name: "fixer",
    file: "src/fixer.ts",
    cap: TICKET_CAP + TAIL_CAP + DIFF_CAP + 2 * LIST_CAP + HANDED_ON,
    slots: ["body", "failed", "diff", "gaps"],
    build: (filled) => fixerHandedOn({ ticket: "", body: filled.body ?? "", red: { failed: filled.failed ?? "", diff: filled.diff ?? "", gaps: filled.gaps ?? "" } }),
  },
  {
    name: "repair",
    file: "src/fixer.ts",
    cap: TAIL_CAP + HANDED_ON,
    slots: ["output"],
    build: (filled) => repaired(filled.output ?? ""),
  },
  {
    name: "researcher",
    file: "src/researcher.ts",
    cap: NOTE_CAP + HANDED_ON,
    slots: ["title", "body", "sources"],
    build: (filled) => researcherHandedOn(filled.title ?? "", filled.body ?? "", filled.sources ?? ""),
  },
  { name: "researcher out of time", file: "src/researcher.ts", cap: HANDED_ON, slots: [], build: () => OUT_OF_TIME },
  {
    name: "cold reader",
    file: "src/cold-reader.ts",
    cap: SPEC_CAP + HANDED_ON,
    slots: ["title", "body"],
    build: (filled) => coldReaderHandedOn(filled.title ?? "", filled.body ?? ""),
  },
];

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
