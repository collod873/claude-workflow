import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { brief, CAP } from "./brief.ts";
import { handedOn as builderHandedOn, repaired, TAIL_CAP } from "./builder.ts";
import { handedOn as fixerHandedOn } from "./fixer.ts";
import { handedOn as meterReviewerHandedOn } from "./meter-reviewer.ts";
import { handedOn as researcherHandedOn, NOTE_CAP, OUT_OF_TIME } from "./researcher.ts";
import { DIFF_CAP, handedOn as reviewerHandedOn, LIST_CAP, TICKET_CAP } from "./reviewer.ts";
import { handedOn, refused, REFUSALS_CAP } from "./test-author.ts";

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
    name: "test author refused",
    file: "src/test-author.ts",
    cap: REFUSALS_CAP + HANDED_ON,
    slots: ["refusals"],
    build: (filled) => refused(filled.refusals === undefined ? [] : [filled.refusals]),
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
    name: "fixer",
    file: "src/fixer.ts",
    cap: TICKET_CAP + TAIL_CAP + DIFF_CAP + 2 * LIST_CAP + HANDED_ON,
    slots: ["body", "failed", "diff", "gaps"],
    build: (filled) => fixerHandedOn({ ticket: "", body: filled.body ?? "", failed: filled.failed ?? "", diff: filled.diff ?? "", gaps: filled.gaps ?? "" }),
  },
  {
    name: "researcher",
    file: "src/researcher.ts",
    cap: NOTE_CAP + HANDED_ON,
    slots: ["title", "body", "sources"],
    build: (filled) => researcherHandedOn(filled.title ?? "", filled.body ?? "", filled.sources ?? ""),
  },
  { name: "researcher out of time", file: "src/researcher.ts", cap: HANDED_ON, slots: [], build: () => OUT_OF_TIME },
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
