import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { runLaneCli } from "./lane-cli.ts";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow.ts";

export interface FireDemands {
  label?: string;
  issueLabels?: string[];
  stateReason?: string;
  pullRequestTitle?: string;
}

export type FirePlan =
  | { kind: "push" }
  | { kind: "workflow_dispatch"; event: "workflow_dispatch" }
  | { kind: "repository_dispatch"; event: "repository_dispatch"; eventType: string }
  | { kind: "issues_labeled"; event: "issues"; demands?: FireDemands }
  | { kind: "issues_closed"; event: "issues"; demands?: FireDemands }
  | { kind: "pull_request_closed"; event: "pull_request"; demands?: FireDemands }
  | { kind: "refuse"; reason: string };

interface OnBlock {
  push?: unknown;
  workflow_dispatch?: unknown;
  repository_dispatch?: { types?: string[] };
  issues?: { types?: string[] };
  pull_request?: { types?: string[] };
  workflow_run?: { workflows?: string[]; types?: string[] };
}

interface Job {
  if?: unknown;
  uses?: unknown;
}

interface CallerYaml {
  name?: string;
  on?: OnBlock;
  jobs?: Record<string, Job>;
}

const LABEL_ADDED = /github\.event\.label\.name\s*==\s*'([^']*)'/;
const ISSUE_CARRIES = /(!?)\s*contains\(\s*github\.event\.issue\.labels\.\*\.name\s*,\s*'([^']*)'\s*\)/g;
const CLOSED_AS = /github\.event\.issue\.state_reason\s*==\s*'([^']*)'/;
const PR_TITLED = /github\.event\.pull_request\.title\s*==\s*'([^']*)'/;

function listCallerLanes(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith("-caller.yml"))
    .map((name) => name.slice(0, -"-caller.yml".length));
}

function laneIdsNamed(displayName: string): string[] {
  return listCallerLanes().filter((id) => {
    const { workflow } = readWorkflow<CallerYaml>(`${id}-caller.yml`);
    return workflow.name === displayName;
  });
}

function jobGuards(workflow: CallerYaml): string[] {
  return Object.values(workflow.jobs ?? {})
    .map((job) => job.if)
    .filter((guard): guard is string => typeof guard === "string");
}

function calledWorkflowFile(uses: unknown): string | undefined {
  if (typeof uses !== "string") return undefined;
  const file = /\/\.github\/workflows\/([^/@]+)(?:@|$)/.exec(uses)?.[1];
  if (file === undefined) return undefined;
  return existsSync(join(WORKFLOWS_DIR, file)) ? file : undefined;
}

function guardsFor(lane: string): string {
  const { workflow } = readWorkflow<CallerYaml>(`${lane}-caller.yml`);
  const guards = jobGuards(workflow);
  for (const job of Object.values(workflow.jobs ?? {})) {
    const file = calledWorkflowFile(job.uses);
    if (file !== undefined) guards.push(...jobGuards(readWorkflow<CallerYaml>(file).workflow));
  }
  return guards.join("\n");
}

function demandsFor(lane: string, keys: (keyof FireDemands)[]): FireDemands | undefined {
  const guards = guardsFor(lane);
  const demands: FireDemands = {};
  if (keys.includes("label")) {
    const label = LABEL_ADDED.exec(guards)?.[1];
    if (label !== undefined) demands.label = label;
  }
  if (keys.includes("issueLabels")) {
    const carried = [...guards.matchAll(ISSUE_CARRIES)]
      .filter(([, negated]) => negated !== "!")
      .map(([, , name]) => name);
    const preapplied = carried.filter((name) => name !== demands.label);
    if (preapplied.length > 0) demands.issueLabels = preapplied;
  }
  if (keys.includes("stateReason")) {
    const reason = CLOSED_AS.exec(guards)?.[1];
    if (reason !== undefined) demands.stateReason = reason;
  }
  if (keys.includes("pullRequestTitle")) {
    const title = PR_TITLED.exec(guards)?.[1];
    if (title !== undefined) demands.pullRequestTitle = title;
  }
  return Object.keys(demands).length > 0 ? demands : undefined;
}

export function planFire(lane: string): FirePlan {
  const { workflow } = readWorkflow<CallerYaml>(`${lane}-caller.yml`);
  const on = workflow.on ?? {};

  if (on.push !== undefined) return { kind: "push" };
  if (on.workflow_dispatch !== undefined) return { kind: "workflow_dispatch", event: "workflow_dispatch" };
  const dispatchTypes = on.repository_dispatch?.types ?? [];
  if (dispatchTypes.length > 0) {
    return { kind: "repository_dispatch", event: "repository_dispatch", eventType: dispatchTypes[0] };
  }
  const issueTypes = on.issues?.types ?? [];
  if (issueTypes.includes("labeled")) {
    return { kind: "issues_labeled", event: "issues", demands: demandsFor(lane, ["label", "issueLabels"]) };
  }
  if (issueTypes.includes("closed")) {
    return { kind: "issues_closed", event: "issues", demands: demandsFor(lane, ["issueLabels", "stateReason"]) };
  }
  if ((on.pull_request?.types ?? []).includes("closed")) {
    return {
      kind: "pull_request_closed",
      event: "pull_request",
      demands: demandsFor(lane, ["pullRequestTitle"]),
    };
  }
  if (on.workflow_run !== undefined) {
    const upstreamNames = on.workflow_run.workflows ?? [];
    const upstreamLanes = upstreamNames.flatMap((name) => laneIdsNamed(name));
    const named = upstreamNames.join(", ") || "(unnamed)";
    const advice =
      upstreamLanes.length > 0
        ? `prove the upstream lane instead: ${upstreamLanes.map((id) => `--lane ${id}`).join(" or ")}`
        : `no caller stub in this repo carries that name, so there is no upstream lane to prove either`;
    return {
      kind: "refuse",
      reason:
        `lane '${lane}' wakes only on workflow_run from [${named}] completing, so there is no push, ` +
        `dispatch, label, or pull-request door bin/canary can ring directly, and firing an upstream ` +
        `lane's own run just to hope this one follows is not a fire, it's a guess. Refusing: ${advice}.`,
    };
  }
  return {
    kind: "refuse",
    reason: `lane '${lane}' has a trigger shape bin/canary does not know how to fire yet (on: ${JSON.stringify(on)}).`,
  };
}

runLaneCli(import.meta.url, "usage: canary-fire-plan.ts <lane>", planFire);
