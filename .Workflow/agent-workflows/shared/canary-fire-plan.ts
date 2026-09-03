import { readdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { reason } from "./reason.ts";
import { readWorkflow, WORKFLOWS_DIR } from "./read-workflow.ts";

/**
 * How `bin/canary prove --lane <name>` wakes a lane, derived from that lane's own caller YAML.
 *
 * `bin/canary` used to fire every lane the same one way — a push, landing a `.canary-fire` file
 * (see its own header before this file existed). Only 4 of 22 caller workflows trigger on push;
 * the rest wake on `repository_dispatch`, `workflow_dispatch`, an issue label, or a closed
 * issue/pull request, so `--lane fixer` and 17 others could not be fired at all. This is the
 * derivation: read `<lane>-caller.yml`'s own `on:` block (via `readWorkflow`, the one YAML reader
 * this repo already has) and choose the fire `bin/canary` should perform — never a hand-written
 * lane→fire table, so a new lane's caller stub becomes canary-able the moment it lands, the same
 * "the set is a glob, never a list" property every other lane-keyed check in this repo holds to.
 *
 * Priority when a lane's `on:` carries more than one door: `workflow_dispatch` first, because
 * where it exists it was built for exactly this ("no way to find out whether this lane runs at
 * all short of waiting for the next real failure" — `fixer-caller.yml`, `recover-caller.yml`) —
 * then `repository_dispatch`, then the issue/PR doors. `push` stays first of all: it is the
 * mechanism the four push lanes already prove, unchanged, so their behavior does not shift under
 * this file landing.
 *
 * A lane whose only door is `workflow_run` (Bypass counter, Review — both wake off "Verify"
 * completing) refuses rather than firing that upstream workflow itself: doing so would mean the
 * canary target carrying two stubs and two runs, answering "do the pipes connect" rather than
 * "does this lane's own code work", which is `bin/canary-graph`'s job, not this one's (ADR-0149).
 */

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

/** Every `<lane>-caller.yml` in the repo, keyed by lane id (the filename minus `-caller.yml`). */
function listCallerLanes(): string[] {
  return readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith("-caller.yml"))
    .map((name) => name.slice(0, -"-caller.yml".length));
}

/** The lane id(s) whose caller stub carries the given workflow *display* name (`name:` field). */
function laneIdsNamed(displayName: string): string[] {
  return listCallerLanes().filter((id) => {
    const { workflow } = readWorkflow<CallerYaml>(`${id}-caller.yml`);
    return workflow.name === displayName;
  });
}

/** Decide how to fire `lane` (a caller-yml id, e.g. `"fixer"`), reading only that lane's own YAML. */
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
