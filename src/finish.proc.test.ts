import { fromOf } from "./post.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { finishing, type Slice } from "./finish.part.ts";
import { createdIssues, git, heard, schemaIn, TAKEN_STEP } from "./scenarios.ts";
import { HELD, OWNER } from "./spelled.ts";

const SENTENCES = ["see the spec land on main", "see each slice's file on main"];
const FIXES_ZONE = '  [ "$CALL" = 1 ] && printf \'export const zone = 2;\\n\' >src/zone.ts';
const big = (name: string, lines: number) => Array.from({ length: lines }, (_, at) => `export const ${name}${at} = "${name} line ${at}";`).join("\n");
const RED_CHECK = "printf 'ZONE-TEST-BROKE\\n' >../red.log\nprintf 'check: red test; log %s\\n' \"$(cd .. && pwd)/red.log\"\nexit 1\n";
const REFUSAL = "land: the full check went red on the commit, so nothing was pushed; fix what it names and land again";
const REFUSES_ONCE = `[ -f ../refused ] || { touch ../refused; printf '%s\\n' '${REFUSAL}' >&2; exit 1; }`;
const ALWAYS_REFUSES = `printf '%s\\n' '${REFUSAL}' >&2\nexit 1`;

const SLICED = (slices: { id: string; title: string }[], landed?: string) =>
  `## Spec run\n\n<!-- progress: ${JSON.stringify({ landed, slices: slices.map(({ id, title }) => ({ id, title, why: `${title} is why ${id} was cut`, done: [`${id} shows on the branch`], blockedBy: [], state: "merged", tries: 1 })) })} -->`;

describe("bin/finish reviews a spec's integration branch on the spec, then on the code standard, lands it once and runs the done check (ADR-0013)", () => {
  it("hires one reviewer on the spec over the whole branch, then runs the full check, then one on the code standard reading the first's fix, lands with bin/land --spec, and prints landed and missed last", () => {
    const finished = finishing({ reviewer: FIXES_ZONE });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.checked()).toEqual(["--full --publish"]);
    const [spec = "", code = ""] = finished.handed();
    const [tried = ""] = finished.tried();
    expect(spec).toMatch(/^# Hold spec #974 to what it asks before it lands/);
    expect(spec).toContain("- [ ] see the spec land on main");
    expect(spec).toContain("+export const zone = 1;");
    expect(code).toMatch(/^# Hold spec #974 to the code standard before it lands/);
    expect(code).toContain("call the Skill tool with `coding-standards` and then with `testing`");
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

  it("prints the sentences the done check missed and filed as bugs, with the spec closed, exiting 0 since it landed and the check ran", () => {
    const finished = finishing({ sentences: SENTENCES, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "missed", tried: "found no zone file" }] });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
    expect(finished.marked()).toEqual([]);
  });

  it("lands though the done check could not finish, since it refuses no landing (#1626), then marks the landed spec stuck and calls the owner with its reason, so the scheduler stands down on stuck rather than leave a landed spec that nothing wakes (ADR-0009)", () => {
    const finished = finishing({ sentences: SENTENCES, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }] });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.landed()).toHaveLength(1);
    expect(finished.marked()).toEqual(["974 stuck"]);
    const called = finished.calls().filter((args) => args[1] === "comment").map((args) => args[args.indexOf("--body") + 1] ?? "");
    expect(called.filter((body) => body.startsWith(`@${OWNER} the done check of #974 stopped and needs you: the done checker gave no try for sentence 2.`))).toHaveLength(1);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([]);
  });

  it("stamps the spec's landing on its progress comment before the done check runs, so a run stopped after landing is found landed by its rerun", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }])] });

    expect(finished.run().status).toBe(0);
    const bodies = finished.calls().map((args) => (args.includes("--body") ? (args[args.indexOf("--body") + 1] ?? "") : (args.find((arg) => arg.startsWith("body="))?.slice("body=".length) ?? "")));
    const stamped = bodies.findIndex((body) => body.startsWith("## Spec run") && body.includes('"landed":"9974"'));
    expect(stamped).toBeGreaterThanOrEqual(0);
    expect(stamped).toBeLessThan(bodies.findIndex((body) => body.startsWith("## Done check")));
  });

  it("runs the done check alone on a checkout of main, reviewing and landing nothing, when the progress comment records the spec landed and its done check unfinished", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }], "9974")] });
    git(finished.session, "update-ref", "refs/remotes/origin/main", git(finished.session, "commit-tree", "HEAD^{tree}", "-p", "origin/main", "-p", "HEAD", "-m", "Merge the spec"));

    const ran = heard(finished.run());

    expect(finished.landed()).toEqual([]);
    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    const [tried, ...more] = finished.tried();
    expect(tried).toMatch(/^Try each sentence/);
    expect(more).toEqual([]);
    expect(finished.handed()).toEqual([]);
    expect(finished.log("-1", "--format=%s")).toBe("Merge the spec");
    expect(git(finished.session, "symbolic-ref", "--short", "HEAD")).toBe("spec/974");
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
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

