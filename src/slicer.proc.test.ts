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
const PICK = "- **Spec kind filing**: the spec kind files through the ticket's pipeline,\n  one issue each.";
const SHIPPED = "- **`SLICE_LABEL`**: under the Slicer in CONTEXT.md.";
const RECORD = `### Picks\n\n${PICK}\n\n### Shipped names\n\n${SHIPPED}`;
const SENTENCES = "## I'll know it works when I can";
const recorded = (body: string, record = RECORD) => body.replace(SENTENCES, `## Decisions record\n\n${record}\n\n${SENTENCES}`);
const REWRITE = recorded(SPEC);
const NAMES = "### Names the tickets share\n\n- `SLICE_LABEL`: the label both tickets read.";
const OLDER = SPEC.replace("Reuse the ticket machinery where it already fits.", `Reuse the ticket machinery where it already fits.\n\n${NAMES}`);

const DID = "The slicer settled the label both tickets read.";
const NEXT = "Wave 1 files the spec kind and reads it back.";

const piece = (title: string, passages: number[], done = ["It holds."], cites: string[] = []) => ({ title, passages, why: `Wave 1 of the spec: ${title.toLowerCase()}.`, done, cites });
const wave = (tickets = [piece("File the spec kind", [1, 2]), piece("Read the spec kind", [3])], record = RECORD, moves = [1]) => ({ record, tickets, did: DID, next: NEXT, moves });

