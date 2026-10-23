import { describe, expect, it } from "vitest";
import { finishing, type Slice } from "./finish.part.ts";
import { createdIssues, heard, schemaIn } from "./scenarios.ts";
import { HELD } from "./spelled.ts";

const SENTENCES = ["see the spec land on main", "see each slice's file on main"];
const FIXES_ZONE = '  [ "$CALL" = 1 ] && printf \'export const zone = 2;\\n\' >src/zone.ts';
const big = (name: string, lines: number) => Array.from({ length: lines }, (_, at) => `export const ${name}${at} = "${name} line ${at}";`).join("\n");
const RED_CHECK = "printf 'ZONE-TEST-BROKE\\n' >../red.log\nprintf 'check: red test; log %s\\n' \"$(cd .. && pwd)/red.log\"\nexit 1\n";
const REFUSAL = "land: the full check went red on the commit, so nothing was pushed; fix what it names and land again";
const REFUSES_ONCE = `[ -f ../refused ] || { touch ../refused; printf '%s\\n' '${REFUSAL}' >&2; exit 1; }`;
const ALWAYS_REFUSES = `printf '%s\\n' '${REFUSAL}' >&2\nexit 1`;

const SLICED = (slices: { id: string; title: string; fix?: boolean }[], fixPass = false) =>
  `## Spec run\n\n<!-- progress: ${JSON.stringify({ fixPass, slices: slices.map(({ id, title, fix = false }) => ({ id, title, why: `${title} is why ${id} was cut`, done: [`${id} shows on the branch`], blockedBy: [], state: "merged", tries: 1, fix })) })} -->`;
const MISSED = "## Done check\n\n1. **Did not hold**: see each slice's file on main\n   found no zone file on main";

describe("bin/finish reviews a spec's integration branch on the spec, then on the code standard, lands it once and runs the done check (ADR-0013)", () => {
  it("hires one reviewer on the spec over the whole branch, then runs the full check, then one on the code standard reading the first's fix, lands with bin/land --spec, and prints landed and missed last", () => {
    const finished = finishing({ reviewer: FIXES_ZONE });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.checked()).toEqual(["--full --publish"]);
    const [spec = "", code = "", tried = ""] = finished.handed();
    expect(spec).toMatch(/^# Hold spec #974 to what it asks before it lands/);
    expect(spec).toContain("- [ ] see the spec land on main");
    expect(spec).toContain("+export const zone = 1;");
    expect(code).toMatch(/^# Hold spec #974 to the code standard before it lands/);
    expect(code).toContain("call the Skill tool with `coding-standards` for the code standard and `testing`");
    expect(code).toContain("+export const zone = 2;");
    expect(code).not.toContain("## Its full check is red");
    expect(tried).toMatch(/^Try each sentence/);
    expect(finished.hired().some((argv) => argv.includes("--resume"))).toBe(false);
    expect(finished.log("-1", "--format=%s")).toBe("Review #974 on the spec");
    const [[, head = "", ...named] = []] = finished.landed();
    expect(named).toEqual(["--spec", "974"]);
    expect(head).toBe(finished.log("-1", "--format=%H"));
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("hands the reviewer on the spec each slice's title, why and done from the progress comment, so it knows what each slice was cut to build", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }])] });

    expect(finished.run().status).toBe(0);
    const [spec = "", code = ""] = finished.handed();
    expect(spec).toContain("`tenant-time-zone`: Store each tenant's time zone");
    expect(spec).toContain("Store each tenant's time zone is why tenant-time-zone was cut");
    expect(spec).toContain("tenant-time-zone shows on the branch");
    expect(code).not.toContain("is why tenant-time-zone was cut");
  });

  it("comments both reviewers' reasons on the spec's PR through bin/land's approve reason", () => {
    const finished = finishing();

    expect(finished.run().status).toBe(0);
    expect(finished.landed()).toHaveLength(1);
    expect(finished.approved()).toEqual(["On the spec: reason 1\n\nOn the code standard: reason 2"]);
  });

  it("prints the sentences the done check missed and leaves the spec open for the scheduler's fix pass, still exiting 0 since it landed and the check ran", () => {
    const finished = finishing({ sentences: SENTENCES, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "missed", tried: "found no zone file" }] });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([]);
    expect(finished.marked()).toEqual(["974 checking"]);
  });

  it("tells both reviewers of the fix pass that the spec landed and this branch holds only the fix, with the done check's findings and the fix pass's slices alone", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }, { id: "zone-shown", title: "Show the zone file on main", fix: true }], true), MISSED] });

    expect(finished.run().status).toBe(0);
    const [spec = "", code = ""] = finished.handed();
    for (const prompt of [spec, code]) {
      expect(prompt).toContain("This is the spec's one fix pass");
      expect(prompt).toContain("found no zone file on main");
      expect(prompt).not.toContain("Builders built this spec slice by slice");
    }
    expect(spec).toContain("`zone-shown`: Show the zone file on main");
    expect(spec).not.toContain("Store each tenant's time zone");
  });

  it("lists the newest commits when the commit list is over its cap, and says git log reads the rest", () => {
    const long = (id: string) => ({ id, files: { [`src/${id}.ts`]: `export const ${id} = 1;\n` }, message: `Build slice ${id}\n\n${"why it was built ".repeat(150)}` });
    const finished = finishing({ slices: [long("oldest"), long("middle"), long("newest")] });

    expect(finished.run().status).toBe(0);
    const [spec = ""] = finished.handed();
    expect(spec).toContain("Build slice newest");
    expect(spec).not.toContain("Build slice oldest");
    expect(spec).toContain("`git log origin/main..HEAD` reads any the list cuts");
  });
});

