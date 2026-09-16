import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { Plan, type Slice } from "../shared/plan-schema";
import type { PublishedIssue } from "../shared/publish-sub-issues";
import { errorMessage } from "../shared/reason";
import { repairUnrootedClaims, validateCriteriaShape } from "../shared/render-body";
import { trackerGh } from "../shared/tracker-gh";
import type { Tracker } from "../shared/tracker";
import { sliceAndPublish, validateSlicePlan } from "./slice-and-publish";

const Graph = z.object({
  parent: z.number().int().positive(),
  plan: Plan,
});

function ancestorsOf(plan: readonly Slice[], position: number): Set<number> {
  const seen = new Set<number>();
  const stack = [...plan[position - 1].dependsOn];
  while (stack.length > 0) {
    const dep = stack.pop();
    if (dep === undefined || seen.has(dep)) continue;
    seen.add(dep);
    stack.push(...plan[dep - 1].dependsOn);
  }
  return seen;
}

function reportOverlappingUnedgedClaims(plan: readonly Slice[]): void {
  const ancestors = plan.map((_slice, index) => ancestorsOf(plan, index + 1));

  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) {
      if (ancestors[i].has(j + 1) || ancestors[j].has(i + 1)) continue;
      const claimedByI = new Set(plan[i].filesClaimed);
      for (const path of plan[j].filesClaimed) {
        if (!claimedByI.has(path)) continue;
        console.error(
          `slice ${i + 1} ("${plan[i].title}") and slice ${j + 1} ("${plan[j].title}") share no blocking ` +
            `edge but both claim ${JSON.stringify(path)}; a live run holds it, not the ticket (ADR-0199).`,
        );
      }
    }
  }
}

function renderTable(published: readonly PublishedIssue[]): string {
  const rows = published.map((issue) => `| ${issue.position} | ${issue.number} | ${issue.title} |`);
  return ["| Position | Number | Title |", "|---|---|---|", ...rows].join("\n");
}

export function runPublishIssueGraphCli(argv: readonly string[], gh: GhExec | Tracker): string {
  const [path] = argv;
  if (!path) {
    throw new Error("usage: publish-issue-graph <graph.json>");
  }
  const { parent, plan } = Graph.parse(JSON.parse(readFileSync(path, "utf8")));
  const { plan: rooted } = repairUnrootedClaims(plan);
  validateCriteriaShape(rooted);
  validateSlicePlan(rooted);

  reportOverlappingUnedgedClaims(rooted);

  const published = sliceAndPublish(rooted, parent, gh);
  const table = renderTable(published);
  console.log(table);
  return table;
}

function main(): void {
  try {
    runPublishIssueGraphCli(process.argv.slice(2), trackerGh(execGh));
  } catch (error) {
    console.error(`publish-issue-graph: ${errorMessage(error)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
