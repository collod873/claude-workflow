import { describe, expect, it } from "vitest";
import { heard, holds, onlyJob, slicing, SLICING_SESSION, wellFormedSpec } from "./scenarios.ts";
import { outOfScope, why } from "./ticket-shape.ts";

const ATTRIBUTION = "The owner, 2026-09-27, ruling the Big jobs layer:";
const WAVES = "> I would prefer to answer a lot of questions for a big app at once, rather than 20 tickets with no parent.";
const WATCHING = "> I dont think slice can stop and ask me something";
const SPEC = wellFormedSpec
  .replace(/## Problem Statement\n\n.*\n/, `## Problem Statement\n\n${ATTRIBUTION}\n\n${WAVES}\n\n${WATCHING}\n`)
  .replace("The slicer and the done check.", "- The done check.\n- Rate limits: the owner, \"only if that ever becomes a problem\".");
const SPEC_OUT_OF_SCOPE = "- The done check.\n- Rate limits: the owner, \"only if that ever becomes a problem\".";
const REWRITE = SPEC.replace("Reuse the ticket machinery where it already fits.", "Reuse the ticket machinery where it already fits.\n\n### Names the tickets share\n\n- `SLICE_LABEL`: the label both tickets read.");

const piece = (title: string, passages: number[], done = ["It holds."]) => ({ title, passages, why: `Wave 1 of the spec: ${title.toLowerCase()}.`, done });
const wave = (tickets = [piece("File the spec kind", [1, 2]), piece("Read the spec kind", [3])], spec = REWRITE) => ({ spec, tickets });

describe("bin/slice turns a filed spec into its first wave of tickets under it, with no session open (#1021)", () => {
  it("rewrites the spec with the names its tickets share, keeping the Problem Statement, then files the wave as sub-issues of the spec", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed its first wave under it: #1101, #1102"] });
    expect(sliced.rewrites()).toEqual([REWRITE]);
    expect(sliced.filed().map(({ title }) => title)).toEqual(["File the spec kind", "Read the spec kind"]);
    expect(sliced.linked()).toEqual(["repos/{owner}/{repo}/issues/968/sub_issues sub_issue_id=901101", "repos/{owner}/{repo}/issues/968/sub_issues sub_issue_id=901102"]);
    expect(sliced.calls().indexOf("issue edit 968")).toBeLessThan(sliced.calls().findIndex((call) => call.startsWith("issue create")));
    expect(sliced.comments()).toEqual([]);
    expect(sliced.handed()).toHaveLength(1);
  });

  it("quotes the passages each ticket names from the Problem Statement byte for byte as its Why, and carries the spec's Out of Scope byte for byte, both copied by code", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    expect(sliced.run().status).toBe(0);
    const [first, second] = sliced.filed().map(({ body }) => body);
    expect(why(first ?? "")).toContain(`${ATTRIBUTION}\n\n${WAVES}`);
    expect(why(first ?? "")).not.toContain(WATCHING);
    expect(why(second ?? "")).toContain(WATCHING);
    expect(why(second ?? "")).not.toContain(WAVES);
    expect(why(first ?? "")).toContain("Wave 1 of the spec: file the spec kind.");
    for (const body of [first, second]) expect(outOfScope(body ?? "")).toBe(SPEC_OUT_OF_SCOPE);
    expect(first).toContain("## Done when\n\n- It holds.");
  });

  it("hires opus fenced to reading, and hands it the spec with its Problem Statement numbered passage by passage", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    expect(sliced.run().status).toBe(0);
    const [hired = []] = sliced.hired();
    const [handed = ""] = sliced.handed();
    expect(hired[hired.indexOf("--model") + 1]).toBe("opus");
    expect(hired[hired.indexOf("--tools") + 1]).toBe("Read,Grep,Glob");
    expect(handed).toContain(SPEC.trim());
    expect(handed).toContain(`1. ${ATTRIBUTION}`);
    expect(handed).toContain(`3. ${WATCHING}`);
  });

  it("sends a ticket whose brief would pass the brief cap back to the slicer to split, and files the split wave", () => {
    const big = piece("Do it all", [2], ["x".repeat(9000)]);
    const sliced = slicing({ body: SPEC, answers: [wave([big]), wave()] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed its first wave under it: #1101, #1102"] });
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toMatch(/ticket 1, "Do it all", would be \d+ bytes, over the builder's brief cap of 8192 bytes: split it/);
    const [, resumed = []] = sliced.hired();
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe(SLICING_SESSION);
    expect(sliced.filed().map(({ title }) => title)).toEqual(["File the spec kind", "Read the spec kind"]);
  });

  it("after two rounds back still over the brief cap, marks the spec needs-human and files nothing", () => {
    const big = piece("Do it all", [2], ["x".repeat(9000)]);
    const sliced = slicing({ body: SPEC, answers: [wave([big])] });

    const run = sliced.run();
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^slice: #968 marked needs-human, its wave still refused after 2 rounds back: ticket 1, "Do it all", would be/);
    expect(sliced.handed()).toHaveLength(3);
    expect(sliced.argv()).toContainEqual(["issue", "edit", "968", "--add-label", "needs-human"]);
    expect(sliced.rewrites()).toEqual([]);
    expect(sliced.filed()).toEqual([]);
    expect(sliced.linked()).toEqual([]);
  });

  it("sends back a rewrite that changes the Problem Statement, and a ticket naming a passage it does not have", () => {
    const changed = REWRITE.replace(WATCHING, "> I dont think slice can stop");
    const sliced = slicing({ body: SPEC, answers: [wave([piece("File the spec kind", [4])], changed), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain("the rewrite changes '## Problem Statement', the owner's words, which stay byte-identical");
    expect(sentBack).toContain('ticket 1, "File the spec kind", quotes passage 4, and the Problem Statement has 3');
    expect(sliced.rewrites()).toEqual([REWRITE]);
  });

  it("refuses an issue not labelled spec without spending a model, and anything but one issue number", () => {
    const ticket = slicing({ labels: ["ticket"], answers: [wave()] });
    expect(ticket.run()).toEqual({ status: 1, stdout: "", stderr: "slice: #968 is not a spec, so nothing sliced it\n" });
    expect(ticket.calls()).toEqual(["issue view 968"]);
    expect(ticket.hired()).toEqual([]);

    const bare = slicing({ answers: [wave()] });
    expect(bare.run("968", "969").status).toBe(2);
    expect(bare.run("#968").status).toBe(2);
    expect(bare.calls()).toEqual([]);
  });

  it("names the ticket that would not file, and files no more after it", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: "[[ $2 == create ]] && { printf 'HTTP 403: Resource not accessible\\n' >&2; exit 1; }" });

    expect(sliced.run()).toEqual({ status: 1, stdout: "", stderr: 'slice: #968 filed 0 of 2 tickets, "File the spec kind" would not file: gh issue create failed: HTTP 403: Resource not accessible\n' });
    expect(sliced.filed()).toHaveLength(1);
    expect(sliced.linked()).toEqual([]);
  });

  it("the owner's spec starts slice.yml, which files its wave with the App's token; not a spec, or someone else's, does not", () => {
    const slice = onlyJob("slice.yml");
    const starts = (labels: string[], sender = "collod873") => holds(slice.if ?? "true", { labels, sender, action: "opened" });

    expect(starts(["spec"])).toBe(true);
    expect(starts([])).toBe(false);
    expect(starts(["note"])).toBe(false);
    expect(starts(["spec"], "stranger")).toBe(false);
    expect(slice.permissions).toEqual({ contents: "read", issues: "write" });
    const sliced = slice.steps.find((step) => step.run?.includes("bin/slice"));
    expect(sliced?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
  });
});