describe("bin/finish runs the full check after the reviewer on the spec and holds the reviewer handed it red until it is green (ADR-0012)", () => {
  const RED_FOR = (rounds: number) => `n=$(cat ../checks-run 2>/dev/null || echo 0); n=$((n + 1)); echo $n >../checks-run\nif [ $n -le ${rounds} ]; then\n${RED_CHECK}fi\nprintf 'check: ok\\n'\n`;

  it("hands the red to the reviewer on the code standard, with the log it names, and lands once the check it re-runs is green", () => {
    const finished = finishing({ check: RED_FOR(1) });

    expect(finished.run().status).toBe(0);
    const [spec = "", code = ""] = finished.handed();
    expect(spec).not.toContain("ZONE-TEST-BROKE");
    expect(code).toContain("## Its full check is red");
    expect(code).toContain("ZONE-TEST-BROKE");
    expect(finished.checked()).toEqual(["--full --publish", "--full --publish"]);
    expect(finished.hired().some((argv) => argv.includes("--resume"))).toBe(false);
    expect(finished.landed()).toHaveLength(1);
  });

  it("resumes that reviewer with the red while the re-run check stays red", () => {
    const finished = finishing({ check: RED_FOR(2) });

    expect(finished.run().status).toBe(0);
    const resumed = finished.hired()[2] ?? [];
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe("review-2");
    expect(finished.handed()[2]).toContain("The full check still ends red after your answer");
    expect(finished.handed()[2]).toContain("ZONE-TEST-BROKE");
    expect(finished.landed()).toHaveLength(1);
  });

  it("ends red without landing once two rounds in a row of that reviewer leave the check red and change nothing", () => {
    const finished = finishing({ check: RED_CHECK });

    const ran = finished.run();

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("finish: #974 stayed red on its full check, and two rounds in a row of its reviewer changed nothing");
    expect(finished.landed()).toEqual([]);
  });
});

