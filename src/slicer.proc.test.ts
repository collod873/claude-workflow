import { describe, expect, it } from "vitest";
import { heard, starts, wellFormedSpec, workflowJobs } from "./scenarios.ts";
import { slicing, SLICING_SESSION } from "./slicer.part.ts";
import { outOfScope, why } from "./ticket-shape.ts";

const ATTRIBUTION = "The owner, 2026-09-27, ruling the Big jobs layer:";
const WAVES = "> I would prefer to answer a lot of questions for a big app at once, rather than 20 tickets with no parent.";
const WATCHING = "> I dont think slice can stop and ask me something";
const SPEC = wellFormedSpec
  .replace(/## Problem Statement\n\n.*\n/, `## Problem Statement\n\n${ATTRIBUTION}\n\n${WAVES}\n\n${WATCHING}\n`)
  .replace("The slicer and the done check.", "- The done check.\n- Rate limits: the owner, \"only if that ever becomes a problem\".");
const SPEC_OUT_OF_SCOPE = "- The done check.\n- Rate limits: the owner, \"only if that ever becomes a problem\".";
const REWRITE = SPEC.replace("Reuse the ticket machinery where it already fits.", "Reuse the ticket machinery where it already fits.\n\n### Names the tickets share\n\n- `SLICE_LABEL`: the label both tickets read.");

const DID = "The slicer settled the label both tickets read.";
const NEXT = "Wave 1 files the spec kind and reads it back.";

const piece = (title: string, passages: number[], done = ["It holds."]) => ({ title, passages, why: `Wave 1 of the spec: ${title.toLowerCase()}.`, done });
const wave = (tickets = [piece("File the spec kind", [1, 2]), piece("Read the spec kind", [3])], spec = REWRITE, moves = [1]) => ({ spec, tickets, did: DID, next: NEXT, moves });

describe("bin/slice turns a filed spec into its first wave of tickets under it, with no session open (#1021)", () => {
  it("rewrites the spec with the names its tickets share, keeping the Problem Statement, then files the wave as sub-issues of the spec", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed its first wave under it: #1101, #1102"] });
    expect(sliced.rewrites()).toEqual([REWRITE]);
    expect(sliced.filed().map(({ title }) => title)).toEqual(["File the spec kind", "Read the spec kind"]);
    expect(sliced.linked()).toEqual(["repos/{owner}/{repo}/issues/968/sub_issues sub_issue_id=901101", "repos/{owner}/{repo}/issues/968/sub_issues sub_issue_id=901102"]);
    expect(sliced.calls().indexOf("issue edit 968")).toBeLessThan(sliced.calls().findIndex((call) => call.startsWith("issue create")));
    expect(sliced.comments()).toHaveLength(1);
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

  it("asks for the fewest tickets that fit, split only by the parts they touch, named in CONTEXT.md's words with no path (#1034)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    sliced.run();
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("the fewest tickets that each fit the builder's brief cap of 8192 bytes");
    expect(handed).toContain("one ticket unless two pieces touch different parts and neither needs the other's code");
    expect(handed).toContain("find which parts each piece touches before you group them");
    expect(handed).toContain("`## Problem Statement` and `## Out of Scope` stay byte for byte");
    expect(handed).toContain("in the words of the repo's `CONTEXT.md`");
    expect(handed).toContain("no path");
    expect(handed).not.toContain("a path,");
    expect(handed).not.toContain("change nothing here");
  });

  it("posts one note on the spec starting `## Wave 1`: the passages its tickets quote copied by code, what the wave did, what comes next, and the sentences it moves (#1037)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave([piece("Read the spec kind", [3]), piece("File the spec kind", [1, 3])])] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.comments()).toEqual([`## Wave 1\n\n${ATTRIBUTION}\n\n${WATCHING}\n\n${DID}\n\n${NEXT}\n\nFiled: #1101, #1102.\n\n<!-- moves: 1 -->\n`]);
    expect(sliced.calls().at(-1)).toBe("issue comment 968");
  });

  it("sends back a wave that moves a sentence the spec does not list, and asks for what the wave did, what comes next and the sentences it moves (#1037)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, undefined, [2]), wave()] });

    expect(sliced.run().status).toBe(0);
    const [handed = "", sentBack = ""] = sliced.handed();
    expect(handed).toContain("## The sentences it will be tried on\n\n1. see a spec land as its own issue, labelled spec");
    expect(handed).toContain("`moves`");
    expect(sentBack).toContain("the note moves sentence 2, and the spec lists 1");
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

  it("after two rounds back still over the brief cap, marks the spec stuck and files nothing", () => {
    const big = piece("Do it all", [2], ["x".repeat(9000)]);
    const sliced = slicing({ body: SPEC, answers: [wave([big])] });

    const run = sliced.run();
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/^slice: #968 marked stuck, its wave still refused after 2 rounds back: ticket 1, "Do it all", would be/);
    expect(sliced.handed()).toHaveLength(3);
    expect(sliced.argv().filter((args) => args.includes("--add-label") || args.includes("--remove-label"))).toEqual([]);
    expect(sliced.marked()).toEqual(["968 slicing", "968 stuck"]);
    expect(sliced.comments()).toEqual([expect.stringMatching(/^The slicer filed nothing: its wave still refused after 2 rounds back: ticket 1, "Do it all", would be/)]);
    expect(sliced.rewrites()).toEqual([]);
    expect(sliced.filed()).toEqual([]);
    expect(sliced.linked()).toEqual([]);
  });

  it("restores the owner's Problem Statement over a rewrite that changes it, and sends back a ticket naming a passage it does not have", () => {
    const changed = REWRITE.replace(WATCHING, "> I dont think slice can stop");
    const sliced = slicing({ body: SPEC, answers: [wave([piece("File the spec kind", [4])], changed), wave(undefined, changed)] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).not.toContain("Problem Statement'");
    expect(sentBack).toContain('ticket 1, "File the spec kind", quotes passage 4, and the Problem Statement has 3');
    expect(sliced.rewrites()).toEqual([REWRITE]);
  });

  it("restores the owner's Out of Scope over a rewrite that drops an item or changes its whitespace, and files each ticket with the Out of Scope the owner filed", () => {
    const changed = REWRITE.replace("- The done check.\n", "").replace(`${WAVES}\n`, `${WAVES}  \n`);
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, changed)] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.handed()).toHaveLength(1);
    expect(sliced.rewrites()).toEqual([REWRITE]);
    for (const { body } of sliced.filed()) expect(outOfScope(body)).toBe(SPEC_OUT_OF_SCOPE);
  });

  it("sends back a rewrite that drops the Problem Statement or the Out of Scope, since code has nowhere to restore them", () => {
    const dropped = REWRITE.replace("## Problem Statement", "## Problem").replace("## Out of Scope", "## Out");
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, dropped), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain("the rewrite drops '## Problem Statement', the owner's words, which stay byte-identical");
    expect(sentBack).toContain("the rewrite drops '## Out of Scope', which every ticket carries byte-identical");
    expect(sliced.rewrites()).toEqual([REWRITE]);
  });

  it("slices a spec filed with CRLF line endings when the model answers in LF, restoring the owner's bytes into the rewrite before comparing (#1027)", () => {
    const sliced = slicing({ body: SPEC.replaceAll("\n", "\r\n"), answers: [wave()] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: ["slice: #968 filed its first wave under it: #1101, #1102"] });
    expect(sliced.handed()).toHaveLength(1);
    const [rewrite = ""] = sliced.rewrites();
    expect(rewrite).toContain(`## Problem Statement\r\n\r\n${ATTRIBUTION}\r\n\r\n${WAVES}\r\n\r\n${WATCHING}\r\n\r\n## Solution\n`);
    expect(rewrite).toContain(`## Out of Scope\r\n\r\n${SPEC_OUT_OF_SCOPE.replaceAll("\n", "\r\n")}\r\n\r\n## Further Notes\n`);
    expect(rewrite).toContain("### Names the tickets share\n");
  });

  it("carries the spec's raw bytes, line endings included, as each ticket's Why quote and Out of Scope (#1027)", () => {
    const passage = `${WAVES}\r\n> a second line of the same passage`;
    const body = SPEC.replace(WAVES, passage.replaceAll("\r\n", "\n")).replaceAll("\n", "\r\n");
    const sliced = slicing({ body, answers: [wave()] });

    expect(sliced.run().status).toBe(0);
    const [first = ""] = sliced.filed().map(({ body: filed }) => filed);
    expect(first).toContain(`## Why\n\n${ATTRIBUTION}\r\n\r\n${passage}\n\n`);
    expect(first).toContain(`## Out of Scope\n\n${SPEC_OUT_OF_SCOPE.replaceAll("\n", "\r\n")}\n`);
  });

  it("joins the passages a ticket quotes with the separator the owner filed after each, CRLF and a blank line holding spaces included (#1027)", () => {
    const body = SPEC.replace(`${ATTRIBUTION}\n\n${WAVES}\n\n`, `${ATTRIBUTION}\n \t\n${WAVES}\n\n\n`).replaceAll("\n", "\r\n");
    const sliced = slicing({ body, answers: [wave([piece("File the spec kind", [1, 2]), piece("Read the spec kind", [1, 3])])] });

    expect(sliced.run().status).toBe(0);
    const [adjacent = "", apart = ""] = sliced.filed().map(({ body: filed }) => filed);
    expect(adjacent).toContain(`## Why\n\n${ATTRIBUTION}\r\n \t\r\n${WAVES}\n\nWave 1`);
    expect(apart).toContain(`## Why\n\n${ATTRIBUTION}\r\n \t\r\n${WATCHING}\n\nWave 1`);
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

  it("comments on the spec naming the tickets filed and those not, when a ticket of the wave will not file (#1028)", () => {
    const third = wave([piece("File the spec kind", [1, 2]), piece("Read the spec kind", [3]), piece("Close the spec kind", [3])]);
    const sliced = slicing({ body: SPEC, answers: [third], gh: '[[ $2 == create && -e "${0%/bin/gh}/created/1" ]] && { printf \'HTTP 403: Resource not accessible\\n\' >&2; exit 1; }' });

    expect(sliced.run().stderr).toBe('slice: #968 filed 1 of 3 tickets, "Read the spec kind" would not file: gh issue create failed: HTTP 403: Resource not accessible\n');
    expect(sliced.comments()).toEqual([
      'The slicer rewrote this spec and filed only part of its wave, since "Read the spec kind" would not file: gh issue create failed: HTTP 403: Resource not accessible\n\nFiled: #1101.\n\nNot filed: "Read the spec kind", "Close the spec kind".',
    ]);
  });

  it("names a ticket that filed but would not go under the spec among those filed, and the rest as not filed (#1028)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: "[[ $* == *sub_issue_id* ]] && exit 1" });

    expect(sliced.run().status).toBe(1);
    expect(sliced.comments()).toEqual(['The slicer rewrote this spec and filed only part of its wave, since #1101 would not go under it\n\nFiled: #1101, not under this spec.\n\nNot filed: "Read the spec kind".']);
  });

  it("ends red at unread naming the id read of a filed ticket that gh fails, and links nothing (#1111)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: '[[ $* == *"--jq .id"* ]] && exit 1' });

    expect(sliced.run()).toEqual({ status: 1, stdout: "", stderr: "slice: #968 filed #1101, but its id could not be read, so it is not under the spec\n" });
    expect(sliced.linked()).toEqual([]);
    expect(sliced.marked()).toEqual(["968 slicing"]);
  });

  it("names no ticket as not filed when the last filed but would not go under the spec (#1028)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: "[[ $* == *sub_issue_id=901102* ]] && exit 1" });

    expect(sliced.run().status).toBe(1);
    expect(sliced.comments()[0]).toContain("Filed: #1101, #1102, not under this spec.\n\nNot filed: none.");
  });

  it("names no ticket filed when the first will not file (#1028)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: "[[ $2 == create ]] && exit 1" });

    expect(sliced.run().status).toBe(1);
    expect(sliced.comments()).toHaveLength(1);
    expect(sliced.comments()[0]).toContain('Filed: none.\n\nNot filed: "File the spec kind", "Read the spec kind".');
  });

  it("ends red naming the comment that would not post, when the ticket and the comment saying so both fail (#1028)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: "[[ $2 == create || $2 == comment ]] && { printf 'HTTP 403: Resource not accessible\\n' >&2; exit 1; }" });

    expect(sliced.run()).toEqual({
      status: 1,
      stdout: "",
      stderr: 'slice: #968 filed 0 of 2 tickets, "File the spec kind" would not file: gh issue create failed: HTTP 403: Resource…; no comment says so, gh issue comment failed: HTTP 403: Resource not accessible\n',
    });
    expect(sliced.comments()).toHaveLength(1);
  });

  it("names a ticket that filed with a URL it cannot read by its title under Filed, not as not filed (#1028)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()], gh: "[[ $2 == create ]] && { printf 'created\\n'; exit 0; }" });

    expect(sliced.run()).toEqual({ status: 1, stdout: "", stderr: 'slice: #968 filed 1 of 2 tickets, "File the spec kind" filed, but its number could not be read from "created"\n' });
    expect(sliced.comments()).toEqual([
      'The slicer rewrote this spec and filed only part of its wave, since "File the spec kind" filed, but its number could not be read from "created"\n\nFiled: "File the spec kind", its number unknown and not under this spec.\n\nNot filed: "Read the spec kind".',
    ]);
    expect(sliced.linked()).toEqual([]);
  });

  it("the owner's spec starts slice.yml, which files its wave with the App's token; not a spec, or someone else's, does not", async () => {
    const slice = workflowJobs("slice.yml").slice ?? { steps: [] };
    const slices = (labels: string[], sender = "collod873") => starts("slice.yml", "slice", { labels, sender, action: "opened" });

    expect(await slices(["spec"])).toBe(true);
    expect(await slices([])).toBe(false);
    expect(await slices(["note"])).toBe(false);
    expect(await slices(["spec"], "stranger")).toBe(false);
    expect(slice.permissions).toEqual({ contents: "read", issues: "write" });
    const sliced = slice.steps.find((step) => step.run?.includes("bin/slice"));
    expect(sliced?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
  });
});

describe("bin/slice marks the spec slicing while it writes a wave, and building once the wave is filed, so a spec shows where it is (#1064)", () => {
  it("marks slicing before the slicer is hired, then building once the wave's tickets are filed and its note posted", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.marked()).toEqual(["968 slicing", "968 building"]);
  });

  it("marks no building when the wave's note will not post, or the slicer stops for the owner", () => {
    const unnoted = slicing({ body: SPEC, answers: [wave()], gh: "[[ $2 == comment ]] && exit 1" });
    const stopped = slicing({ body: SPEC, answers: [wave([piece("Do it all", [2], ["x".repeat(9000)])])] });

    expect(unnoted.run().status).toBe(1);
    expect(unnoted.marked()).toEqual(["968 slicing"]);
    expect(stopped.run().status).toBe(1);
    expect(stopped.marked()).toEqual(["968 slicing", "968 stuck"]);
  });

  it("marks nothing on an issue that is not a spec", () => {
    const sliced = slicing({ labels: ["ticket"] });

    expect(sliced.run().status).not.toBe(0);
    expect(sliced.marked()).toEqual([]);
  });
});
