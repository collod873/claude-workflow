import { fromOf } from "./post.ts";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type Answered, finishing } from "./finish.part.ts";
import { bodyIn, createdIssues, git, heard, schemaIn, TAKEN_STEP } from "./scenarios.ts";
import { HELD as HELD_LABELS, OWNER } from "./spelled.ts";

const CLOSING = ["see the spec land on main", "see each slice's file on main"];
const HELD: Answered = { line: 1, outcome: "held", ran: "saw it on main" };
const LEAVES_SERVER = '  setsid sleep 300 </dev/null >/dev/null 2>&1 & printf \'%s\\n\' "$!" >"$ROOT/server-pid"';
const closingComments = (calls: string[][]) => calls.map(bodyIn).filter((body) => body.startsWith("## Done when"));
const FIXES_ZONE = '  [ "$CALL" = 1 ] && printf \'export const zone = 2;\\n\' >src/zone.ts';
const big = (name: string, lines: number) => Array.from({ length: lines }, (_, at) => `export const ${name}${at} = "${name} line ${at}";`).join("\n");
const RED_CHECK = "printf 'ZONE-TEST-BROKE\\n' >../red.log\nprintf 'check: red test; log %s\\n' \"$(cd .. && pwd)/red.log\"\nexit 1\n";
const REFUSAL = "land: the full check went red on the commit, so nothing was pushed; fix what it names and land again";
const REFUSES_ONCE = `[ -f ../refused ] || { touch ../refused; printf '%s\\n' '${REFUSAL}' >&2; exit 1; }`;
const ALWAYS_REFUSES = `printf '%s\\n' '${REFUSAL}' >&2\nexit 1`;

const SLICED = (slices: { id: string; title: string }[], landed?: string) =>
  `## Spec run\n\n<!-- progress: ${JSON.stringify({ landed, slices: slices.map(({ id, title }) => ({ id, title, why: `${title} is why ${id} was cut`, done: [`${id} shows on the branch`], blockedBy: [], state: "merged", tries: 1 })) })} -->`;

describe("bin/finish reviews a spec's integration branch with one reviewer, runs the full check, lands it once and closes it (ADR-0013)", () => {
  it("hires one reviewer over the whole branch, handed the spec and the diff and pointed at both standards, runs the full check on what it fixed, lands with bin/land --spec, and prints landed and missed last", () => {
    const finished = finishing({ reviewer: FIXES_ZONE, check: "git log -1 --format=%s >../checked-on\nprintf 'check: ok\\n'\n" });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    const [review = "", ...handedBack] = finished.handed();
    expect(handedBack).toEqual([]);
    expect(review).toContain("- [ ] see the spec land on main");
    expect(review).toContain("+export const zone = 1;");
    expect(review).toContain("`coding-standards`");
    expect(review).toContain("`testing`");
    expect(finished.checked()).toEqual(["--full --publish"]);
    expect(readFileSync(join(finished.root, "checked-on"), "utf8")).toBe("Review #974\n");
    const [[, head = "", ...named] = []] = finished.landed();
    expect(named).toEqual(["--spec", "974"]);
    expect(head).toBe(finished.log("-1", "--format=%H"));
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("hands the reviewer each slice's title, why and done from the progress comment, so it knows what each slice was cut to build", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }])] });

    expect(finished.run().status).toBe(0);
    const [review = ""] = finished.handed();
    expect(review).toContain("`tenant-time-zone`: Store each tenant's time zone");
    expect(review).toContain("Store each tenant's time zone is why tenant-time-zone was cut");
    expect(review).toContain("tenant-time-zone shows on the branch");
  });

  it("marks the spec checking before its reviewer is hired, so the issue stops showing slicing or building while finish reviews and lands it (#1663)", () => {
    const finished = finishing({ reviewer: '  [ "$CALL" = 1 ] && cp "$MACHINE_BIN/../marks" "$MACHINE_BIN/../marks-at-first-review"' });

    expect(finished.run().status).toBe(0);
    expect(readFileSync(join(finished.root, "marks-at-first-review"), "utf8")).toBe("974 checking\n");
  });

  it("comments the reviewer's reason on the spec's PR through bin/land's approve reason", () => {
    const finished = finishing();

    expect(finished.run().status).toBe(0);
    expect(finished.landed()).toHaveLength(1);
    expect(finished.approved()).toEqual(["reason 1"]);
  });

  it("stamps the spec's landing on its progress comment before it closes, so a run stopped after landing is found landed by its rerun", () => {
    const finished = finishing({ said: [SLICED([{ id: "tenant-time-zone", title: "Store each tenant's time zone" }])] });

    expect(finished.run().status).toBe(0);
    const bodies = finished.calls().map(bodyIn);
    const stamped = bodies.findIndex((body) => body.startsWith("## Spec run") && body.includes('"landed":"9974"'));
    expect(stamped).toBeGreaterThanOrEqual(0);
    expect(stamped).toBeLessThan(bodies.findIndex((body) => body.startsWith("## Done when")));
  });

  it("lists the newest commits when the commit list is over its cap, and says git log reads the rest", () => {
    const long = (id: string) => ({ id, files: { [`src/${id}.ts`]: `export const ${id} = 1;\n` }, message: `Build slice ${id}\n\n${"why it was built ".repeat(150)}` });
    const finished = finishing({ slices: [long("oldest"), long("middle"), long("newest")] });

    expect(finished.run().status).toBe(0);
    const [review = ""] = finished.handed();
    expect(review).toContain("Build slice newest");
    expect(review).not.toContain("Build slice oldest");
    expect(review).toContain("`git log origin/main..HEAD` reads any the list cuts");
  });
});

