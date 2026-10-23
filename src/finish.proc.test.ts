import { describe, expect, it } from "vitest";
import { finishing, type Slice } from "./finish.part.ts";
import { heard } from "./scenarios.ts";
import { HELD } from "./spelled.ts";

const SENTENCES = ["see the spec land on main", "see each slice's file on main"];
const FIXES_ZONE = '  [ "$CALL" = 1 ] && printf \'export const zone = 2;\\n\' >src/zone.ts';
const big = (name: string) => Array.from({ length: 400 }, (_, at) => `export const ${name}${at} = "${name} line ${at}";`).join("\n");
const RED_CHECK = "printf 'ZONE-TEST-BROKE\\n' >../red.log\nprintf 'check: red test; log %s\\n' \"$(cd .. && pwd)/red.log\"\nexit 1\n";
const REFUSAL = "land: the full check went red on the commit, so nothing was pushed; fix what it names and land again";
const REFUSES_ONCE = `[ -f ../refused ] || { touch ../refused; printf '%s\\n' '${REFUSAL}' >&2; exit 1; }`;
const ALWAYS_REFUSES = `printf '%s\\n' '${REFUSAL}' >&2\nexit 1`;

describe("bin/finish reviews a spec's integration branch twice, lands it once and runs the done check (ADR-0013)", () => {
  it("runs the full check, then a fresh reviewer on the code standard and a fresh one on the spec, the second reading the first's fix, lands both with bin/land --spec, and prints landed and missed last", () => {
    const finished = finishing({ reviewer: FIXES_ZONE });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.checked()).toEqual(["--full --publish"]);
    const [code = "", spec = "", tried = ""] = finished.handed();
    expect(code).toMatch(/^# Hold spec #974 to the code standard before it lands/);
    expect(code).toContain("call the Skill tool with `coding-standards` for the code standard and `testing`");
    expect(code).toContain("+export const zone = 1;");
    expect(code).not.toContain("## Its full check is red");
    expect(spec).toMatch(/^# Hold spec #974 to what it asks before it lands/);
    expect(spec).toContain("- [ ] see the spec land on main");
    expect(spec).toContain("+export const zone = 2;");
    expect(tried).toMatch(/^Try each sentence/);
    expect(finished.hired().some((argv) => argv.includes("--resume"))).toBe(false);
    expect(finished.log("-1", "--format=%s")).toBe("Review #974 on the code standard");
    const [[, head = "", ...named] = []] = finished.landed();
    expect(named).toEqual(["--spec", "974"]);
    expect(head).toBe(finished.log("-1", "--format=%H"));
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("comments both reviewers' reasons on the spec's PR through bin/land's approve reason", () => {
    const finished = finishing();

    expect(finished.run().status).toBe(0);
    expect(finished.landed()).toHaveLength(1);
    expect(finished.approved()).toEqual(["On the code standard: reason 1\n\nOn the spec: reason 2"]);
  });

  it("hands a red full check to the reviewer on the code standard, with the log it names", () => {
    const finished = finishing({ check: RED_CHECK });

    expect(finished.run().status).toBe(0);
    const [code = ""] = finished.handed();
    expect(code).toContain("## Its full check is red");
    expect(code).toContain("ZONE-TEST-BROKE");
  });

  it("prints the sentences the done check missed and leaves the spec open for the scheduler's fix pass, still exiting 0 since it landed and the check ran", () => {
    const finished = finishing({ sentences: SENTENCES, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "missed", tried: "found no zone file" }] });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([]);
    expect(finished.marked()).toEqual(["974 checking"]);
  });
});

describe("bin/finish takes a reviewer's stuck and owner steps, as a ticket's review does (ADR-0005)", () => {
  const STEP = { title: "Add the Twilio key to Railway", why: "Storm alerts text through Twilio, which needs TWILIO_KEY set on the Railway service." };

  it("marks the spec stuck and calls the owner on a reviewer's stuck, landing nothing", () => {
    const finished = finishing({ answer: { outcome: "stuck", reason: "only the owner can say which zones count" } });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines).toEqual(["landed=", "missed="]);
    expect(finished.marked()).toEqual(["974 stuck"]);
    expect(finished.calls().find((args) => args[1] === "comment")?.join(" ")).toContain("@collod873 a reviewer of #974 stopped and needs you: only the owner can say which zones count");
    expect(finished.handed()).toHaveLength(1);
    expect(finished.landed()).toEqual([]);
  });

  it("files each reviewer's owner steps once as owner-step notes after the spec lands, before its done check, though both reviewers name it", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [STEP] } });

    expect(finished.run().status).toBe(0);
    const created = finished.calls().filter((args) => args[1] === "create");
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(expect.arrayContaining(["owner-step", STEP.title]));
    expect(created[0]?.join(" ")).toContain("Left to the owner by the run that landed spec #974.");
    const firstCreate = finished.calls().findIndex((args) => args[1] === "create");
    const doneCheckClose = finished.calls().findIndex((args) => args[1] === "close");
    expect(firstCreate).toBeLessThan(doneCheckClose);
  });
});

