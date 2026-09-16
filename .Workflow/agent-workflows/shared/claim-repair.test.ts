import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { slice } from "./plan.fixture";
import type { Plan } from "./plan-schema";
import { validatePathsAreRooted } from "./render-body";
import { scratchDir } from "./scratch.fixture";

interface ClaimRepair {
  slice: number;
  from: string;
  to: string;
}

type RepairUnrootedClaims = (plan: Plan, repoRoot?: string) => { plan: Plan; repairs: ClaimRepair[] };

async function repairer(): Promise<RepairUnrootedClaims> {
  const loaded = (await import("./render-body")) as Record<string, unknown>;
  const candidate = loaded.repairUnrootedClaims;
  if (typeof candidate !== "function") {
    throw new Error("shared/render-body.ts exports no repairUnrootedClaims");
  }
  return candidate as RepairUnrootedClaims;
}

function treeWith(paths: string[]): string {
  const root = scratchDir("claim-repair");
  for (const path of paths) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, "", "utf8");
  }
  return root;
}

test.fails("#584.1: a claim exactly one top-level entry resolves is rooted instead of refused, and the repair is returned", async () => {
  const repair = await repairer();
  const root = treeWith([".Workflow/agent-workflows/shared/render-body.ts"]);
  const planned = [slice({ title: "Root it for me", filesClaimed: ["agent-workflows/shared/render-body.ts"] })];

  const { plan, repairs } = repair(planned, root);

  expect(plan[0].filesClaimed).toEqual([".Workflow/agent-workflows/shared/render-body.ts"]);
  expect(repairs).toEqual([
    {
      slice: 1,
      from: "agent-workflows/shared/render-body.ts",
      to: ".Workflow/agent-workflows/shared/render-body.ts",
    },
  ]);
});

test.fails("#584.2: a claim two top-level entries both resolve is refused, and the refusal names both candidates", async () => {
  const repair = await repairer();
  const root = treeWith(["alpha/shared/x.ts", "beta/shared/x.ts"]);
  const planned = [slice({ title: "Ambiguous claim", filesClaimed: ["shared/x.ts"] })];

  expect(() => repair(planned, root)).toThrow(/alpha\/shared\/x\.ts[\s\S]*beta\/shared\/x\.ts/);
});

test.fails("#584.3: a claim no top-level entry resolves is refused naming the entries it tried, still saying no top-level entry", async () => {
  const repair = await repairer();
  const root = treeWith(["alpha/a.ts", "beta/b.ts"]);
  const planned = [slice({ title: "Resolves nowhere", filesClaimed: ["gamma/c.ts"] })];

  expect(() => repair(planned, root)).toThrow(/no top-level entry[\s\S]*alpha[\s\S]*beta/);
});

test.fails("#584.4: only filesClaimed is repaired: an unrooted token in whatToBuild survives verbatim and is still refused", async () => {
  const repair = await repairer();
  const root = treeWith([".Workflow/agent-workflows/shared/gh.ts"]);
  const planned = [
    slice({
      title: "Prose is the author's",
      whatToBuild: "Extend shared/gh.ts with a tracker port.",
      filesClaimed: ["agent-workflows/shared/gh.ts"],
    }),
  ];

  const { plan } = repair(planned, root);

  expect(plan[0].whatToBuild).toBe("Extend shared/gh.ts with a tracker port.");
  expect(() => validatePathsAreRooted(plan)).toThrow(/shared\/gh\.ts/);
});