describe("bin/finish tries the spec's sentences on its integration branch before it lands, and lands whatever they show (#1626, ADR-0006)", () => {
  const bodies = (calls: string[][]) => calls.map((args) => args[args.indexOf("--body") + 1] ?? "");
  const RECORDED = (tries: { sentence: number; outcome: string; tried: string }[], fixed: number[] = []) =>
    `## Spec run\n\n<!-- progress: ${JSON.stringify({ landed: "9974", slices: [{ id: "tenant-time-zone", title: "Store each tenant's time zone", why: "why", done: ["it holds"], blockedBy: [], state: "merged", tries: 1 }], tries, fixed })} -->`;

  it("starts the done check in its own tree at the reviewed head once the reviewer on the spec answers, running alongside the full check, and posts nothing of it before the spec lands", () => {
    const finished = finishing({ reviewer: FIXES_ZONE, overlapped: true });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    const [[where = "", at = ""] = []] = finished.triedAt();
    expect(where).not.toBe(finished.session);
    expect(at).toBe(finished.log("-1", "--format=%H", "--grep", "Review #974 on the spec"));
    expect(finished.overlapped()).toBe(true);
    const [beforeLand = 0] = finished.ghCallsAtLand();
    expect(bodies(finished.calls().slice(0, beforeLand)).filter((body) => body.startsWith("## Done check"))).toEqual([]);
    expect(bodies(finished.calls().slice(beforeLand)).filter((body) => body.startsWith("## Done check"))).toHaveLength(1);
  });

  it("gives the done check its own Postgres, port and temp dir when a step of its contract needs DATABASE_URL, and removes the Postgres after, where Mezzanine#2023 lost all five sentences to a migration on the shared dev database", () => {
    const finished = finishing({ contract: '{ "steps": { "integration": { "run": "true", "needs": ["DATABASE_URL"] } } }\n' });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    const [[, , database, port = "", temp = ""] = []] = finished.triedAt();
    expect(database).toBe("postgres://postgres:postgres@localhost:49153/postgres");
    expect(port).toMatch(/^\d+$/);
    expect(temp).not.toBe("");
    const dockered = finished.dockered();
    expect(dockered.some((call) => /^run .*postgres:16$/.test(call))).toBe(true);
    expect(dockered.at(-1)).toMatch(/^rm --force database-/);
  });

  it("hands the sentences the done check missed to the last reviewer as one round in its own session, files as bugs only those it did not name fixed, and posts the fixed ones as fixed, where 26 of 39 misses in a week were pages and forms nothing tested", () => {
    const finished = finishing({
      sentences: SENTENCES,
      tries: [{ sentence: 1, outcome: "missed", tried: "the zone page never loaded" }, { sentence: 2, outcome: "missed", tried: "each save rolled back" }],
      answerFrom: { call: 3, answer: { outcome: "approve", reason: "reason $CALL", fixed: [1] } },
    });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    const [, code = [], round = []] = finished.hired();
    expect(schemaIn(code).properties.fixed).toBeDefined();
    expect(round).toContain("--resume");
    const told = finished.handed()[2] ?? "";
    expect(told).toContain(`1. ${SENTENCES[0]}`);
    expect(told).toContain("the zone page never loaded");
    expect(told).toContain("each save rolled back");
    expect(told).toContain("`fixed`");
    expect(createdIssues(finished.calls()).map(({ title }) => title)).toEqual([SENTENCES[1]]);
    const [comment = ""] = bodies(finished.calls()).filter((body) => body.startsWith("## Done check"));
    expect(comment).toContain(`1. **Fixed before it landed**: ${SENTENCES[0]}`);
    expect(comment).toContain(`2. **Did not hold**: ${SENTENCES[1]}`);
    expect(finished.landed()).toHaveLength(1);
  });

  it("hands no round when every sentence held", () => {
    const finished = finishing({ sentences: SENTENCES, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "held", tried: "saw it" }] });

    expect(finished.run().status).toBe(0);
    expect(finished.handed()).toHaveLength(2);
  });

  it("files each sentence put to the owner as an owner step once the spec lands, saying what the owner could try", () => {
    const finished = finishing({ sentences: SENTENCES, tries: [{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "owner", tried: "needs a text to a real phone: text the shop number and see the reply" }] });

    expect(finished.run().status).toBe(0);
    const [step] = createdIssues(finished.calls());
    expect(step?.labels).toContain("owner-step");
    expect(step?.title).toContain(SENTENCES[1]);
    expect(step?.body).toContain("text the shop number and see the reply");
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("closes a landed spec from the tries its progress comment recorded, hiring no done check and reviewing nothing, when a rerun finds it landed", () => {
    const finished = finishing({ sentences: SENTENCES, said: [RECORDED([{ sentence: 1, outcome: "held", tried: "saw it" }, { sentence: 2, outcome: "missed", tried: "each save rolled back" }], [])] });
    git(finished.session, "update-ref", "refs/remotes/origin/main", git(finished.session, "commit-tree", "HEAD^{tree}", "-p", "origin/main", "-p", "HEAD", "-m", "Merge the spec"));

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    expect(finished.handed()).toEqual([]);
    expect(finished.tried()).toEqual([]);
    expect(finished.landed()).toEqual([]);
    expect(bodies(finished.calls()).filter((body) => body.startsWith("## Done check"))).toHaveLength(1);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("records the done check's tries on the progress comment before the spec lands, so a rerun after landing closes from them", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }])] });

    expect(finished.run().status).toBe(0);
    const [beforeLand = 0] = finished.ghCallsAtLand();
    expect(bodies(finished.calls().slice(0, beforeLand)).some((body) => body.startsWith("## Spec run") && body.includes('"tries":[{"sentence":1,"outcome":"held"'))).toBe(true);
  });

  it("readies the reviewer on the spec's tree with the contract's setup before hiring it, where five specs' reviewers had no node_modules and could run nothing", () => {
    const setups = '"$(git rev-parse --path-format=absolute --git-common-dir)/../../setups"';
    const finished = finishing({ contract: JSON.stringify({ setup: `printf 'setup %s\\n' "$PWD" >>${setups}` }), reviewer: `  printf 'hire %s\\n' "$PWD" >>"$ROOT/setups"` });

    expect(finished.run().status).toBe(0);
    const order = readFileSync(join(finished.root, "setups"), "utf8").trimEnd().split("\n");
    expect(order.indexOf(`setup ${finished.session}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`setup ${finished.session}`)).toBeLessThan(order.indexOf(`hire ${finished.session}`));
  });

  it("hands the reviewer on the spec the whole diff up to 200 KB, where a diff over 32 KB reached it as a stat and 22 of its sessions approved in under a minute", () => {
    const finished = finishing({ slices: [{ id: "wide", files: { "src/wide.ts": big("wide", 1500) } }] });

    expect(finished.run().status).toBe(0);
    const [spec = ""] = finished.handed();
    expect(spec).toContain('+export const wide1499 = "wide line 1499";');
    expect(spec).not.toContain("git diff --stat");
  });

  it("packs the review on the spec into whole slices under 200 KB when the diff is over it, each pack's reviewer handed the whole spec and every brief in its own tree", () => {
    const finished = finishing({
      slices: [
        { id: "wide", files: { "src/wide.ts": big("wide", 6000) } },
        { id: "zone", files: { "src/zone.ts": big("zone", 1500) } },
      ],
      said: [SLICED([{ id: "wide", title: "Widen it" }, { id: "zone", title: "Store each tenant's time zone" }])],
    });

    expect(finished.run().status).toBe(0);
    const handed = finished.handed();
    const onSpec = handed.flatMap((prompt, at) => (prompt.startsWith("# Hold spec #974 to what it asks") ? [at] : []));
    expect(onSpec).toHaveLength(2);
    for (const at of onSpec) {
      expect(handed[at]).toContain("- [ ] see the spec land on main");
      expect(handed[at]).toContain("`zone`: Store each tenant's time zone");
      expect(handed[at]).toContain("`wide`: Widen it");
      expect(finished.wheres()[at]).not.toBe(finished.session);
    }
    expect(onSpec.map((at) => (handed[at]?.includes('+export const zone0 = "zone line 0";') ? "zone" : "wide")).sort()).toEqual(["wide", "zone"]);
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

describe("bin/finish calls the owner on a full check the machine alone starved, as a ticket's builder does (#1573)", () => {
  const STARVED = "printf 'check: red build killed for memory (the machine ran short; next at 5120 MiB), lint killed for memory (the machine ran short; eslint at 900 MiB); log .git/check/logs/full.log\\n'; exit 1";
  const MIXED = "printf 'check: red build killed for memory (the machine ran short; next at 5120 MiB), test src/stops.test.ts:4; log .git/check/logs/full.log\\n'; exit 1";

  it("marks the spec stuck and calls the owner with a machine fault, handing the red to no reviewer", () => {
    const finished = finishing({ check: STARVED });

    const ran = finished.run();

    expect(ran.status).toBe(1);
    expect(finished.marked()).toEqual(["974 stuck"]);
    expect(finished.calls().find((args) => args[1] === "comment")?.join(" ")).toContain("the machine is at fault, not the code");
    expect(finished.handed()).toHaveLength(1);
    expect(finished.landed()).toEqual([]);
  });

  it("marks the spec stuck when the check re-run after the reviewer's answer is red only on starved steps", () => {
    const finished = finishing({ check: `n=$(cat ../checks-run 2>/dev/null || echo 0); n=$((n + 1)); echo $n >../checks-run\nif [ $n -le 1 ]; then\n${MIXED}\nfi\n${STARVED}\n` });

    finished.run();

    expect(finished.marked()).toEqual(["974 stuck"]);
    expect(finished.handed()).toHaveLength(2);
    expect(finished.landed()).toEqual([]);
  });

  it("hands a red mixing a starved step with a real failure to the reviewer on the code standard", () => {
    const finished = finishing({ check: MIXED });

    finished.run();

    expect(finished.marked()).toEqual([]);
    expect(finished.handed()[1]).toContain("## Its full check is red");
  });
});

describe("bin/finish takes a reviewer's stuck and owner steps, as a ticket's review does (ADR-0005)", () => {
  const STEP = { title: "Add the Twilio key $CALL to Railway", why: "Storm alerts text through Twilio, which needs TWILIO_KEY set on the Railway service.", needs: "TWILIO_KEY", ...TAKEN_STEP };

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

  const WHOLE = { ...STEP, title: "Add the Twilio key to Railway" };
  const UNHANDED = { ...WHOLE, handover: "" };
  const UNHANDED_REFUSAL = `"${WHOLE.title}": it makes a secret, but no last step says how to hand it over without pasting it into a chat`;

  it("hands the reviewer on the spec an owner step that filing would refuse back to its own session before bin/land, and files it once answered whole, never as a could-not-be-filed comment (#1623)", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [UNHANDED] }, answerFrom: { call: 2, answer: { outcome: "approve", reason: "reason $CALL", steps: [WHOLE] } } });

    expect(finished.run().status).toBe(0);
    const [, handedBack = "", code = ""] = finished.handed();
    expect(handedBack).toContain(UNHANDED_REFUSAL);
    expect(finished.hired()[1]).toEqual(expect.arrayContaining(["--resume", "review-1"]));
    expect(code).toMatch(/^# Hold spec #974 to the code standard/);
    expect(finished.landed()).toHaveLength(1);
    const created = finished.calls().filter((args) => args[1] === "create");
    expect(created).toHaveLength(1);
    expect(created[0]?.join(" ")).toContain("3. In a terminal, run");
    expect(finished.calls().filter((args) => args[1] === "comment").join(" ")).not.toContain("could not be filed");
  });

  it("lands nothing when the reviewer on the spec answers the same refused owner step again, so a step it cannot fix stops the run rather than looping", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [UNHANDED] } });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(UNHANDED_REFUSAL);
    expect(finished.handed()).toHaveLength(2);
    expect(finished.landed()).toEqual([]);
  });
});

describe("bin/finish packs the review on the code standard into whole slices under its cap, by the commits' Slice trailers, only when the diff is over that cap, and runs three packs at once", () => {
  const sliced = (lines: number): Slice[] => [
    { id: "zone", files: { "src/zone.ts": big("zone", lines) } },
    { files: { "src/loose.ts": big("loose", lines) } },
    { id: "clock", files: { "src/clock.ts": big("clock", lines) } },
  ];
  const packed: Slice[] = [
    { id: "wide", files: { "src/wide.ts": big("wide", 6000) } },
    { id: "zone", files: { "src/zone.ts": big("zone", 1500) } },
    { files: { "src/loose.ts": big("loose", 1000) } },
    { id: "clock", files: { "src/clock.ts": big("clock", 1500) } },
  ];
  const ON_CODE = "grep -q '^# Hold spec #974 to the code standard' \"$PROMPT\"";
  const onCode = (handed: string[]) => handed.filter((prompt) => prompt.startsWith("# Hold spec #974 to the code standard"));
  const reviewing = (prompt: string) => ["wide", "zone", "clock", "loose"].filter((name) => prompt.includes(`src/${name}.ts`));
  const zonePack = (handed: string[]) => handed.findIndex((prompt) => onCode([prompt]).length === 1 && prompt.includes("src/zone.ts"));

  it("hires one reviewer on the code standard for a diff under its cap, though the diff is too big to hand whole", () => {
    const finished = finishing({ slices: sliced(400) });

    expect(finished.run().status).toBe(0);
    expect(finished.handed()).toHaveLength(2);
  });

  it("packs whole slices into as few reviewers as fit under the cap, a slice over it alone, each given its commit ids and told to look for copies across the branch", () => {
    const finished = finishing({ slices: packed });

    expect(finished.run().status).toBe(0);
    const handed = finished.handed();
    expect(handed[0]).toMatch(/^# Hold spec #974 to what it asks/);
    const code = onCode(handed);
    expect(code.map(reviewing).sort()).toEqual([["wide"], ["zone", "clock", "loose"]]);
    const many = finished.handed()[zonePack(handed)] ?? "";
    expect(many).toContain("you review what slice `zone`, slice `clock`, and the commits naming no slice built");
    expect(many).toContain(`- ${finished.log("-1", "--format=%h", "--grep", "Build slice clock")} Build slice clock`);
    expect(many).toContain("copies what these slices wrote");
    expect(finished.approved()[0]).toMatch(/^On the spec, slice `wide`: reason \d\n\nOn the spec, slice `zone`, slice `clock`, and the commits naming no slice: reason \d\n\nOn the code standard, slice `wide`: reason \d\n\nOn the code standard, slice `zone`, slice `clock`, and the commits naming no slice: reason \d/);
  });

  it("runs at most three reviewers on the code standard at once", () => {
    const wide = (id: string): Slice => ({ id, files: { [`src/${id}.ts`]: big(id, 6000) } });
    const finished = finishing({ slices: ["north", "south", "east", "west"].map(wide), reviewer: `  ${ON_CODE} && { printf '+\\n' >>"$ROOT/spans"; sleep 1; printf -- '-\\n' >>"$ROOT/spans"; }` });

    expect(finished.run().status).toBe(0);
    const spans = readFileSync(join(finished.root, "spans"), "utf8").trimEnd().split("\n");
    const running = spans.reduce<number[]>((counts, span) => [...counts, (counts.at(-1) ?? 0) + (span === "+" ? 1 : -1)], []);
    expect(Math.max(...running)).toBe(3);
  });

  it("brings each pack's fix back onto the integration branch and its origin, trailed with every slice its pack holds", () => {
    const finished = finishing({ slices: packed, reviewer: `  ${ON_CODE} && grep -q 'src/zone.ts' "$PROMPT" && printf 'export const zoneFixed = 1;\\n' >>src/zone.ts && git commit --quiet -am "Inline the zone helper"` });

    expect(finished.run().status).toBe(0);
    expect(finished.log("--format=%(trailers:key=Slice,valueonly,separator=%x2C)", "-1", "--grep", "Inline the zone helper")).toBe("zone,clock");
    expect(finished.pushed()).toContain("Inline the zone helper");
    expect(finished.handed().some((prompt) => prompt.includes("End each message with the line"))).toBe(false);
  });

  it("hands a conflict back to the reviewer whose pack came back second, and lands what it resolved", () => {
    const finished = finishing({
      slices: packed,
      reviewer: [
        "  if grep -q 'would not rebase' \"$PROMPT\"; then git rebase --quiet spec/974 >/dev/null 2>&1; printf 'both\\n' >README.md; git add README.md; GIT_EDITOR=true git rebase --continue >/dev/null 2>&1",
        `  elif ${ON_CODE} && grep -q 'src/wide.ts' "$PROMPT"; then printf 'wide\\n' >README.md && git commit --quiet -am "Wide fix"`,
        `  elif ${ON_CODE}; then until git log --format=%s spec/974 | grep -q 'Wide fix'; do sleep 0.1; done; printf 'zone\\n' >README.md && git commit --quiet -am "Zone fix"; fi`,
      ].join("\n"),
    });

    expect(finished.run().status).toBe(0);
    const told = finished.handed().findIndex((prompt) => prompt.includes("would not rebase"));
    expect(finished.handed()[told]).toContain("README.md");
    const zone = zonePack(finished.handed());
    const resumed = finished.hired()[told] ?? [];
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe(`review-${zone + 1}`);
    expect(git(finished.session, "show", "spec/974:README.md")).toBe("both");
    expect(finished.log("--format=%s", "-3")).toContain("Zone fix");
  });

  it("hands a red full check to the first pack's reviewer alone, saying the red may sit in any slice", () => {
    const finished = finishing({ slices: sliced(2400), check: `[ -f ../checked ] && { printf 'check: ok\\n'; exit 0; }\ntouch ../checked\n${RED_CHECK}` });

    expect(finished.run().status).toBe(0);
    const reds = onCode(finished.handed()).filter((prompt) => prompt.includes("ZONE-TEST-BROKE"));
    expect(reds).toHaveLength(1);
    expect(reds[0]).toContain("may sit in any slice's code");
  });

  it("hands bin/land's refusal to the last pack's reviewer, in its own tree, saying it covers the whole branch", () => {
    const finished = finishing({ slices: packed, land: REFUSES_ONCE });

    expect(finished.run().status).toBe(0);
    const told = finished.handed().findIndex((prompt) => prompt.includes("covers the whole integration branch"));
    const resumed = finished.hired()[told] ?? [];
    const last = zonePack(finished.handed());
    expect(resumed[resumed.indexOf("--resume") + 1]).toBe(`review-${last + 1}`);
    expect(finished.wheres()[told]).toBe(finished.wheres()[last]);
    expect(finished.wheres()[told]).not.toBe(finished.wheres()[0]);
  });
  it("lands a pack reviewer's rebuild on origin/main as the integration branch whole, where the branch conflicts with main on migrations main took while it built, and keeps every reviewer's commits on origin (#1598)", () => {
    const MAIN_TOOK_MIGRATIONS = [
      "if ! git merge-base --is-ancestor main-took HEAD 2>/dev/null; then",
      '  [ -f ../main-moved ] || { touch ../main-moved; took=$(git commit-tree -p origin/main -m "Main took migrations" "$(git rev-parse "origin/main^{tree}")"); git update-ref refs/remotes/origin/main "$took"; git tag main-took "$took"; }',
      "  printf 'land: HEAD does not rebase cleanly onto origin/main, conflicting in drizzle/meta/_journal.json\\n' >&2; exit 1",
      "fi",
    ].join("\n");
    const finished = finishing({ slices: packed, land: MAIN_TOOK_MIGRATIONS, reviewer: `  grep -q 'rebuild it in this tree on' "$PROMPT" && git reset --quiet --hard origin/main && printf 'rebuilt\\n' >rebuilt.ts && git add -A && git commit --quiet -m "Rebuild spec on main"` });

    expect(finished.run().status).toBe(0);
    expect(finished.pushed().split("\n").slice(0, 2)).toEqual(["Rebuild spec on main", "Main took migrations"]);
    const kept = git(join(finished.root, "origin.git"), "for-each-ref", "--format=%(refname:short)", "refs/heads/review/");
    expect(kept.split("\n")).toEqual(["review/974-code-1", "review/974-code-2", "review/974-spec-1", "review/974-spec-2"]);
    expect(git(join(finished.root, "origin.git"), "log", "--format=%s", "-1", "review/974-code-2")).toMatch(/Rebuild spec on main|Review #974/);
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

  it("reviews, checks and lands nothing on a closed spec, as #2060's second finish ran a second done check after it closed", () => {
    const finished = finishing({ state: "CLOSED" });

    expect(finished.run()).toEqual({ status: 1, stdout: "finish: #974 is closed, so nothing was reviewed or landed\nlanded=\nmissed=\n", stderr: "" });
    expect(finished.handed()).toEqual([]);
    expect(finished.checked()).toEqual([]);
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
    const [postedOn = ""] = finished.tokenOf((args) => args[0] === "issue" && args[1] === "comment" && args[args.indexOf("--body") + 1]?.startsWith("## Done check") === true);
    expect(postedOn).toMatch(/^minted-\d+$/);
    expect(postedOn).not.toBe(landedOn);
  });
});

describe("every risk a spec's reviewer names ends somewhere, as a ticket's reviewer's does, where the spec's two reviewers never got #1491's filing", () => {
  const FIX = { fault: "A zone with no tenant falls back to UTC.", title: "Give a zone with no tenant the business's time zone", done: ["A zone with no tenant reads the business's time zone."] };
  const NEEDS_NOTHING = { risk: "The zone list loads before the map.", ends: "nothing", why: "Both render in the same frame." };

  it("keeps the fixes and risks a reviewer named before bin/land refused, though its answer after names none", () => {
    const finished = finishing({ land: REFUSES_ONCE, answer: { outcome: "approve", reason: "reason $CALL", fixes: [FIX], risks: [NEEDS_NOTHING] }, answerFrom: { call: 3, answer: { outcome: "approve", reason: "reason $CALL", fixes: [], risks: [] } } });

    expect(finished.run().status).toBe(0);
    expect(createdIssues(finished.calls()).map(({ title }) => title)).toEqual([FIX.title]);
    const [, afterRefusal = ""] = finished.approved();
    expect(afterRefusal).toContain("After `bin/land` refused it: reason 3");
    expect(afterRefusal).toContain(`- needs nothing: ${NEEDS_NOTHING.risk} ${NEEDS_NOTHING.why}`);
  });

  it("asks each reviewer for its risks, files each fix once in all though both name it, once the spec lands, and posts each risk with where it ends", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", fixes: [FIX], risks: [NEEDS_NOTHING] } });

    expect(finished.run().status).toBe(0);
    expect(schemaIn(finished.hired()[0] ?? []).required).toContain("risks");
    expect(finished.handed()[0]).toContain("sits in `fixes` or `risks`");
    const created = createdIssues(finished.calls());
    expect(created.map(({ title }) => title)).toEqual([FIX.title]);
    expect(fromOf(created[0]?.body ?? "")).toMatchObject({ number: "974", kind: "review" });
    expect(finished.calls()).toContainEqual(["api", "--method", "POST", "repos/collod873/claude-workflow/issues/974/sub_issues", "-F", "sub_issue_id=4242"]);
    const [approved = ""] = finished.approved();
    expect(approved).toContain(`- filed as the ticket "${FIX.title}" once it lands: ${FIX.fault}`);
    expect(approved).toContain(`- needs nothing: ${NEEDS_NOTHING.risk} ${NEEDS_NOTHING.why}`);
  });

});
