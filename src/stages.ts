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
  await Promise.all(
    readdirSync(src)
      .filter((name) => PART_FILE.test(name))
      .sort()
      .map((name) => import(join(src, name))),
  );
  return [...declared].sort((one, other) => one.part.name.localeCompare(other.part.name));
}