describe("bin/slice turns a filed spec into its first wave of tickets under it, with no session open (#1021)", () => {
  it("splices the slicer's decisions record into the spec just before its sentences, keeping every other byte as filed, then files the wave as sub-issues of the spec", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: [`slice: #968 filed its first wave under it: #1101, #1102. The owner's ${Buffer.byteLength(SPEC)} bytes stand as filed, and no round came back for the spec's size.`] });
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

  it("asks for the fewest tickets that fit, split only by the parts they touch with a shared surface's slot a wave ahead, and a record of named picks and shipped names with no path that tickets cite (#1034, #1182, #1185)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });

    sliced.run();
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("the fewest tickets that each fit the builder's brief cap of 8192 bytes");
    expect(handed).toContain("one ticket unless two pieces touch different parts and neither needs the other's code");
    expect(handed).toContain("find which parts each piece touches before you group them");
    expect(handed).toContain("every other byte of the spec stays as filed");
    expect(handed).toContain("`### Picks`");
    expect(handed).toContain("`### Shipped names`, one line each");
    expect(handed).toContain("slice the surface's slot a wave ahead of them");
    expect(handed).toContain("in the words of the repo's `CONTEXT.md`");
    expect(handed).toContain("no path");
    expect(handed).not.toContain("a path,");
    expect(handed).not.toContain("change nothing here");
    expect(handed).toContain("`cites`");
    expect(handed).toContain("`- **name**:`");
    expect(handed).toContain("Decisions it relies on");
    expect(handed).toContain("at most 2 done sentences");
  });

  it("tells the slicer the owner's bytes, the record's bytes and the room left under the spec cap before it answers (#1182)", () => {
    const body = recorded(SPEC);
    const sliced = slicing({ body, answers: [wave()] });

    sliced.run();
    const [handed = ""] = sliced.handed();
    const owner = Buffer.byteLength(SPEC);
    const record = Buffer.byteLength(RECORD);
    const left = 65536 - Buffer.byteLength(body);
    expect(handed).toContain(`The owner's bytes come to ${owner} and the record's to ${record}, leaving ${left} under the spec cap of 65536`);
  });

  it("refuses a record that puts the spec over the spec cap with the bytes the record must lose, and asks again for the record and the wave, never the spec (#1182)", () => {
    const over = `${RECORD}\n\n${"x".repeat(65536)}`;
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, over), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    const bytes = Buffer.byteLength(recorded(SPEC, over));
    expect(sentBack).toContain(`the spec would be ${bytes} bytes, over the spec cap of 65536: the record must lose at least ${bytes - 65536} bytes`);
    expect(sentBack).toContain("the `record` and every ticket of the wave");
    expect(sentBack).not.toContain("`spec`");
    expect(sliced.rewrites()).toEqual([REWRITE]);
  });

  it("refuses a record naming a file path or carrying a `## ` heading, as Implementation Decisions refuses a path (#1182)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, `${RECORD}\n- read src/slicer.ts\n\n## Testing Decisions\n\nmore`), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain("the record names `src/slicer.ts`, a file path");
    expect(sentBack).toContain("the record carries a '## ' heading");
    expect(sliced.rewrites()).toEqual([REWRITE]);
  });

  it("replaces a spec's standing record with the new one and leaves every other byte, line endings included, as filed (#1182)", () => {
    const filed = recorded(SPEC.replaceAll("\n", "\r\n"), "### Picks\r\n\r\n- an old pick");
    const sliced = slicing({ body: filed, answers: [wave()] });

    expect(sliced.run().status).toBe(0);
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("## Decisions record\n\n### Picks\r\n\r\n- an old pick\n\n## I'll know it works when I can");
    expect(sliced.rewrites()).toEqual([recorded(SPEC.replaceAll("\n", "\r\n"))]);
  });

  it("lifts an older spec's `### Names the tickets share` out of its Implementation Decisions as the starting record (#1182)", () => {
    const sliced = slicing({ body: OLDER, answers: [wave()] });

    expect(sliced.run().status).toBe(0);
    const [handed = ""] = sliced.handed();
    expect(handed).toContain("Reuse the ticket machinery where it already fits.\n\n## Testing Decisions");
    expect(handed).toContain(`## Decisions record\n\n${NAMES}\n\n${SENTENCES}`);
    expect(sliced.rewrites()).toEqual([REWRITE]);
  });

  it("copies each record entry a ticket cites word for word under `## Decisions it relies on`, between its Why and its Done when (#1185)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave([piece("File the spec kind", [1, 2], ["It files."], ["`SLICE_LABEL`", "Spec kind filing"]), piece("Read the spec kind", [3])])] });

    expect(sliced.run().status).toBe(0);
    const [first = "", second = ""] = sliced.filed().map(({ body }) => body);
    expect(first).toContain(`Wave 1 of the spec: file the spec kind.\n\n## Decisions it relies on\n\n${SHIPPED}\n\n${PICK}\n\n## Done when\n\n- It files.\n`);
    expect(second).not.toContain("## Decisions it relies on");
  });

  it("ends a ticket citing a pick with the CONTEXT.md or ADR sentence naming its picks, and adds none for shipped names alone (#1185)", () => {
    const record = `### Picks\n\n${PICK}\n\n- **Wave note**: one note a wave.\n\n### Shipped names\n\n${SHIPPED}`;
    const tickets = [piece("File the spec kind", [1, 2], ["It files.", "It reads."], ["Spec kind filing", "Wave note", "`SLICE_LABEL`"]), piece("Read the spec kind", [3], ["It reads."], ["`SLICE_LABEL`"])];
    const sliced = slicing({ body: SPEC, answers: [wave(tickets, record)] });

    expect(sliced.run().status).toBe(0);
    const [first = "", second = ""] = sliced.filed().map(({ body }) => body);
    expect(first).toContain("## Done when\n\n- It files.\n- It reads.\n- The repo's CONTEXT.md, or an ADR for its reasoning, holds the full description of Spec kind filing and Wave note.\n\n## Out of Scope");
    expect(second).toContain("## Done when\n\n- It reads.\n\n## Out of Scope");
  });

  it("sends back a ticket citing a name the record lacks, naming the ticket and the name, and one citing a pick that gives three done sentences of its own (#1185)", () => {
    const tickets = [piece("File the spec kind", [1, 2], ["It files."], ["Spec kind"]), piece("Read the spec kind", [3], ["One.", "Two.", "Three."], ["Spec kind filing"])];
    const sliced = slicing({ body: SPEC, answers: [wave(tickets), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain('ticket 1, "File the spec kind", cites "Spec kind", and the record has no entry by that name');
    expect(sentBack).toContain('ticket 2, "Read the spec kind", cites a pick, so code adds a done sentence of its own: give at most 2');
    expect(sliced.filed()).toHaveLength(2);
  });

  it("sends back a record bullet under Picks or Shipped names with no `- **name**:` (#1185)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, `${RECORD}\n\n- an unnamed pick`), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain("the record carries a bullet with no `- **name**:`, so no ticket can cite it: \"- an unnamed pick\"");
  });

  it("sends back a ticket the copied entries put over the brief cap to split (#1185)", () => {
    const record = `### Picks\n\n- **Long**: ${"word ".repeat(1700)}`;
    const sliced = slicing({ body: SPEC, answers: [wave([piece("File the spec kind", [1, 2], ["It files."], ["Long"])], record), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toMatch(/ticket 1, "File the spec kind", would be \d+ bytes, over the builder's brief cap of 8192 bytes: split it/);
  });

  it("posts one note on the spec starting `## Wave 1`: the passages its tickets quote copied by code, what the wave did, what comes next, and the sentences it moves (#1037)", () => {
    const sliced = slicing({ body: SPEC, answers: [wave([piece("Read the spec kind", [3]), piece("File the spec kind", [1, 3])])] });

    expect(sliced.run().status).toBe(0);
    expect(sliced.comments()).toEqual([`## Wave 1\n\n${ATTRIBUTION}\n\n${WATCHING}\n\n${DID}\n\n${NEXT}\n\nThe owner's ${Buffer.byteLength(SPEC)} bytes stand as filed.\n\nFiled: #1101, #1102.\n\n<!-- moves: 1 -->\n`]);
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

    expect(heard(sliced.run())).toEqual({ status: 0, stderr: "", lines: [`slice: #968 filed its first wave under it: #1101, #1102. The owner's ${Buffer.byteLength(SPEC)} bytes stand as filed, and no round came back for the spec's size.`] });
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

  it("sends back a ticket naming a passage the Problem Statement does not have", () => {
    const sliced = slicing({ body: SPEC, answers: [wave([piece("File the spec kind", [4])]), wave()] });

    expect(sliced.run().status).toBe(0);
    const [, sentBack = ""] = sliced.handed();
    expect(sentBack).toContain('ticket 1, "File the spec kind", quotes passage 4, and the Problem Statement has 3');
    expect(sliced.rewrites()).toEqual([REWRITE]);
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

describe("bin/slice proves on the running system that the owner's words stood and what the size refusal cost (#1192)", () => {
  it("stops red without posting when the owner's bytes of the body it would post differ from those it read", () => {
    const body = SPEC.slice(0, SPEC.indexOf(SENTENCES)).trimEnd();
    const sliced = slicing({ body, answers: [wave(undefined, undefined, [])] });

    const run = sliced.run();
    expect(run.status).toBe(1);
    expect(run.stderr).toBe(`slice: #968 ended red, the owner's ${Buffer.byteLength(body)} bytes would not stand as filed in the body it would post, so nothing was posted\n`);
    expect(sliced.rewrites()).toEqual([]);
    expect(sliced.filed()).toEqual([]);
    expect(sliced.comments()).toEqual([]);
  });

  it("says in its filing line and its wave note that the owner's bytes stand as filed, with their count, and that no round came back for the spec's size", () => {
    const sliced = slicing({ body: SPEC, answers: [wave()] });
    const owner = Buffer.byteLength(SPEC);

    expect(heard(sliced.run()).lines).toEqual([`slice: #968 filed its first wave under it: #1101, #1102. The owner's ${owner} bytes stand as filed, and no round came back for the spec's size.`]);
    expect(sliced.comments()[0]).toContain(`\n\nThe owner's ${owner} bytes stand as filed.\n\nFiled: #1101, #1102.`);
  });

  it("logs each round sent back for the spec's size with the bytes over and the bytes the record had to lose, and the seconds from the first to filing", () => {
    const over = `${RECORD}\n\n${"x".repeat(65536)}`;
    const larger = `${over}${"y".repeat(10)}`;
    const sliced = slicing({ body: SPEC, answers: [wave(undefined, over), wave(undefined, larger), wave()] });
    const bytesOver = (record: string) => Buffer.byteLength(recorded(SPEC, record)) - 65536;

    const { lines } = heard(sliced.run());
    expect(lines.slice(0, 2)).toEqual([
      `slice: #968 round 1 came back for the spec's size: the spec would be ${bytesOver(over)} bytes over the spec cap of 65536, so the record had to lose ${bytesOver(over)} of its ${Buffer.byteLength(over)} bytes`,
      `slice: #968 round 2 came back for the spec's size: the spec would be ${bytesOver(larger)} bytes over the spec cap of 65536, so the record had to lose ${bytesOver(larger)} of its ${Buffer.byteLength(larger)} bytes`,
    ]);
    expect(lines[2]).toMatch(/^slice: #968 filed its first wave under it: #1101, #1102\. The owner's \d+ bytes stand as filed, \d+ seconds after the first round came back for the spec's size\.$/);
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
