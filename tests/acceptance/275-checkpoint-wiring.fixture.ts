import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { jobs, repoRoot, workflowPath } from "./workflow-shape.fixture";

/**
 * The workflow readers #275's criteria share.
 *
 * Not a `.test.ts`, so `vitest.config.ts`'s `tests/acceptance/**\/*.test.ts` include never collects
 * it as a suite — it is only ever imported by one. `.fixture.ts` is the name this directory already
 * gives a file whose job is to be unreachable from a lane.
 *
 * Three of #275's five criteria ask the same question of the same two workflow files — *which steps
 * does this lane's job run, in what order, and what does each one say* — and two more ask the same
 * question of the composite action's text. Written into each test file that would be three copies of
 * one step splitter, which is exactly the divergence lane 04 produced the last time it authored a
 * workflow-shaped ticket, and which `bin/clone-gate` reports on push.
 *
 * The job-block reader itself already exists beside this file (`workflow-shape.fixture.ts`'s
 * `jobs`), so it is imported rather than restated; what this adds is the split from a job block into
 * its individual steps.
 *
 * These are deliberately small string readers rather than a YAML library, for the reason the
 * neighbouring fixture gives: what the criteria assert is the *text* a maintainer reads — a step
 * named in one place, an `if:` spelled another — and a parsed document has already thrown the
 * spelling away. They are tolerant about *how* a thing is written (a `with:` mapping inline or in
 * block form, an `if:` quoted or bare) and strict about *whether* it is there at all.
 *
 * A missing file reads as empty text rather than as an exception, so a criterion about a file that
 * has not been created yet comes back red on its assertion instead of throwing.
 */

/** The composite action #275 creates, as its criteria's own `grep` names it. */
export const ACTION_PATH = path.join(
  repoRoot,
  ".github",
  "actions",
  "checkpoints",
  "action.yml",
);

/** One lane wired in this change: its workflow file, and the entrypoint its stage steps run. */
export interface Lane {
  /** How the ticket names the lane. */
  label: string;
  /** The workflow's basename, as `workflowPath` takes it. */
  workflow: string;
  /** The lane entrypoint a stage step spells on its command line. */
  script: string;
}

/** The two workflows #275 wires — `to-tickets.yml` and `shape.yml`, in the ticket's own order. */
export const LANES: readonly Lane[] = [
  {
    label: "to-tickets",
    workflow: "to-tickets.yml",
    script: ".Workflow/agent-workflows/to-tickets/to-tickets.ts",
  },
  {
    label: "shape",
    workflow: "shape.yml",
    script: ".Workflow/agent-workflows/shape/shape.ts",
  },
];

/** A file's text, or `""` when it does not exist. */
export function readIfPresent(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** A workflow's text, by basename. */
export function workflowText(name: string): string {
  return readIfPresent(workflowPath(name));
}

/** The composite action's text, or `""` while it does not exist yet. */
export function actionYml(): string {
  return readIfPresent(ACTION_PATH);
}

/** One step of one job, in the order the job runs it. */
export interface Step {
  /** The job key the step sits under. */
  job: string;
  /** Position among that job's steps, from 0 — what "before" and "after" are measured in. */
  index: number;
  /** The step's `name:`, or `""` when it declares none. */
  name: string;
  /** The step's own lines, with the leading `- ` folded into indentation. Comments are dropped. */
  text: string;
}

function indentOf(line: string): number {
  return (line.match(/^\s*/) as RegExpMatchArray)[0].length;
}

/** The indentation a step's own keys sit at — the shallowest line in it. */
function keyIndent(text: string): number {
  const indents = text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(indentOf);
  return indents.length === 0 ? 0 : Math.min(...indents);
}

function valueOf(text: string, key: string): string | null {
  const indent = keyIndent(text);
  const pattern = new RegExp(`^ {${indent}}${key}\\s*:\\s*(.*)$`);
  for (const line of text.split("\n")) {
    const match = line.match(pattern);
    if (match !== null) return match[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/**
 * The value of one of a step's own top-level keys (`name`, `uses`, `if`, `run`), or `null`.
 *
 * Only the step's own keys: a `name:` under `with:` is a sub-key of the step, not the step's name,
 * and reading it as one is how an artifact's name gets mistaken for a step's.
 */
export function stepValue(step: Step, key: string): string | null {
  return valueOf(step.text, key);
}

function stepsOfJob(job: string, jobText: string): Step[] {
  const lines = jobText.split("\n");
  const start = lines.findIndex((line) => /^\s*steps\s*:\s*$/.test(line));
  if (start === -1) return [];

  const outer = indentOf(lines[start]);
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (indentOf(line) <= outer) break;
    body.push(line);
  }

  // Only a `- ` at the list's own indentation opens a step: a bullet inside a `run:` block scalar or
  // under a step's `with:` is deeper, and folding it in would split one step into several.
  const chunks: string[][] = [];
  let itemIndent = -1;
  for (const line of body) {
    const bullet = line.match(/^(\s*)-\s/);
    if (bullet !== null && (itemIndent === -1 || bullet[1].length === itemIndent)) {
      itemIndent = bullet[1].length;
      chunks.push([line.replace(/^(\s*)-\s/, "$1  ")]);
      continue;
    }
    if (chunks.length > 0) chunks[chunks.length - 1].push(line);
  }

  return chunks.map((chunk, index) => {
    const text = chunk.join("\n");
    return { job, index, name: valueOf(text, "name") ?? "", text };
  });
}

/** Every step of every job in a workflow, job by job and in order. */
export function allSteps(yml: string): Step[] {
  return Object.entries(jobs(yml)).flatMap(([name, text]) => stepsOfJob(name, text));
}

/**
 * The steps of the job that actually runs the lane — the one whose text names the lane entrypoint,
 * falling back to the workflow's first job when nothing does.
 *
 * Found by what the job runs rather than by a job key, so a renamed job is not mistaken for a lane
 * that stopped running its stages.
 */
export function laneSteps(lane: Lane): Step[] {
  const yml = workflowText(lane.workflow);
  const steps = allSteps(yml);
  const owning = steps.find((step) => step.text.includes(lane.script));
  const job = owning?.job ?? Object.keys(jobs(yml))[0];
  return job === undefined ? [] : steps.filter((step) => step.job === job);
}

/** Whether a step runs the lane's entrypoint — a stage step. */
export function isStageStep(lane: Lane, step: Step): boolean {
  return step.text.includes(lane.script);
}

/** A one-line summary of steps, so a failed assertion names what was actually found. */
export function describeSteps(steps: readonly Step[]): string {
  if (steps.length === 0) return "(none)";
  return steps.map((step) => `${step.job}[${step.index}] ${step.name || "(unnamed)"}`).join(", ");
}
