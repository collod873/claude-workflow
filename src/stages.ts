import { readdirSync } from "node:fs";
import { join } from "node:path";
import type { Part } from "./parts.ts";
import type { Prompt } from "./prompt-bytes.ts";
import type { Run } from "./scenarios.ts";

export const HANDED_ON = 1024;
const PART_FILE = /\.part\.ts$/;

export interface Scenario {
  label: string;
  run: () => Run;
}

export interface Stage {
  part: Part;
  prompts?: Prompt[];
  scenarios: Scenario[];
}

const declared: Stage[] = [];

export function declareStage(stage: Stage): void {
  declared.push(stage);
}

export async function stages(): Promise<Stage[]> {
  const src = import.meta.dirname;
  await readdirSync(src)
    .filter((name) => PART_FILE.test(name))
    .sort()
    .reduce<Promise<unknown>>((loaded, name) => loaded.then(() => import(join(src, name))), Promise.resolve());
  return [...declared].sort((one, other) => one.part.name.localeCompare(other.part.name));
}