describe("bin/finish takes a reviewer's stuck and owner steps, as a ticket's review does (ADR-0005)", () => {
  const STEP = { title: "Add the Twilio key $CALL to Railway", why: "Storm alerts text through Twilio, which needs TWILIO_KEY set on the Railway service." };

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

  it("keeps an earlier reviewer's fix on the integration branch's origin when a later one stops", () => {
    const finished = finishing({ reviewer: `${FIXES_ZONE}\n  OUTCOME=approve; [ "$CALL" = 2 ] && OUTCOME=stuck`, answer: { outcome: "$OUTCOME", reason: "reason $CALL" } });

    expect(finished.run().status).toBe(1);
    expect(finished.pushed().split("\n")[0]).toBe("Review #974 on the spec");
  });

  it("asks owner steps of the reviewer on the spec alone and files them once the spec lands, before its done check", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [STEP] } });

    expect(finished.run().status).toBe(0);
    expect(finished.handed()[1]).not.toContain("`steps`:");
    const created = finished.calls().filter((args) => args[1] === "create");
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(expect.arrayContaining(["owner-step", "Add the Twilio key 1 to Railway"]));
    expect(created[0]?.join(" ")).toContain("Left to the owner by the run that landed spec #974.");
    const firstCreate = finished.calls().findIndex((args) => args[1] === "create");
    const doneCheckClose = finished.calls().findIndex((args) => args[1] === "close");
    expect(firstCreate).toBeLessThan(doneCheckClose);
  });
});

