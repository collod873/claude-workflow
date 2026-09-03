import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { blockedByPath } from "../shared/gh-paths";
import { createFakeGh } from "../shared/gh.fake";
import { slice } from "../shared/plan.fixture";
import type { Slice } from "../shared/plan-schema";
import { readySlices, type SliceState } from "../shared/ready-set";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION } from "../shared/ready-set";
import { sliceAndPublish } from "./slice-and-publish";

const PRD_NUMBER = 42;

describe("sliceAndPublish", () => {
  it("creates an issue for every slice and attaches each under the PRD", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

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

  it("wires a native blocked-by edge for every dependsOn entry in the plan", () => {
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Depends on root", dependsOn: [1] }),
      slice({ title: "Depends on both", dependsOn: [1, 2] }),
    ];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);
    const [root, dependsOnRoot, dependsOnBoth] = published;

    const wireCalls = fake.calls.filter(
      (args) =>
        args[0] === "api" &&
        typeof args[1] === "string" &&
        args[1].endsWith("/dependencies/blocked_by") &&
        args.includes("-F"),
    );
    expect(wireCalls).toHaveLength(3);

    // Building the path through gh-paths.ts on both sides (production and
    // this assertion) would make a path comparison tautological — see the
    // gh-paths.ts header. So this one assertion pins both the endpoint path
    // and the `-F issue_id=<n>` value as hardcoded literals instead of
    // interpolating `blockedByPath(...)` / `root.id`: with the default
    // firstIssueNumber (100), Root is #100 with REST id 100007 and "Depends
    // on root" is #101.
    //
    // The flag is `-F` and that is the whole point of pinning it. This
    // assertion said `-f` and called it "the actual wire string GitHub's
    // blocked_by write accepts" — it was not. `-f` sends a string, both
    // endpoints take a JSON integer, and to-tickets run 32679981039 is
    // where the real API said so (HTTP 422) after the fake had accepted it
    // for every run before that.
    expect(wireCalls).toContainEqual([
      "api",
      "repos/{owner}/{repo}/issues/101/dependencies/blocked_by",
      "-F",
      "issue_id=100007",
    ]);
    expect(wireCalls).toContainEqual([
      "api",
      blockedByPath(dependsOnBoth.number),
      "-F",
      `issue_id=${root.id}`,
    ]);
    expect(wireCalls).toContainEqual([
      "api",
      blockedByPath(dependsOnBoth.number),
      "-F",
      `issue_id=${dependsOnRoot.id}`,
    ]);
  });

  it("wires no blocked-by edge for a slice with no dependsOn", () => {
    const plan = [slice({ title: "Root" })];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const wireCalls = fake.calls.filter(
      (args) =>
        args[0] === "api" && typeof args[1] === "string" && args[1].endsWith("/dependencies/blocked_by"),
    );
    expect(wireCalls).toHaveLength(0);
  });

  it("passes read-back verification and returns normally when the published graph matches", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).not.toThrow();
  });

  it("fails read-back verification, naming the exact missing edge, when a wired edge never lands", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on root", dependsOn: [1] })];
    // firstIssueNumber defaults to 100, so Root -> #100 and Depends on root -> #101 deterministically.
    const fake = createFakeGh({ dropEdges: [{ blockedNumber: 101, blockerNumber: 100 }] });

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Depends on root"\).*blocked by slice 1 \("Root"\)/,
    );

    // The write was still attempted and recorded — only the read-back is missing the edge.
    const wireCalls = fake.calls.filter(
      (args) =>
        args[0] === "api" &&
        typeof args[1] === "string" &&
        args[1].endsWith("/dependencies/blocked_by") &&
        args.includes("-F"),
    );
    expect(wireCalls).toHaveLength(1);
  });

  // The three cases that used to sit here — no block, a block that isn't
  // JSON, a block the schema refuses — were about a response this module no
  // longer sees. It is handed a `Plan`, which the API's tool-input validation
  // and zod have both already accepted; the response-shaped refusals live in
  // `shared/structured-output.test.ts`, at the seam that owns them. What is
  // left below is this module's own refusal: graph shape.

  it("refuses an out-of-range dependsOn, naming the offending slice, with zero argv recorded", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Points past the end", dependsOn: [7] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /slice 2 \("Points past the end"\).*out-of-range/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a self-reference, naming the offending slice, with zero argv recorded", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Depends on itself", dependsOn: [2] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
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

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(
      /dependency cycle detected/,
    );
    expect(fake.calls).toHaveLength(0);
  });

  it("refuses a graph with no unblocked root, with zero argv recorded", () => {
    const plan = [slice({ title: "First", dependsOn: [2] }), slice({ title: "Second", dependsOn: [1] })];
    const fake = createFakeGh();

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow(/no unblocked root/);
    expect(fake.calls).toHaveLength(0);
  });

  it("renders a body with all four headings in order, criteria as checkboxes, and no Closes directive", () => {
    const plan = [
      slice({
        title: "Root",
        acceptanceCriteria: [
          "First thing is true — check: `make test`",
          "Second thing is true — check: `npm run lint`",
        ],
        filesClaimed: ["bin/b.ts", "bin/c.ts"],
      }),
    ];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
    const bodyFlagIndex = createCall!.indexOf("--body");
    const body = createCall![bodyFlagIndex + 1];

    const headingOrder = ["## Parent PRD", "## What to build", "## Acceptance criteria", "## Files claimed"];
    const positions = headingOrder.map((heading) => body.indexOf(heading));
    expect(positions.every((p) => p !== -1)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    expect(body).toContain(`#${PRD_NUMBER}`);
    expect(body).toContain("- [ ] First thing is true — check: `make test`");
    expect(body).toContain("- [ ] Second thing is true — check: `npm run lint`");
    expect(body).toContain("- bin/b.ts");
    expect(body).toContain("- bin/c.ts");
    expect(body).not.toMatch(/closes/i);
  });

  it("renders an empty filesClaimed as the None sentinel", () => {
    const plan = [slice({ title: "No files touched", filesClaimed: [] })];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
    const body = createCall![createCall!.indexOf("--body") + 1];

    expect(body).toContain("- None — no files.");
  });

  it("renders seamsConsumed lines in the body without ever treating them as a Files claimed bullet", () => {
    const seamLine = "`GhExec` — the injected gh argv executor — shared/gh.ts — consumed by everything.";
    const plan = [
      slice({
        title: "Consumes a seam",
        filesClaimed: ["docs/only/this/file.ts"],
        seamsConsumed: [seamLine],
      }),
    ];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const createCall = fake.calls.find((args) => args[0] === "issue" && args[1] === "create");
    const body = createCall![createCall!.indexOf("--body") + 1];

    expect(body).toContain(seamLine);

    const filesSection = body.slice(
      body.indexOf("## Files claimed"),
      body.indexOf("## Seams consumed") === -1 ? undefined : body.indexOf("## Seams consumed"),
    );
    expect(filesSection).toContain("- docs/only/this/file.ts");
    expect(filesSection).not.toContain(seamLine);
  });
});