describe("bin/finish has its one reviewer run each closing line of the spec before it lands, and lands whatever they show (#1626, ADR-0006)", () => {
  const RECORDED = (lines: Answered[] | undefined) =>
    `## Spec run\n\n<!-- progress: ${JSON.stringify({ landed: "9974", slices: [{ id: "tenant-time-zone", title: "Store each tenant's time zone", why: "why", done: ["it holds"], blockedBy: [], state: "merged", tries: 1 }], lines })} -->`;
  const landedOnMain = (finished: ReturnType<typeof finishing>) =>
    git(finished.session, "update-ref", "refs/remotes/origin/main", git(finished.session, "commit-tree", "HEAD^{tree}", "-p", "origin/main", "-p", "HEAD", "-m", "Merge the spec"));

  it("hands the reviewer the spec's closing lines numbered, its user stories left out of them, and closes the landed spec with one comment listing each line and how it came out, where a second agent trying them took a median 14 minutes a spec and its misses a second fix round", () => {
    const finished = finishing({ closing: CLOSING, lines: [HELD, { line: 2, outcome: "fixed", ran: "the zone file was missing, so the build now writes it" }] });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    const [review = "", ...more] = finished.handed();
    expect(more).toEqual([]);
    expect(review).toContain(`1. ${CLOSING[0]}\n2. ${CLOSING[1]}`);
    expect(review).not.toContain("3. ");
    const [beforeLand = 0] = finished.ghCallsAtLand();
    expect(closingComments(finished.calls().slice(0, beforeLand))).toEqual([]);
    const [comment = "", ...others] = closingComments(finished.calls());
    expect(others).toEqual([]);
    expect(comment).toContain(`1. **Held**: ${CLOSING[0]}\n   saw it on main`);
    expect(comment).toContain(`2. **Fixed before it landed**: ${CLOSING[1]}\n   the zone file was missing, so the build now writes it`);
    expect(createdIssues(finished.calls())).toEqual([]);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
    expect(finished.marked()).toEqual(["974 checking"]);
  });

  it("lands a spec with a line its reviewer could not make true, files that line as a bug quoting what it ran once the spec has landed, and prints its number in missed", () => {
    const finished = finishing({ closing: CLOSING, lines: [HELD, { line: 2, outcome: "missed", ran: "ran the build and each save rolled back in src/zone.ts" }] });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    expect(finished.handed()).toHaveLength(1);
    expect(finished.landed()).toHaveLength(1);
    const [beforeLand = 0] = finished.ghCallsAtLand();
    expect(createdIssues(finished.calls().slice(0, beforeLand))).toEqual([]);
    const [bug, ...more] = createdIssues(finished.calls());
    expect(more).toEqual([]);
    expect(bug?.title).toBe(CLOSING[1]);
    expect(bug?.body).toContain("> ran the build and each save rolled back in src/zone.ts");
    expect(fromOf(bug?.body ?? "")).toMatchObject({ number: "974", kind: "review" });
    expect(closingComments(finished.calls())[0]).toContain(`2. **Did not hold**: ${CLOSING[1]}`);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("files nothing for a line nothing in its run could run, its closing comment alone saying what is missing (agent-hooks#83)", () => {
    const finished = finishing({ closing: CLOSING, lines: [HELD, { line: 2, outcome: "unrun", ran: "needs a text to a real phone" }] });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(createdIssues(finished.calls())).toEqual([]);
    expect(closingComments(finished.calls())[0]).toContain(`2. **Not run**: ${CLOSING[1]}\n   needs a text to a real phone`);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("hands an answer that skips a closing line back to the reviewer in its own session before anything lands, and keeps the lines it answered first", () => {
    const finished = finishing({
      closing: CLOSING,
      answer: { outcome: "approve", reason: "reason $CALL", lines: [HELD] },
      answerFrom: { call: 2, answer: { outcome: "approve", reason: "reason $CALL", lines: [{ line: 2, outcome: "held", ran: "listed src/zone.ts" }] } },
    });

    expect(finished.run().status).toBe(0);
    const [, handedBack = "", ...more] = finished.handed();
    expect(more).toEqual([]);
    expect(handedBack).toContain(`2. ${CLOSING[1]}`);
    expect(handedBack).not.toContain(`1. ${CLOSING[0]}`);
    expect(finished.hired()[1]).toEqual(expect.arrayContaining(["--resume", "review-1"]));
    expect(finished.checked()).toHaveLength(1);
    const [comment = ""] = closingComments(finished.calls());
    expect(comment).toContain(`1. **Held**: ${CLOSING[0]}\n   saw it on main`);
    expect(comment).toContain(`2. **Held**: ${CLOSING[1]}\n   listed src/zone.ts`);
  });

  it("gives the reviewer its own Postgres, port and temp dir when a step of its contract needs DATABASE_URL, sets its tree up against them, and removes the Postgres after, where Mezzanine#2023 lost all five sentences to a migration on the shared dev database", () => {
    const setupOn = '"$(git rev-parse --path-format=absolute --git-common-dir)/../../setup-on"';
    const finished = finishing({ contract: JSON.stringify({ setup: `printf '%s\\n' "$DATABASE_URL" >${setupOn}`, steps: { integration: { run: "true", needs: ["DATABASE_URL"] } } }) });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    const [[database, port = "", temp = ""] = []] = finished.isolation();
    expect(database).toBe("postgres://postgres:postgres@localhost:49153/postgres");
    expect(port).toMatch(/^\d+$/);
    expect(dirname(temp)).toBe(tmpdir());
    expect(basename(temp)).toMatch(/^slice-\w{6}$/);
    expect(readFileSync(join(finished.root, "setup-on"), "utf8").trim()).toBe(database);
    expect(finished.wheres()).toEqual([finished.session]);
    const dockered = finished.dockered();
    expect(dockered.some((call) => /^run .*postgres:16$/.test(call))).toBe(true);
    expect(dockered.at(-1)).toMatch(/^rm --force database-/);
  });

  it("stops every process the reviewer left running before the full check starts, where a done check's `next dev` held gigabytes for the rest of the spec's job", () => {
    const finished = finishing({ reviewer: LEAVES_SERVER, check: 'ps -o stat= -p "$(cat ../server-pid)" >../server-at-check\nprintf \'check: ok\\n\'\n' });
    onTestFinished(() => {
      const pid = finished.serverPid();
      if (pid > 1 && existsSync(`/proc/${pid}`)) process.kill(pid, "SIGKILL");
    });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(finished.serverPid()).toBeGreaterThan(1);
    expect(readFileSync(join(finished.root, "server-at-check"), "utf8").trim()).toMatch(/^Z?$/);
  });

  it("tells the reviewer each key the repo's secrets lack, so a line resting on one is answered unrun naming the key", () => {
    const finished = finishing({ unsetKeys: "TWILIO_AUTH_TOKEN,RESEND_API_KEY" });

    expect(finished.run().status).toBe(0);
    const [review = ""] = finished.handed();
    expect(review).toContain("`TWILIO_AUTH_TOKEN` and `RESEND_API_KEY`");
  });

  it("stamps on the progress comment each line as the reviewer last answered it, where a line it fixed after bin/land refused stayed recorded missed and a rerun filed a bug for it", () => {
    const finished = finishing({
      closing: CLOSING,
      land: REFUSES_ONCE,
      lines: [HELD, { line: 2, outcome: "missed", ran: "each save rolled back" }],
      answerFrom: { call: 2, answer: { outcome: "approve", reason: "reason $CALL", lines: [{ line: 2, outcome: "fixed", ran: "the save now commits" }] } },
    });

    expect(finished.run().status).toBe(0);
    const stamped = finished.calls().map(bodyIn).filter((body) => body.startsWith("## Spec run") && body.includes('"landed":"9974"')).at(-1) ?? "";
    expect(stamped).toContain('{"line":1,"outcome":"held"');
    expect(stamped).toContain('{"line":2,"outcome":"fixed"');
    expect(stamped).not.toContain('"outcome":"missed"');
  });

  it("resumes a reviewer that ran past its time to answer with what it reached, and lands the spec with each line it did not reach listed not run, where a finish out of time landed nothing and its rerun ended stuck", () => {
    const finished = finishing({
      closing: CLOSING,
      stageMinutes: "40",
      reviewer: `  [ "$CALL" = 1 ] && { printf '%s\\n' '${JSON.stringify({ type: "system", session_id: "review-1" })}'; exit 124; }`,
      lines: [HELD, { line: 2, outcome: "unrun", ran: "time ran out before it was run" }],
    });

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    const [review = "", told = "", ...more] = finished.handed();
    expect(more).toEqual([]);
    expect(review).toContain("+export const zone = 1;");
    expect(told).not.toContain("+export const zone = 1;");
    expect(finished.hired()[1]).toEqual(expect.arrayContaining(["--resume", "review-1"]));
    expect(finished.checked()).toEqual(["--full --publish"]);
    expect(finished.landed()).toHaveLength(1);
    expect(closingComments(finished.calls())[0]).toContain(`2. **Not run**: ${CLOSING[1]}\n   time ran out before it was run`);
  });

  it("closes a landed spec from the lines its progress comment recorded, hiring no one and reviewing nothing, when a rerun finds it landed", () => {
    const finished = finishing({ closing: CLOSING, said: [RECORDED([HELD, { line: 2, outcome: "missed", ran: "each save rolled back" }])] });
    landedOnMain(finished);

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed=2"]);
    expect(finished.handed()).toEqual([]);
    expect(finished.landed()).toEqual([]);
    expect(finished.marked()).toEqual(["974 checking"]);
    expect(closingComments(finished.calls())).toHaveLength(1);
    expect(createdIssues(finished.calls()).map(({ title }) => title)).toEqual([CLOSING[1]]);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("closes a landed spec whose progress comment recorded no line, each listed as not recorded, hiring no one and filing nothing, so a spec landed before the lines were recorded still closes on its rerun", () => {
    const finished = finishing({ closing: CLOSING, said: [RECORDED(undefined)] });
    landedOnMain(finished);

    const ran = heard(finished.run());

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.handed()).toEqual([]);
    expect(finished.landed()).toEqual([]);
    const [comment = ""] = closingComments(finished.calls());
    expect(comment).toContain(`1. **Not run**: ${CLOSING[0]}`);
    expect(comment).toContain(`2. **Not run**: ${CLOSING[1]}`);
    expect(createdIssues(finished.calls())).toEqual([]);
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([["issue", "close", "974", "--reason", "completed"]]);
  });

  it("marks the landed spec stuck and calls the owner with GitHub's refusal when its closing comment will not post, so the scheduler stands down on stuck rather than leave a landed spec that nothing wakes (ADR-0009)", () => {
    const finished = finishing({ gh: '  *"issue comment"*"## Done when"*) printf \'HTTP 422: Validation Failed\\n\' >&2; exit 1 ;;' });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.landed()).toHaveLength(1);
    expect(finished.marked()).toEqual(["974 checking", "974 stuck"]);
    const [called = "", ...more] = finished.calls().map(bodyIn).filter((body) => body.startsWith(`@${OWNER} `));
    expect(more).toEqual([]);
    expect(called).toContain("HTTP 422: Validation Failed");
    expect(finished.calls().filter((args) => args[1] === "close")).toEqual([]);
  });

  it("marks the landed spec stuck and tells the owner to close it by hand when its closing comment posted and the spec would not close, its miss filed once", () => {
    const finished = finishing({ closing: CLOSING, lines: [HELD, { line: 2, outcome: "missed", ran: "each save rolled back" }], gh: '  *"issue close"*) printf \'HTTP 403: Resource not accessible by integration\\n\' >&2; exit 1 ;;' });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines.slice(-2)).toEqual(["landed=9974", "missed="]);
    expect(finished.marked()).toEqual(["974 checking", "974 stuck"]);
    expect(closingComments(finished.calls())).toHaveLength(1);
    expect(createdIssues(finished.calls()).map(({ title }) => title)).toEqual([CLOSING[1]]);
    const [called = "", ...more] = finished.calls().map(bodyIn).filter((body) => body.startsWith(`@${OWNER} `));
    expect(more).toEqual([]);
    expect(called).toContain("close #974 by hand");
  });

  it("readies the reviewer's tree with the contract's setup before hiring it, where five specs' reviewers had no node_modules and could run nothing", () => {
    const setups = '"$(git rev-parse --path-format=absolute --git-common-dir)/../../setups"';
    const finished = finishing({ contract: JSON.stringify({ setup: `printf 'setup %s\\n' "$PWD" >>${setups}` }), reviewer: `  printf 'hire %s\\n' "$PWD" >>"$ROOT/setups"` });

    expect(finished.run().status).toBe(0);
    const order = readFileSync(join(finished.root, "setups"), "utf8").trimEnd().split("\n");
    expect(order.indexOf(`setup ${finished.session}`)).toBeGreaterThanOrEqual(0);
    expect(order.indexOf(`setup ${finished.session}`)).toBeLessThan(order.indexOf(`hire ${finished.session}`));
  });

  it("hires one reviewer and hands it the whole diff up to 200 KB, where a diff over 32 KB reached it as a stat and 22 of its sessions approved in under a minute", () => {
    const finished = finishing({ slices: [{ id: "wide", files: { "src/wide.ts": big("wide", 1500) } }] });

    expect(finished.run().status).toBe(0);
    const [review = "", ...more] = finished.handed();
    expect(more).toEqual([]);
    expect(review).toContain('+export const wide1499 = "wide line 1499";');
    expect(review).not.toContain("git diff --stat");
  });

  it("hires one reviewer in the integration branch's own tree for a diff over 200 KB too, handed its stat and every file changed in place of the diff, where splitting it by size put up to three reviewers on one spec", () => {
    const finished = finishing({ slices: [{ id: "wide", files: { "src/wide.ts": big("wide", 6000) } }, { id: "zone", files: { "src/zone.ts": big("zone", 1500) } }, { files: { "src/loose.ts": big("loose", 1000) } }] });

    expect(finished.run().status).toBe(0);
    const [review = "", ...more] = finished.handed();
    expect(more).toEqual([]);
    expect(finished.wheres()).toEqual([finished.session]);
    expect(review).toMatch(/src\/wide\.ts +\| 6000 \+/);
    for (const file of ["src/wide.ts", "src/zone.ts", "src/loose.ts"]) expect(review).toContain(`- ${file}`);
    expect(review).not.toContain('+export const wide5999 = "wide line 5999";');
    expect(finished.approved()).toEqual(["reason 1"]);
    expect(git(join(finished.root, "origin.git"), "for-each-ref", "--format=%(refname:short)", "refs/heads/")).toBe("spec/974");
  });
});

describe("bin/finish runs the full check once its reviewer answers and holds that reviewer until it is green (ADR-0012)", () => {
  const RED_FOR = (rounds: number) => `n=$(cat ../checks-run 2>/dev/null || echo 0); n=$((n + 1)); echo $n >../checks-run\nif [ $n -le ${rounds} ]; then\n${RED_CHECK}fi\nprintf 'check: ok\\n'\n`;

  it("hands a red back to the reviewer in its own session with the log it names, again while the re-run check stays red, and lands once it is green", () => {
    const finished = finishing({ check: RED_FOR(2), reviewer: '  [ "$CALL" = 2 ] && printf \'export const zone = 2;\\n\' >src/zone.ts' });

    expect(finished.run().status).toBe(0);
    const [review = "", ...reds] = finished.handed();
    expect(review).not.toContain("ZONE-TEST-BROKE");
    expect(reds).toHaveLength(2);
    for (const red of reds) expect(red).toContain("ZONE-TEST-BROKE");
    expect(finished.hired().map((argv) => argv[argv.indexOf("--resume") + 1])).toEqual([expect.not.stringMatching(/^review-/), "review-1", "review-2"]);
    expect(finished.checked()).toEqual(["--full --publish", "--full --publish", "--full --publish"]);
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
    expect(finished.marked()).toEqual(["974 checking", "974 stuck"]);
    expect(finished.calls().find((args) => args[1] === "comment")?.join(" ")).toContain("the machine is at fault, not the code");
    expect(finished.handed()).toHaveLength(1);
    expect(finished.landed()).toEqual([]);
  });

  it("marks the spec stuck when the check re-run after the reviewer's answer is red only on starved steps", () => {
    const finished = finishing({ check: `n=$(cat ../checks-run 2>/dev/null || echo 0); n=$((n + 1)); echo $n >../checks-run\nif [ $n -le 1 ]; then\n${MIXED}\nfi\n${STARVED}\n` });

    finished.run();

    expect(finished.marked()).toEqual(["974 checking", "974 stuck"]);
    expect(finished.handed()).toHaveLength(2);
    expect(finished.landed()).toEqual([]);
  });

  it("hands a red mixing a starved step with a real failure to the reviewer", () => {
    const finished = finishing({ check: MIXED });

    finished.run();

    expect(finished.marked()).toEqual(["974 checking"]);
    expect(finished.handed()[1]).toContain("test src/stops.test.ts:4");
  });
});

describe("bin/finish takes a reviewer's stuck and owner steps, as a ticket's review does (ADR-0005)", () => {
  const STEP = { title: "Add the Twilio key $CALL to Railway", why: "Storm alerts text through Twilio, which needs TWILIO_KEY set on the Railway service.", needs: "TWILIO_KEY", ...TAKEN_STEP };

  it("marks the spec stuck and calls the owner on a reviewer's stuck, landing nothing", () => {
    const finished = finishing({ answer: { outcome: "stuck", reason: "the runner has no docker, so no Postgres starts here" } });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines).toEqual(["landed=", "missed="]);
    expect(finished.marked()).toEqual(["974 checking", "974 stuck"]);
    expect(finished.calls().find((args) => args[1] === "comment")?.join(" ")).toContain("@collod873 a reviewer of #974 stopped and needs you: the runner has no docker, so no Postgres starts here");
    expect(finished.handed()).toHaveLength(1);
    expect(finished.landed()).toEqual([]);
  });

  it("keeps the reviewer's fix on the integration branch's origin though it answers stuck, so a rerun starts from it", () => {
    const finished = finishing({ reviewer: FIXES_ZONE, answer: { outcome: "stuck", reason: "the runner has no docker, so no Postgres starts here" } });

    expect(finished.run().status).toBe(1);
    expect(finished.pushed().split("\n")[0]).toBe("Review #974");
  });

  it("files the reviewer's owner steps once the spec lands, before it closes", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [STEP] } });

    expect(finished.run().status).toBe(0);
    const created = finished.calls().filter((args) => args[1] === "create");
    expect(created).toHaveLength(1);
    expect(created[0]).toEqual(expect.arrayContaining(["owner-step", "Add the Twilio key 1 to Railway"]));
    expect(created[0]?.join(" ")).toContain("Left to the owner by the run that landed spec #974.");
    const firstCreate = finished.calls().findIndex((args) => args[1] === "create");
    expect(firstCreate).toBeLessThan(finished.calls().findIndex((args) => args[1] === "close"));
  });

  const WHOLE = { ...STEP, title: "Add the Twilio key to Railway" };
  const UNHANDED = { ...WHOLE, handover: "" };
  const UNHANDED_REFUSAL = `"${WHOLE.title}": it makes a secret, but no last step says how to hand it over without pasting it into a chat`;

  it("hands the reviewer an owner step that filing would refuse back to its own session before bin/land, and files it once answered whole, never as a could-not-be-filed comment (#1623)", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [UNHANDED] }, answerFrom: { call: 2, answer: { outcome: "approve", reason: "reason $CALL", steps: [WHOLE] } } });

    expect(finished.run().status).toBe(0);
    const [, handedBack = "", ...more] = finished.handed();
    expect(handedBack).toContain(UNHANDED_REFUSAL);
    expect(more).toEqual([]);
    expect(finished.hired()[1]).toEqual(expect.arrayContaining(["--resume", "review-1"]));
    expect(finished.landed()).toHaveLength(1);
    const created = finished.calls().filter((args) => args[1] === "create");
    expect(created).toHaveLength(1);
    expect(created[0]?.join(" ")).toContain("3. In a terminal, run");
    expect(finished.calls().filter((args) => args[1] === "comment").join(" ")).not.toContain("could not be filed");
  });

  it("lands nothing when the reviewer answers the same refused owner step again, so a step it cannot fix stops the run rather than looping", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", steps: [UNHANDED] } });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(UNHANDED_REFUSAL);
    expect(finished.handed()).toHaveLength(2);
    expect(finished.landed()).toEqual([]);
  });
});

