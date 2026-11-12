import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export interface Job {
  name?: string;
  if?: unknown;
  uses?: string;
  "runs-on"?: unknown;
  steps?: { run?: unknown }[];
  services?: Record<string, { ports?: unknown[] } | null>;
}

export interface Flow {
  name?: string;
  on?: unknown;
  jobs?: Record<string, Job | null>;
}

export const WORKFLOWS = ".github/workflows";
export const WORKFLOW_FILE = /\.ya?ml$/;
const OFF_PC = 3;

export function flowOf(text: string): Flow | undefined {
  try {
    return parse(text) as Flow;
  } catch {
    return undefined;
  }
}

const BUILD_RUNS_ON = flowOf(readFileSync(join(import.meta.dirname, "..", WORKFLOWS, "tickets.yml"), "utf8"))?.jobs?.build?.["runs-on"];
export const PC_RUNS_ON = typeof BUILD_RUNS_ON === "string" ? BUILD_RUNS_ON : "";

export const runnerJobs = (text: string) => Object.entries(flowOf(text)?.jobs ?? {}).flatMap(([id, job]) => (job === null || job.uses !== undefined ? [] : [{ id, job }]));

export function offPc(file: string, id: string, job: Job): string[] {
  const runsOn = typeof job["runs-on"] === "string" ? job["runs-on"] : (JSON.stringify(job["runs-on"]) ?? "nothing");
  return runsOn === PC_RUNS_ON ? [] : [`${file}'s ${id} job runs on ${runsOn}, not ${PC_RUNS_ON}, so it stays on GitHub's runners`];
}

function offPcIn(tree: string): string[] {
  const folder = join(tree, WORKFLOWS);
  if (!existsSync(folder)) return [];
  const files = readdirSync(folder, { withFileTypes: true }).filter((entry) => entry.isFile() && WORKFLOW_FILE.test(entry.name));
  return files
    .sort((one, other) => one.name.localeCompare(other.name))
    .flatMap(({ name }) => runnerJobs(readFileSync(join(folder, name), "utf8")).flatMap(({ id, job }) => offPc(name, id, job)));
}

if (import.meta.main) {
  const [tree] = process.argv.slice(2);
  if (tree === undefined) throw new Error("no tree in the arguments");
  const offPcJobs = offPcIn(tree);
  if (offPcJobs.length > 0) {
    console.log(offPcJobs.join("; "));
    process.exit(OFF_PC);
  }
}
