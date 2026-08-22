import { describe, expect, it } from "vitest";
import { createFakeGh } from "../shared/gh.fake";
import type { Slice } from "../shared/plan-schema";
import { sliceAndPublish } from "./slice-and-publish";

function slice(overrides: Partial<Slice> & { title: string }): Slice {
  return {
    whatToBuild: `Build ${overrides.title}.`,
    acceptanceCriteria: [`${overrides.title} works.`],
    filesClaimed: [],
    seamsConsumed: [],
    whyNotMerged: `${overrides.title} is its own vertical slice.`,
    dependsOn: [],
    ...overrides,
  };
}

function rawOutput(plan: Slice[]): string {
  return `Some reasoning prose the model wrote.\n\n<output>${JSON.stringify(plan)}</output>`;
}

const PRD_NUMBER = 42;

describe("sliceAndPublish", () => {
  it("creates an issue for every slice and attaches each under the PRD", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const fake = createFakeGh();

    const published = sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh);

    expect(published.map((p) => p.title)).toEqual(["Root", "Depends on root"]);

    const createCalls = fake.calls.filter((args) => args[0] === "issue" && args[1] === "create");
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0]).toEqual(
      expect.arrayContaining(["--title", "Root"]),
    );
    expect(createCalls[1]).toEqual(
      expect.arrayContaining(["--title", "Depends on root"]),
    );

    const attached = fake.subIssuesByParent.get(PRD_NUMBER) ?? [];
    expect(attached).toHaveLength(2);
    expect(attached).toEqual(published.map((p) => p.id));
  });

  it("refuses a missing <output> block with zero argv recorded", () => {
    const fake = createFakeGh();

    expect(() => sliceAndPublish("just prose, no block", PRD_NUMBER, fake.gh)).toThrow(
      /no <output> block/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a malformed (non-JSON) <output> block with zero argv recorded", () => {
    const fake = createFakeGh();
    const raw = "<output>{not json</output>";

    expect(() => sliceAndPublish(raw, PRD_NUMBER, fake.gh)).toThrow(/not valid JSON/);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an <output> block that fails schema validation with zero argv recorded", () => {
    const fake = createFakeGh();
    const raw = `<output>${JSON.stringify([{ title: "Missing everything else" }])}</output>`;

    expect(() => sliceAndPublish(raw, PRD_NUMBER, fake.gh)).toThrow(/failed schema validation/);
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses an out-of-range dependsOn, naming the offending slice, with zero argv recorded", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Points past the end", dependsOn: [7] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Points past the end"\).*out-of-range/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a self-reference, naming the offending slice, with zero argv recorded", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on itself", dependsOn: [2] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Depends on itself"\).*depends on itself/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a cycle, naming the offending slices, with zero argv recorded", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Cycle A", dependsOn: [3] }),
      slice({ title: "Cycle B", dependsOn: [2] }),
    ];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh)).toThrow(
      /dependency cycle detected/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a graph with no unblocked root, with zero argv recorded", () => {
    const plan = [slice({ title: "First", dependsOn: [2] }), slice({ title: "Second", dependsOn: [1] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh)).toThrow(/no unblocked root/);
    expect(fake.calls).toHaveLength(0);
  });

  it("renders a body with all four headings in order, criteria as checkboxes, and no Closes directive", () => {
    const plan = [
      slice({
        title: "Root",
        acceptanceCriteria: ["First thing is true.", "Second thing is true."],
        filesClaimed: ["a/b.ts", "a/c.ts"],
      }),
    ];
    const fake = createFakeGh();

    sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh);

    const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
    const bodyFlagIndex = createCall!.indexOf("--body");
    const body = createCall![bodyFlagIndex + 1];

    const headingOrder = ["## Parent PRD", "## What to build", "## Acceptance criteria", "## Files claimed"];
    const positions = headingOrder.map((heading) => body.indexOf(heading));
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(body).toContain(`#${PRD_NUMBER}`);
    expect(body).toContain("- [ ] First thing is true.");
    expect(body).toContain("- [ ] Second thing is true.");
    expect(body).toContain("- a/b.ts");
    expect(body).toContain("- a/c.ts");
    expect(body).not.toMatch(/closes/i);
  });

  it("renders an empty filesClaimed as the None sentinel", () => {
    const plan = [slice({ title: "No files touched", filesClaimed: [] })];
    const fake = createFakeGh();

    sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh);

    const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
    const body = createCall![createCall!.indexOf("--body") + 1];

    expect(body).toContain("- None — no files.");
  });

  it("renders seamsConsumed lines in the body without ever treating them as a Files claimed bullet", () => {
    const seamLine = "`GhExec` — the injected gh argv executor — shared/gh.ts — consumed by everything.";
    const plan = [
      slice({
        title: "Consumes a seam",
        filesClaimed: ["only/this/file.ts"],
        seamsConsumed: [seamLine],
      }),
    ];
    const fake = createFakeGh();

    sliceAndPublish(rawOutput(plan), PRD_NUMBER, fake.gh);

    const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
    const body = createCall![createCall!.indexOf("--body") + 1];

    expect(body).toContain(seamLine);

    const filesSection = body.slice(
      body.indexOf("## Files claimed"),
      body.indexOf("## Seams consumed") === -1 ? undefined : body.indexOf("## Seams consumed"),
    );
    expect(filesSection).toContain("- only/this/file.ts");
    expect(filesSection).not.toContain(seamLine);
  });
});
