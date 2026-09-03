import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reason } from "./reason.ts";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow.ts";

export type FirePlan =
  | { kind: "push" }
  | { kind: "workflow_dispatch"; event: "workflow_dispatch" }
  | { kind: "repository_dispatch"; event: "repository_dispatch"; eventType: string }
  | { kind: "issues_labeled"; event: "issues" }
  | { kind: "issues_closed"; event: "issues" }
  | { kind: "pull_request_closed"; event: "pull_request" }
  | { kind: "refuse"; reason: string };

interface OnBlock {
  push?: unknown;
  workflow_dispatch?: unknown;
  repository_dispatch?: { types?: string[] };
  issues?: { types?: string[] };
  pull_request?: { types?: string[] };
  workflow_run?: { workflows?: string[]; types?: string[] };
}

interface CallerYaml {
  name?: string;
  on?: OnBlock;
}

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
  if (issueTypes.includes("labeled")) return { kind: "issues_labeled", event: "issues" };
  if (issueTypes.includes("closed")) return { kind: "issues_closed", event: "issues" };
  if ((on.pull_request?.types ?? []).includes("closed")) {
    return { kind: "pull_request_closed", event: "pull_request" };
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
        `lane '${lane}' wakes only on workflow_run from [${named}] completing — there is no push, ` +
        `dispatch, label, or pull-request door bin/canary can ring directly, and firing an upstream ` +
        `lane's own run just to hope this one follows is not a fire, it's a guess. Refusing: ${advice}.`,
    };
  }
  return {
    kind: "refuse",
    reason: `lane '${lane}' has a trigger shape bin/canary does not know how to fire yet (on: ${JSON.stringify(on)}).`,
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lane = process.argv[2];
  if (!lane) {
    console.error("usage: canary-fire-plan.ts <lane>");
    process.exit(2);
  }
  try {
    console.log(JSON.stringify(planFire(lane)));
  } catch (err) {
    console.error(reason(err));
    process.exit(2);
  }
}