describe("bin/finish splits the review on the code standard per slice, by the commits' Slice trailers, only when the diff is over its cap", () => {
  const sliced = (lines: number): Slice[] => [
    { id: "zone", files: { "src/zone.ts": big("zone", lines) } },
    { files: { "src/loose.ts": big("loose", lines) } },
    { id: "clock", files: { "src/clock.ts": big("clock", lines) } },
  ];

  it("hires one reviewer on the code standard for a diff under its cap, though the diff is too big to hand whole", () => {
    const finished = finishing({ slices: sliced(400) });

    expect(finished.run().status).toBe(0);
    expect(finished.handed()).toHaveLength(3);
  });

  it("hires one reviewer on the spec, then one per slice on the code standard, the commits naming no slice last, each given its commit ids and told to look for copies across the branch", () => {
    const finished = finishing({ slices: sliced(2400) });

    expect(finished.run().status).toBe(0);
    const handed = finished.handed();
    expect(handed).toHaveLength(5);
    expect(handed[0]).toMatch(/^# Hold spec #974 to what it asks/);
    const reviewed = handed.slice(1, 4).map((prompt) => ["zone", "clock", "loose"].filter((name) => prompt.includes(`src/${name}.ts`)));
    expect(reviewed).toEqual([["zone"], ["clock"], ["loose"]]);
    expect(handed[1]).toContain("you review what slice `zone` built");
    expect(handed[1]).toContain(`- ${finished.log("-1", "--format=%h", "--grep", "Build slice zone")} Build slice zone`);
    expect(handed[1]).toContain("copies what this slice wrote");
    expect(handed[3]).toContain("you review what the commits naming no slice built");
    expect(finished.approved()[0]).toMatch(/^On the spec: reason 1\n\nOn the code standard, slice `zone`: reason 2\n\n/);
  });

  it("hands a red full check to the first slice's reviewer alone, saying the red may sit in any slice", () => {
    const finished = finishing({ slices: sliced(2400), check: `[ -f ../checked ] && { printf 'check: ok\\n'; exit 0; }\ntouch ../checked\n${RED_CHECK}` });

    expect(finished.run().status).toBe(0);
    const [, zone = "", clock = ""] = finished.handed();
    expect(zone).toContain("ZONE-TEST-BROKE");
    expect(zone).toContain("may sit in any slice's code");
    expect(clock).not.toContain("ZONE-TEST-BROKE");
  });

  it("adds the slice's trailer by code to every commit its reviewer on the code standard made, asking nothing of it", () => {
    const finished = finishing({ slices: sliced(2400), reviewer: '  [ "$CALL" = 2 ] && printf \'export const zoneFixed = 1;\\n\' >>src/zone.ts && git commit --quiet -am "Inline the zone helper"' });

    expect(finished.run().status).toBe(0);
    expect(finished.log("--format=%(trailers:key=Slice,valueonly)", "-1", "--grep", "Inline the zone helper")).toBe("zone");
    expect(finished.handed().some((prompt) => prompt.includes("End each message with the line"))).toBe(false);
  });

  it("hands bin/land's refusal to the last reviewer on the code standard, saying it covers the whole branch", () => {
    const finished = finishing({ slices: sliced(2400), land: REFUSES_ONCE });

    expect(finished.run().status).toBe(0);
    const resumed = finished.hired()[4] ?? [];
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe("review-4");
    expect(finished.handed()[4]).toContain("covers the whole integration branch");
  });
});

describe("bin/finish hands bin/land's refusal back to the last reviewer, as a ticket's review does (ADR-0012)", () => {
  it("resumes the reviewer on the code standard with what bin/land said, lands what it fixed, and comments its new reason after the review it gave first", () => {
    const finished = finishing({ land: REFUSES_ONCE, reviewer: '  [ "$CALL" = 3 ] && printf \'export const zone = 3;\\n\' >src/zone.ts' });

    expect(finished.run().status).toBe(0);
    const third = finished.hired()[2] ?? [];
    expect(third[third.indexOf("--resume") + 1]).toBe("review-2");
    expect(finished.handed()[2]).toContain(REFUSAL);
    expect(finished.landed()).toHaveLength(2);
    expect(finished.approved()).toEqual(["On the spec: reason 1\n\nOn the code standard: reason 2", "On the spec: reason 1\n\nOn the code standard: reason 2\n\nAfter `bin/land` refused it: reason 3"]);
  });

  it("lands nothing more once the spec is marked paused while bin/land's refusal was fixed", () => {
    const finished = finishing({ land: REFUSES_ONCE, reviewer: '  [ "$CALL" = 3 ] && printf \'spec\\npaused\\n\' >../labels-at-land' });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines).toContain("finish: #974 is marked paused, so its reviewed branch does not land");
    expect(finished.landed()).toHaveLength(1);
  });

  it("ends red without landing once two rounds in a row change nothing", () => {
    const finished = finishing({ land: ALWAYS_REFUSES });

    const ran = finished.run();

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("finish: #974 did not land, and two rounds in a row of its reviewer changed nothing");
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

describe("every risk a spec's reviewer names ends somewhere, as a ticket's reviewer's does, where the spec's two reviewers never got #1491's filing", () => {
  const FIX = { fault: "A zone with no tenant falls back to UTC.", title: "Give a zone with no tenant the business's time zone", done: ["A zone with no tenant reads the business's time zone."] };
  const OWNERS = { risk: "Storm alerts text every zone at once.", ends: "owner", why: "Whether to stagger them; my pick is no." };
  const NEEDS_NOTHING = { risk: "The zone list loads before the map.", ends: "nothing", why: "Both render in the same frame." };

  it("asks each reviewer for its risks, files each fix and owner's call once in all though both name it, once the spec lands, and posts each risk with where it ends", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", fixes: [FIX], risks: [OWNERS, NEEDS_NOTHING] } });

    expect(finished.run().status).toBe(0);
    expect(schemaIn(finished.hired()[0] ?? []).required).toContain("risks");
    expect(finished.handed()[0]).toContain("sits in `fixes` or `risks`");
    const created = createdIssues(finished.calls());
    expect(created.map(({ title }) => title)).toEqual([FIX.title, "Your call after spec #974's review"]);
    expect(created[0]?.body).toContain("Follow-up of #974: its reviewer let this through.");
    expect(created[1]?.body).toContain(`@collod873 the review of spec #974 leaves these to you:\n\n- ${OWNERS.risk} ${OWNERS.why}\n`);
    const [approved = ""] = finished.approved();
    expect(approved).toContain(`- filed as the ticket "${FIX.title}" once it lands: ${FIX.fault}`);
    expect(approved).toContain(`- needs nothing: ${NEEDS_NOTHING.risk} ${NEEDS_NOTHING.why}`);
  });

});
