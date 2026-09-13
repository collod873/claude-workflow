import { runLaneCli } from "./lane-cli.ts";
import { type Doors, LANE_WIRING, laneFacts, lanesNamed, type PushDoor } from "./lane-wiring.ts";

export interface FireDemands {
  label?: string;
  issueLabels?: string[];
  stateReason?: string;
}

export type FirePlan =
  | { kind: "push"; firePath: string }
  | { kind: "workflow_dispatch"; event: "workflow_dispatch" }
  | { kind: "repository_dispatch"; event: "repository_dispatch"; eventType: string }
  | { kind: "issues_labeled"; event: "issues"; demands?: FireDemands }
  | { kind: "issues_closed"; event: "issues"; demands?: FireDemands }
  | { kind: "refuse"; reason: string };

export const DECLARED_FIRE_DEMANDS: Record<string, FireDemands> = {
  shape: { label: "idea" },
  "shape-accept": { label: "approved" },
  "lost-dispatch-counter": { label: "sliceable" },
  "ratify-on-prd-close": { issueLabels: ["prd"], stateReason: "completed" },
};

function firePathFor(lane: string, push: PushDoor): string {
  const fallback = `.canary-fire-${lane}`;
  const first = (push.paths ?? [])[0];
  if (first === undefined) return fallback;
  if (!/[*?[\]]/.test(first)) return first;
  const base = first.replace(/\/?\*.*$/, "");
  return base === "" ? fallback : `${base}/canary-fire-${lane}.md`;
}

function demandsFor(lane: string, keys: (keyof FireDemands)[]): FireDemands | undefined {
  const declared = DECLARED_FIRE_DEMANDS[lane] ?? {};
  const demands = Object.fromEntries(keys.flatMap((key) => (declared[key] === undefined ? [] : [[key, declared[key]]])));
  return Object.keys(demands).length > 0 ? (demands as FireDemands) : undefined;
}

function refuseWorkflowRun(lane: string, doors: Doors): FirePlan {
  const upstreamNames = doors.workflow_run?.workflows ?? [];
  const upstreamLanes = upstreamNames.flatMap((name) => lanesNamed(name));
  const named = upstreamNames.join(", ") || "(unnamed)";
  const advice =
    upstreamLanes.length > 0
      ? `prove the upstream lane instead: ${upstreamLanes.map((id) => `--lane ${id}`).join(" or ")}`
      : "no lane in the registry carries that name, so there is no upstream lane to prove either";
  return {
    kind: "refuse",
    reason:
      `lane '${lane}' wakes only on workflow_run from [${named}] completing, so there is no push, ` +
      "dispatch, or label door bin/canary can ring directly, and firing an upstream " +
      `lane's own run just to hope this one follows is not a fire, it's a guess. Refusing: ${advice}.`,
  };
}

export function planFire(lane: string): FirePlan {
  if (LANE_WIRING[lane] === undefined) {
    return { kind: "refuse", reason: `no lane '${lane}' is wired in shared/lane-wiring.ts, so there is no door to ring.` };
  }
  const doors = laneFacts(lane).doors;

  if (doors.push !== undefined) return { kind: "push", firePath: firePathFor(lane, doors.push) };
  if (doors.workflow_dispatch !== undefined) return { kind: "workflow_dispatch", event: "workflow_dispatch" };
  const dispatchTypes = doors.repository_dispatch ?? [];
  if (dispatchTypes.length > 0) {
    return { kind: "repository_dispatch", event: "repository_dispatch", eventType: dispatchTypes[0] };
  }
  const issueTypes = doors.issues ?? [];
  if (issueTypes.includes("labeled")) {
    return { kind: "issues_labeled", event: "issues", demands: demandsFor(lane, ["label", "issueLabels"]) };
  }
  if (issueTypes.includes("closed")) {
    return { kind: "issues_closed", event: "issues", demands: demandsFor(lane, ["issueLabels", "stateReason"]) };
  }
  if (doors.workflow_run !== undefined) return refuseWorkflowRun(lane, doors);

  return {
    kind: "refuse",
    reason: `lane '${lane}' has a trigger shape bin/canary does not know how to fire yet (on: ${JSON.stringify(doors)}).`,
  };
}

runLaneCli(import.meta.url, "usage: canary-fire-plan.ts <lane>", planFire);