describe("bin/finish splits each review per slice by the commits' Slice trailers when the diff is over its cap", () => {
  const SLICES: Slice[] = [
    { id: "zone", files: { "src/zone.ts": big("zone") } },
    { files: { "src/loose.ts": big("loose") } },
    { id: "clock", files: { "src/clock.ts": big("clock") } },
  ];

  it("hires one reviewer per slice for the code standard, then one per slice for the spec, the commits naming no slice last", () => {
    const finished = finishing({ slices: SLICES });

    expect(finished.run().status).toBe(0);
    const handed = finished.handed();
    expect(handed).toHaveLength(7);
    const reviewed = handed.slice(0, 6).map((prompt) => ["zone", "clock", "loose"].filter((name) => prompt.includes(`${name} line 1`)));
    expect(reviewed).toEqual([["zone"], ["clock"], ["loose"], ["zone"], ["clock"], ["loose"]]);
    expect(handed[0]).toContain("you review only what slice `zone` built");
    expect(handed[5]).toContain("you review only what the commits naming no slice built");
    expect(handed[0]).toContain("End each message with the line `Slice: zone`");
    expect(handed[5]).not.toContain("End each message with the line");
    expect(finished.approved()[0]).toMatch(/^On the code standard, slice `zone`: reason 1\n\n/);
  });

  it("hands a red full check to the first slice's reviewer alone, since its fix turns the check for every slice", () => {
    const finished = finishing({ slices: SLICES, check: RED_CHECK });

    expect(finished.run().status).toBe(0);
    const [zone = "", clock = ""] = finished.handed();
    expect(zone).toContain("ZONE-TEST-BROKE");
    expect(clock).not.toContain("ZONE-TEST-BROKE");
  });

  it("files the code reviewer's fix under its slice, so that slice's reviewer on the spec reads it", () => {
    const finished = finishing({ slices: SLICES, reviewer: '  [ "$CALL" = 1 ] && printf \'export const zoneFixed = 1;\\n\' >>src/zone.ts' });

    expect(finished.run().status).toBe(0);
    expect(finished.log("--format=%B", "-1", "--grep", "Review #974 on the code standard")).toContain("Slice: zone");
    const [, , , zoneOnTheSpec = "", clockOnTheSpec = ""] = finished.handed();
    expect(zoneOnTheSpec).toContain("- Review #974 on the code standard");
    expect(clockOnTheSpec).not.toContain("- Review #974 on the code standard");
  });
});

describe("bin/finish hands bin/land's refusal back to the last reviewer, as a ticket's review does (ADR-0012)", () => {
  it("resumes the reviewer on the spec with what bin/land said, and lands what it fixed", () => {
    const finished = finishing({ land: REFUSES_ONCE, reviewer: '  [ "$CALL" = 3 ] && printf \'export const zone = 3;\\n\' >src/zone.ts' });

    expect(finished.run().status).toBe(0);
    const third = finished.hired()[2] ?? [];
    expect(third[third.indexOf("--resume") + 1]).toBe("review-2");
    expect(finished.handed()[2]).toContain(REFUSAL);
    expect(finished.landed()).toHaveLength(2);
  });

  it("ends red without landing once two rounds in a row change nothing", () => {
    const finished = finishing({ land: ALWAYS_REFUSES });

    const ran = finished.run();

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("finish: #974 did not land, and two rounds in a row of its last reviewer changed nothing");
    expect(ran.stdout).toBe("landed=\nmissed=\n");
    expect(finished.handed().some((prompt) => prompt.startsWith("Try each sentence"))).toBe(false);
  });
});

describe("bin/finish stands down on a held spec, so a pause holds the landing too", () => {
  it.each(HELD)("hires, checks and lands nothing on a spec marked %s when it starts", (held) => {
    const finished = finishing({ labels: ["spec", held] });

    expect(finished.run()).toEqual({ status: 1, stdout: `finish: #974 is marked ${held}, so nothing was reviewed or landed\nlanded=\nmissed=\n`, stderr: "" });
    expect(finished.handed()).toEqual([]);
    expect(finished.checked()).toEqual([]);
    expect(finished.landed()).toEqual([]);
  });

  it.each(HELD)("lands nothing once the spec is marked %s while its reviewers ran", (held) => {
    const finished = finishing({ labelsAtLand: ["spec", held] });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines).toEqual([`finish: #974 is marked ${held}, so its reviewed branch does not land`, "landed=", "missed="]);
    expect(finished.handed()).toHaveLength(2);
    expect(finished.landed()).toEqual([]);
  });

  it("refuses an integration branch holding nothing past main, hiring nothing", () => {
    const finished = finishing({ slices: [] });

    expect(finished.run()).toEqual({ status: 1, stdout: "landed=\nmissed=\n", stderr: "finish: #974 holds nothing past main on its integration branch, so nothing was reviewed or landed\n" });
    expect(finished.handed()).toEqual([]);
  });

  it("refuses an issue that is not a spec, hiring nothing", () => {
    const finished = finishing({ labels: ["ticket"] });

    expect(finished.run()).toEqual({ status: 1, stdout: "landed=\nmissed=\n", stderr: "finish: #974 is not a spec, so nothing was reviewed or landed\n" });
    expect(finished.handed()).toEqual([]);
  });
});

describe("bin/finish acts on a fresh App token after each model run, since a spec's run outlives the job's first token (#1504)", () => {
  it("lands, and posts the done check, on tokens minted after the model that ran before each", () => {
    const finished = finishing({ appKeyed: true });

    expect(finished.run().status).toBe(0);
    const [[landedOn = ""] = []] = finished.landed();
    expect(landedOn).toMatch(/^minted-\d+$/);
    const [postedOn = ""] = finished.tokenOf((args) => args[0] === "issue" && args[1] === "comment");
    expect(postedOn).toMatch(/^minted-\d+$/);
    expect(postedOn).not.toBe(landedOn);
  });
});