describe("bin/finish hands bin/land's refusal back to its reviewer, as a ticket's review does (ADR-0012)", () => {
  it("lands the reviewer's rebuild on origin/main as the integration branch whole, where the branch conflicts with main on migrations main took while it built (#1598)", () => {
    const MAIN_TOOK_MIGRATIONS = [
      "if ! git merge-base --is-ancestor main-took HEAD 2>/dev/null; then",
      '  [ -f ../main-moved ] || { touch ../main-moved; took=$(git commit-tree -p origin/main -m "Main took migrations" "$(git rev-parse "origin/main^{tree}")"); git update-ref refs/remotes/origin/main "$took"; git tag main-took "$took"; }',
      "  printf 'land: HEAD does not rebase cleanly onto origin/main, conflicting in drizzle/meta/_journal.json\\n' >&2; exit 1",
      "fi",
    ].join("\n");
    const finished = finishing({ land: MAIN_TOOK_MIGRATIONS, reviewer: `  [ "$CALL" = 2 ] && git reset --quiet --hard origin/main && printf 'rebuilt\\n' >rebuilt.ts && git add -A && git commit --quiet -m "Rebuild spec on main"` });

    expect(finished.run().status).toBe(0);
    expect(finished.pushed().split("\n").slice(0, 2)).toEqual(["Rebuild spec on main", "Main took migrations"]);
    expect(finished.landed()).toHaveLength(2);
  });

  it("resumes the reviewer with what bin/land said, lands what it fixed, and comments its new reason after the review it gave first", () => {
    const finished = finishing({ land: REFUSES_ONCE, reviewer: '  [ "$CALL" = 2 ] && printf \'export const zone = 3;\\n\' >src/zone.ts' });

    expect(finished.run().status).toBe(0);
    const second = finished.hired()[1] ?? [];
    expect(second[second.indexOf("--resume") + 1]).toBe("review-1");
    expect(finished.handed()[1]).toContain(REFUSAL);
    expect(finished.landed()).toHaveLength(2);
    expect(finished.approved()).toEqual(["reason 1", "reason 1\n\nAfter `bin/land` refused it: reason 2"]);
  });

  it("lands nothing more once the spec is marked paused while bin/land's refusal was fixed", () => {
    const finished = finishing({ land: REFUSES_ONCE, reviewer: '  [ "$CALL" = 2 ] && printf \'spec\\npaused\\n\' >../labels-at-land' });

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
  });
});

