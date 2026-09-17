import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { createFakeGh } from "../shared/gh.fake";
import { withHandoffDir } from "../shared/handoff-dir.fixture";
import { slice } from "../shared/plan.fixture";
import { checkpointPath } from "../shared/stage";
import { createFakeStage } from "../shared/stage.fake";
import { rawGhFromTracker } from "../shared/tracker-gh";
import { trackerMemory } from "../shared/tracker-memory";
import { runNamedStage, STAGES, vocabulary, type StageName } from "./to-tickets";

const VALID_ANSWER: Record<StageName, string> = {
  "seam-sweep": JSON.stringify({ entries: ["a seam"] }),
  slice: JSON.stringify({ slices: [slice({ title: "One slice" })] }),
  "audit-and-publish": JSON.stringify({ notes: "", slices: [slice({ title: "One slice" })] }),
};

function writeCheckpointFor(priorStage: StageName): void {
  const path = checkpointPath(priorStage);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ key: "test", response: VALID_ANSWER[priorStage] }), "utf8");
}

async function promptHandedTo(stage: StageName): Promise<string> {
  withHandoffDir();
  writeCheckpointFor("seam-sweep");
  writeCheckpointFor("slice");
  const fake = createFakeStage(VALID_ANSWER[stage]);
  const gh = createFakeGh();
  const apiGh = rawGhFromTracker(trackerMemory({ issueIds: { 100: 100007 } }));
  const ghDrivenByTracker: GhExec = (args) => (args[0] === "api" ? apiGh(args) : gh.gh(args));

  await runNamedStage(stage, "13", fake.exec, ghDrivenByTracker);

  return fake.calls[0][1];
}

describe("no to-tickets stage reads CONTEXT.md", () => {
  it.each(Object.keys(STAGES) as StageName[])("%s takes the vocabulary by injection", async (stage) => {
    const prompt = await promptHandedTo(stage);

    expect(prompt).toContain(vocabulary());
    expect(prompt).not.toContain("{{");
    if (stage !== "slice") {
      expect(prompt).not.toContain("CONTEXT.md");
    }
  });

  it("withholds the vocabulary file's own header, which names CONTEXT.md", () => {
    expect(vocabulary()).not.toContain("CONTEXT.md");
    expect(vocabulary()).toContain("**Slice**:");
  });
});