/**
 * Lane 03's hand-off to lane 04. Nothing sent this dispatch until #145's seam audit: #167 built
 * `implement.yml`'s receiving end and recorded that the send belonged to whichever ticket owned
 * this file, and no ticket ever claimed it — so 26 published tickets sat waiting for a dispatch
 * that had no sender. #201 rewires the send again: lane 03 asks lane 04 to author each slice's
 * acceptance tests, naming which slices are ready, rather than telling lane 05 directly — see
 * `dispatchReadySlices`'s header for why the order matters.
 */
describe("sliceAndPublish asks lane 04 to author acceptance tests for every published slice", () => {
  it("sends one acceptance-wanted dispatch per published slice, naming its issue", () => {
    // One root and two dependents: a plan `validatePlan` accepts, since it now refuses more than
    // one unblocked root (#240). What this test is about is the dispatch per published slice, so
    // the shape only has to be three slices and legal.
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Also depends on root", dependsOn: [1] }),
      slice({ title: "Depends on root", dependsOn: [1] }),
    ];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    expect(fake.dispatches.map((d) => d.eventType)).toEqual([
      ACCEPTANCE_WANTED_DISPATCH_ACTION,
      ACCEPTANCE_WANTED_DISPATCH_ACTION,
      ACCEPTANCE_WANTED_DISPATCH_ACTION,
    ]);
    expect(fake.dispatches.map((d) => d.payload.issue)).toEqual([
      String(published[0].number),
      String(published[1].number),
      String(published[2].number),
    ]);
  });

  it("flags a slice with no blocked-by edges as ready, and a blocked one as not", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    expect(fake.dispatches).toHaveLength(2);
    expect(fake.dispatches[0].payload).toEqual({ issue: String(published[0].number), ready: "1" });
    expect(fake.dispatches[1].payload).toEqual({ issue: String(published[1].number), ready: "0" });
  });

  /**
   * Ordering, not merely "both happened". A dispatch sent before the read-back would start an
   * implementer against a graph that then failed verification — and `verifyBlockedByGraph` throws,
   * so nothing downstream would ever learn the run it started was against a graph nobody accepted.
   */
  it("dispatches only after the blocked-by read-back has verified the graph", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const fake = createFakeGh();

    sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    const readBacks = fake.calls
      .map((args, index) => ({ args, index }))
      .filter(({ args }) => args[0] === "api" && args[1]?.endsWith("dependencies/blocked_by") && !args.includes("-F"));
    const lastReadBack = readBacks.length === 0 ? -1 : readBacks[readBacks.length - 1].index;
    const firstDispatch = fake.calls.findIndex(
      (args) => args[0] === "api" && args[1] === "repos/{owner}/{repo}/dispatches",
    );
    expect(lastReadBack).toBeGreaterThan(-1);
    expect(firstDispatch).toBeGreaterThan(lastReadBack);
  });

  /**
   * #179: the folded constant is unfolded, so publish-time dispatch is one *caller* of the
   * readiness predicate rather than a second implementation of it. Asserted against the source
   * because behaviour alone cannot tell the two apart — at publish time they agree by construction,
   * and that agreement is exactly what let readiness be answered once and never again.
   */
  it("asks readySlices rather than testing dependsOn.length itself", () => {
    const source = readFileSync(fileURLToPath(new URL("./slice-and-publish.ts", import.meta.url)), "utf8");
    // Comments stripped: the header still names the folded constant, because saying what was
    // wrong is the point of the header.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

    expect(code).toContain("readySlices");
    expect(code).not.toContain("dependsOn.length");
  });

  it("gives the same answer the predicate gives for the state a publish is in", () => {
    // The mix this test needs is ready alongside not-ready, which one root and two dependents gives
    // just as well as two roots did — and `validatePlan` now refuses the two-root version (#240).
    const plan = [
      slice({ title: "Root" }),
      slice({ title: "Blocked", dependsOn: [1] }),
      slice({ title: "Also blocked", dependsOn: [1] }),
    ];
    const fake = createFakeGh();

    const published = sliceAndPublish(plan, PRD_NUMBER, fake.gh);

    // The same graph, stated independently of the publisher, in the state a publish leaves it:
    // every issue open, nothing merged, nothing claimed.
    const states: SliceState[] = [
      { number: published[0].number, blockedBy: [], delivery: "open", started: false },
      { number: published[1].number, blockedBy: [published[0].number], delivery: "open", started: false },
      { number: published[2].number, blockedBy: [published[0].number], delivery: "open", started: false },
    ];

    const readyNumbers = new Set(readySlices(states).map((state) => state.number));
    expect(fake.dispatches.map((dispatch) => Number(dispatch.payload.issue))).toEqual(
      published.map((issue) => issue.number),
    );
    expect(fake.dispatches.map((dispatch) => dispatch.payload.ready)).toEqual(
      published.map((issue) => (readyNumbers.has(issue.number) ? "1" : "0")),
    );
  });

  it("throws before dispatching anything when the graph fails its read-back", () => {
    const plan = [slice({ title: "Root" }), slice({ title: "Blocked", dependsOn: [1] })];
    const fake = createFakeGh({ dropEdges: [{ blockedNumber: 101, blockerNumber: 100 }] });

    expect(() => sliceAndPublish(plan, PRD_NUMBER, fake.gh)).toThrow();
    expect(fake.dispatches).toEqual([]);
  });
});