describe("bin/finish stands down on a held spec, so a pause holds the landing too", () => {
  it.each(HELD_LABELS)("hires, checks and lands nothing on a spec marked %s when it starts", (held) => {
    const finished = finishing({ labels: ["spec", held] });

    expect(finished.run()).toEqual({ status: 1, stdout: `finish: #974 is marked ${held}, so nothing was reviewed or landed\nlanded=\nmissed=\n`, stderr: "" });
    expect(finished.handed()).toEqual([]);
    expect(finished.checked()).toEqual([]);
    expect(finished.landed()).toEqual([]);
  });

  it.each(HELD_LABELS)("lands nothing once the spec is marked %s while its reviewer ran", (held) => {
    const finished = finishing({ labelsAtLand: ["spec", held] });

    const ran = heard(finished.run());

    expect(ran.status).toBe(1);
    expect(ran.lines).toEqual([`finish: #974 is marked ${held}, so its reviewed branch does not land`, "landed=", "missed="]);
    expect(finished.handed()).toHaveLength(1);
    expect(finished.landed()).toEqual([]);
  });

  it("reviews, checks and lands nothing on a closed spec, as #2060's second finish filed a duplicate bug after it closed", () => {
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
    expect(finished.marked()).toEqual([]);
  });

  it("refuses an issue that is not a spec, hiring nothing", () => {
    const finished = finishing({ labels: ["ticket"] });

    expect(finished.run()).toEqual({ status: 1, stdout: "landed=\nmissed=\n", stderr: "finish: #974 is not a spec, so nothing was reviewed or landed\n" });
    expect(finished.handed()).toEqual([]);
  });
});

describe("bin/finish acts on a fresh App token after each model run, since a spec's run outlives the job's first token (#1504)", () => {
  it("lands, and posts the closing comment, on tokens minted after the reviewer answered", () => {
    const finished = finishing({ appKeyed: true });

    expect(finished.run().status).toBe(0);
    const [[landedOn = ""] = []] = finished.landed();
    expect(landedOn).toMatch(/^minted-\d+$/);
    const [postedOn = ""] = finished.tokenOf((args) => args[0] === "issue" && args[1] === "comment" && bodyIn(args).startsWith("## Done when"));
    expect(postedOn).toMatch(/^minted-\d+$/);
    expect(postedOn).not.toBe(landedOn);
  });
});

describe("every risk a spec's reviewer names ends somewhere, as a ticket's reviewer's does, where the spec's reviewers never got #1491's filing", () => {
  const FIX = { fault: "A zone with no tenant falls back to UTC.", title: "Give a zone with no tenant the business's time zone", done: ["A zone with no tenant reads the business's time zone."] };
  const NEEDS_NOTHING = { risk: "The zone list loads before the map.", ends: "nothing", why: "Both render in the same frame." };

  it("keeps the fixes and risks a reviewer named before bin/land refused, though its answer after names none", () => {
    const finished = finishing({ land: REFUSES_ONCE, answer: { outcome: "approve", reason: "reason $CALL", fixes: [FIX], risks: [NEEDS_NOTHING] }, answerFrom: { call: 2, answer: { outcome: "approve", reason: "reason $CALL", fixes: [], risks: [] } } });

    expect(finished.run().status).toBe(0);
    expect(createdIssues(finished.calls()).map(({ title }) => title)).toEqual([FIX.title]);
    const [, afterRefusal = ""] = finished.approved();
    expect(afterRefusal).toContain("After `bin/land` refused it: reason 2");
    expect(afterRefusal).toContain(`- needs nothing: ${NEEDS_NOTHING.risk} ${NEEDS_NOTHING.why}`);
  });

  it("files every fix the landed comment promises, four across a refused landing though one answer holds at most three, where #1712's fourth was promised and dropped", () => {
    const named = (letter: string) => ({ ...FIX, title: `${FIX.title} ${letter}` });
    const finished = finishing({ land: REFUSES_ONCE, answer: { outcome: "approve", reason: "reason $CALL", fixes: ["A", "B", "C"].map(named), risks: [] }, answerFrom: { call: 2, answer: { outcome: "approve", reason: "reason $CALL", fixes: [named("D")], risks: [] } } });

    expect(finished.run().status).toBe(0);
    const titles = ["A", "B", "C", "D"].map((letter) => named(letter).title);
    expect(createdIssues(finished.calls()).map(({ title }) => title)).toEqual(titles);
    const promised = [...(finished.approved().at(-1) ?? "").matchAll(/filed as the ticket "([^"]+)"/g)].map(([, title]) => title);
    expect(promised).toEqual(titles);
  });

  it("asks the reviewer for its risks, files each fix once the spec lands, and posts each risk with where it ends", () => {
    const finished = finishing({ answer: { outcome: "approve", reason: "reason $CALL", fixes: [FIX], risks: [NEEDS_NOTHING] } });

    expect(finished.run().status).toBe(0);
    expect(schemaIn(finished.hired()[0] ?? []).required).toContain("risks");
    const created = createdIssues(finished.calls());
    expect(created.map(({ title }) => title)).toEqual([FIX.title]);
    expect(fromOf(created[0]?.body ?? "")).toMatchObject({ number: "974", kind: "review" });
    expect(finished.calls()).toContainEqual(["api", "--method", "POST", "repos/collod873/claude-workflow/issues/974/sub_issues", "-F", "sub_issue_id=4242"]);
    const [approved = ""] = finished.approved();
    expect(approved).toContain(`- filed as the ticket "${FIX.title}" once it lands: ${FIX.fault}`);
    expect(approved).toContain(`- needs nothing: ${NEEDS_NOTHING.risk} ${NEEDS_NOTHING.why}`);
  });
});
