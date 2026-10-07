import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { execute, heard, holds, plant, type Said, scratch, script, starts, wellFormedSpec, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { HELD, MACHINE, OWNER, STUCK } from "./spelled.ts";
import { DONE_CHECK_POSTED, doneChecking, specWith } from "./done-checker.part.ts";
import { missedIn } from "./done-checker.ts";

const READ_COMMENTS = "api --paginate repos/{owner}/{repo}/issues/974/comments";
const SENTENCES = ["file a spec and see its first wave show up under it", "open any ticket it filed and see my own words copied over", "see the spec close itself once every sentence held"];

const expectNothingDone = (checked: ReturnType<typeof doneChecking>) => {
  expect(checked.hired()).toEqual([]);
  expect(checked.comments()).toEqual([]);
  expect(checked.closes()).toEqual([]);
};

const expectMarkedNeedsHuman = (checked: ReturnType<typeof doneChecking>) => {
  expect(checked.labelled()).toEqual([]);
  expect(checked.marked()).toEqual(["974 checking", "974 stuck"]);
};

describe("bin/done-check tries a spec's sentences and closes it only when every one held (#1023)", () => {
  it("posts one comment headed ## Done check, each sentence with how it came out and what was done to try it, then closes the spec", () => {
    const tries = SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: `read run ${at + 1} with gh` }));
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.calls()).toEqual(["issue view 974", READ_COMMENTS, "issue comment 974", "issue close 974"]);
    const [comment = ""] = checked.comments();
    expect(comment.split("\n")[0]).toBe("## Done check");
    SENTENCES.forEach((sentence, at) => {
      expect(comment).toContain(`${at + 1}. **Held**: ${sentence}`);
      expect(comment).toContain(`read run ${at + 1} with gh`);
    });
    expect(checked.handed()).toContain(SENTENCES[1]);
    expect(checked.hired()[checked.hired().indexOf("--model") + 1]).toBe("opus");
  });
});

describe("bin/done-check leaves the spec open unless every sentence held (#1023)", () => {
  it("posts the check and leaves the spec open when one sentence did not hold", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome: "missed", tried: "opened a ticket it filed" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, so bin/slice --fix filed its one fix wave: ${DONE_CHECK_POSTED}`] });
    expect(checked.calls()).toEqual(["issue view 974", READ_COMMENTS, "issue comment 974"]);
    expect(checked.comments()[0]).toContain(`2. **Did not hold**: ${SENTENCES[1]}\n   opened a ticket it filed`);
    expect(checked.closes()).toEqual([]);
  });
});

describe("bin/done-check closes the spec when every sentence held or was put to the owner, saying what the owner could try (#1213)", () => {
  it("closes the spec, its comment listing what the owner could try for each sentence put to the owner, and marks no asked", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome: "owner", tried: "open a ticket it filed on your phone" },
      { sentence: 3, outcome: "owner", tried: "watch the next red run re-run" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence it could try, put the rest to the owner, and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.calls()).toEqual(["issue view 974", READ_COMMENTS, "issue comment 974", "issue close 974"]);
    const [comment = ""] = checked.comments();
    expect(comment).toContain(`2. **Put to the owner**: ${SENTENCES[1]}\n   open a ticket it filed on your phone`);
    expect(comment).toContain(`3. **Put to the owner**: ${SENTENCES[2]}\n   watch the next red run re-run`);
    expect(comment).toContain("Closed with sentence 2, 3 put to the owner: each says what the owner could try, and a miss seen live is filed as a new ticket.");
    expect(checked.marked()).toEqual(["974 checking"]);
  });
});

describe("bin/done-check posts nothing it did not try (#1023)", () => {
  it("ends red with no comment and the spec open when the model gives no try for a sentence", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
      { sentence: 3, outcome: "missed", tried: "a second answer for the same sentence" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 ended red, the done checker gave no try for sentence 2\n" });
    expect(checked.calls()).toEqual(["issue view 974", READ_COMMENTS]);
  });
});

describe("bin/done-check runs a sentence's own check command itself (#1023)", () => {
  const checked = (command: string) => `${SENTENCES[0]} – check: \`${command}\``;

  it("spends no model when every sentence carries a command, and holds each on its command's exit", () => {
    const passing = doneChecking({ body: specWith([checked("true"), checked("test -d .git")]), tries: [] });
    const failing = doneChecking({ body: specWith([checked("true"), checked("exit 3")]), tries: [] });

    expect(passing.run().status).toBe(0);
    expect(passing.hired()).toEqual([]);
    expect(passing.comments()[0]).toContain(`1. **Held**: ${SENTENCES[0]}\n   Ran \`true\`, which exited 0.`);
    expect(passing.closes()).toHaveLength(1);
    expect(failing.run().status).toBe(0);
    expect(failing.hired()).toEqual([]);
    expect(failing.comments()[0]).toContain(`2. **Did not hold**: ${SENTENCES[0]}\n   Ran \`exit 3\`, which exited 3.`);
    expect(failing.closes()).toEqual([]);
  });

  it("hands the model only the sentences with no command, by their number in the spec", () => {
    const mixed = doneChecking({ body: specWith([checked("true"), SENTENCES[1] ?? ""]), tries: [{ sentence: 2, outcome: "held", tried: "opened a ticket it filed" }] });

    expect(mixed.run().status).toBe(0);
    expect(mixed.handed()).toContain("Sentence 1 carries a check command the machine ran itself; give no try for it.");
    expect(mixed.comments()[0]).toContain(`2. **Held**: ${SENTENCES[1]}\n   opened a ticket it filed`);
    expect(mixed.closes()).toHaveLength(1);
  });
});

describe("bin/done-check refuses before spending a model (#1023)", () => {
  it("refuses an issue not labelled spec, and a spec with no sentence to try, trying nothing and posting nothing", () => {
    const ticket = doneChecking({ labels: ["ticket"] });
    const empty = doneChecking({ body: specWith([]) });

    expect(ticket.run()).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 is not a spec, so nothing was tried\n" });
    expect(ticket.calls()).toEqual(["issue view 974"]);
    expect(ticket.hired()).toEqual([]);
    expect(empty.run()).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 carries no sentence to try, so nothing was tried or closed\n" });
    expect(empty.calls()).toEqual(["issue view 974"]);
    expect(empty.hired()).toEqual([]);
  });
});

describe("bin/done-check --wave tries only the sentences a wave should have moved, and closes nothing (#1038)", () => {
  it("tries only the named sentences, skips the ones only the owner can try, and posts one comment headed ## Wave check", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 3, outcome: "owner", tried: "only the owner sees it close on his phone" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run("974", "--wave", "1,3"))).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 wave check held every sentence it tried, and closes nothing: ${DONE_CHECK_POSTED}`] });
    expect(checked.closes()).toEqual([]);
    expect(checked.comments()).toHaveLength(1);
    const [comment = ""] = checked.comments();
    expect(comment.split("\n")[0]).toBe("## Wave check");
    expect(comment).toContain(`- Sentence 1, **Held**: ${SENTENCES[0]}\n  saw the first wave under it`);
    expect(comment).toContain(`- Sentence 3, **Waits for the end**: ${SENTENCES[2]}`);
    expect(comment).not.toContain(SENTENCES[1]);
    expect(checked.handed()).toContain("try only sentences 1, 3");
    expect(checked.sliced()).toEqual([]);
  });

  it("says which sentence missed and leaves the spec open and unlabelled when it missed for the first time", () => {
    const tries = [{ sentence: 2, outcome: "missed", tried: "opened a ticket and found no Out of Scope" }];
    const checked = doneChecking({ body: specWith(SENTENCES), tries, said: ["## Wave check\n\n- Sentence 1, **Did not hold**: an earlier miss"] });

    expect(heard(checked.run("974", "--wave", "2"))).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 wave check missed sentence 2, and closes nothing: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()[0]).toContain(`- Sentence 2, **Did not hold**: ${SENTENCES[1]}\n  opened a ticket and found no Out of Scope`);
    expect(checked.labelled()).toEqual([]);
    expect(checked.closes()).toEqual([]);
    expect(checked.sliced()).toEqual([]);
  });

  it("marks the spec stuck, saying which sentence and why, when a sentence that missed at the last wave check misses again", () => {
    const tries = [{ sentence: 2, outcome: "missed", tried: "opened a ticket and found no Out of Scope" }];
    const said = ["## Wave check\n\n- Sentence 2, **Did not hold**: the first miss", "## Wave 3\n\nThe fix ticket merged.", "## Wave check\n\n- Sentence 2, **Held**: an older hold"].reverse();
    const checked = doneChecking({ body: specWith(SENTENCES), tries, said });

    expect(checked.run("974", "--wave", "2")).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked stuck, sentence 2 missed at two wave checks in a row: ${DONE_CHECK_POSTED}\n` });
    expect(checked.comments()).toHaveLength(1);
    expect(checked.comments()[0]).toContain(`Sentence 2 missed at this wave check and the last one, so the spec is marked \`stuck\`: ${SENTENCES[1]}. Why: opened a ticket and found no Out of Scope`);
    expectMarkedNeedsHuman(checked);
    expect(checked.closes()).toEqual([]);
  });

  it("refuses a sentence number the spec does not carry, trying nothing", () => {
    const checked = doneChecking({ body: specWith(SENTENCES) });

    expect(checked.run("974", "--wave", "2,7")).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 carries no sentence 7, so nothing was tried\n" });
    expect(checked.hired()).toEqual([]);
    expect(checked.comments()).toEqual([]);
  });
});

describe("bin/done-check spends the spec's one fix wave on a first miss, and calls the owner on a second (#1038)", () => {
  const missing = [
    { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
    { sentence: 2, outcome: "missed", tried: "opened a ticket and found no Out of Scope" },
    { sentence: 3, outcome: "missed", tried: "saw the spec stay open" },
  ];

  it("runs bin/slice --fix once for the sentences that missed, and records it on the ## Done check comment", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Wave check\n\n- Sentence 1, **Did not hold**: a wave miss on a sentence that held since spends no fix wave"] });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, 3, so bin/slice --fix filed its one fix wave: ${DONE_CHECK_POSTED}`] });
    expect(checked.sliced()).toEqual(["974 --fix 2,3"]);
    expect(checked.comments()).toHaveLength(1);
    expect(checked.comments()[0]).toMatch(/^## Done check\n/);
    expect(checked.comments()[0]).toContain("<!-- fix-wave -->");
    expect(checked.closes()).toEqual([]);
    expect(checked.labelled()).toEqual([]);
  });

  it("marks the spec stuck, saying which sentence failed and why, when a sentence misses after the fix wave was spent", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Done check\n\n2. **Did not hold**: the first miss\n\n<!-- fix-wave -->"] });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked stuck, sentence 2, 3 missed again after the fix wave: ${DONE_CHECK_POSTED}\n` });
    expect(checked.sliced()).toEqual([]);
    expect(checked.comments()).toHaveLength(1);
    expect(checked.comments()[0]).not.toContain("<!-- fix-wave -->");
    expect(checked.comments()[0]).toContain(`Sentence 2 missed again after the fix wave, so the spec is marked \`stuck\`: ${SENTENCES[1]}. Why: opened a ticket and found no Out of Scope`);
    expect(checked.comments()[0]).toContain(`Sentence 3 missed again after the fix wave, so the spec is marked \`stuck\`: ${SENTENCES[2]}. Why: saw the spec stay open`);
    expectMarkedNeedsHuman(checked);
    expect(checked.closes()).toEqual([]);
  });

  it("spends the fix wave when the last done check only quoted the fix wave marker in its evidence (#1161)", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Done check\n\n1. **Put to the owner**: one\n   found '<!-- fix-wave -->' spelled only in src/done-checker.ts\n"] });

    expect(checked.run().status).toBe(0);
    expect(checked.sliced()).toEqual(["974 --fix 2,3"]);
  });

  it("marks the spec stuck, spending no fix wave, when a sentence that missed at the last wave check misses again at the end", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Wave check\n\n- Sentence 3, **Did not hold**: the wave's miss"] });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked stuck, sentence 3 missed at the last wave check and again at the end: ${DONE_CHECK_POSTED}\n` });
    expect(checked.sliced()).toEqual([]);
    expect(checked.comments()[0]).toContain(`Sentence 3 missed at the last wave check and again at the end, so the spec is marked \`stuck\`: ${SENTENCES[2]}. Why: saw the spec stay open`);
    expect(checked.comments()[0]).not.toContain("<!-- fix-wave -->");
    expectMarkedNeedsHuman(checked);
  });

  it("reads a wave check from before the last done check as no miss in a row", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Wave check\n\n- Sentence 3, **Did not hold**: an old miss", "## Done check\n\n3. **Put to the owner**: three"] });

    expect(checked.run().status).toBe(0);
    expect(checked.sliced()).toEqual(["974 --fix 2,3"]);
  });

  it("records no fix wave and ends red when bin/slice --fix files none, so the next done check can still spend it", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, slice: "printf 'slice: usage: slice <issue number>\\n' >&2\nexit 2\n" });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 did not hold sentence 2, 3, and bin/slice --fix filed no fix wave: "slice: usage: slice <issue number>": ${DONE_CHECK_POSTED}\n` });
    expect(checked.sliced()).toEqual(["974 --fix 2,3"]);
    expect(checked.comments()[0]).not.toContain("<!-- fix-wave -->");
  });

  it("spends no fix wave on a sentence only put to the owner", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing.map((one) => ({ ...one, outcome: one.outcome === "missed" ? "owner" : one.outcome })) });

    expect(checked.run().status).toBe(0);
    expect(checked.sliced()).toEqual([]);
    expect(checked.comments()[0]).not.toContain("<!-- fix-wave -->");
  });
});

describe("bin/done-check reads the owner's reply to a sentence it put to him (#1038)", () => {
  it("hands the model the comments since the last ## Done check, and none from before it", () => {
    const said: Said[] = [
      { author: OWNER, type: "User", body: "an old aside from before the check" },
      `## Done check\n\n3. **Put to the owner**: ${SENTENCES[2]}\n   open it on your phone`,
      "## Wave 3\n\nthe machine's own note",
      { author: OWNER, type: "User", body: "sentence 3 held on my phone" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries: SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: "the owner said so" })), said });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).toContain("## The owner's replies since the last done check\n\nsentence 3 held on my phone");
    expect(checked.handed()).not.toContain("an old aside");
    expect(checked.handed()).not.toContain("the machine's own note");
    expect(checked.closes()).toHaveLength(1);
  });

  it("hands no replies when no done check ran before", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: "saw it" })), said: [{ author: OWNER, type: "User", body: "an aside" }] });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).not.toContain("## The owner's replies");
  });
});

describe("done-check.yml runs the done check again on the owner's reply to a sentence it put to him (#1038)", () => {
  type Job = { if?: string; needs?: string; strategy?: { matrix: Record<string, string> }; steps: WorkflowStep[] };
  function workflow(): { on: object; asked: Job; check: Job } {
    const { on, jobs } = parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "done-check.yml"), "utf8")) as { on: object; jobs: Record<string, Job> };
    const { asked, check } = jobs;
    if (asked === undefined || check === undefined) throw new Error("done-check.yml carries no asked and check jobs");
    return { on, asked, check };
  }

  function lastAsked(comments: string[]): string | undefined {
    const checked = doneChecking({ said: comments });
    const ran = checked.run("974", "--asked");
    if (ran.status !== 0) throw new Error(ran.stderr);
    expect(ran.stderr).toBe("");
    expect(checked.calls()).toEqual([READ_COMMENTS]);
    expect(checked.marked()).toEqual([]);
    return ran.stdout.match(/^(true|false)\n$/)?.[1];
  }

  it("starts on the owner's comment on a spec, and on no one else's", async () => {
    const { on } = workflow();
    const asks = (labels: string[], sender = OWNER) => starts("done-check.yml", "asked", { labels, sender, action: "created" });

    expect(on).toEqual({ issue_comment: { types: ["created"] }, push: { branches: ["main"] } });
    expect(await asks(["spec"])).toBe(true);
    expect(await asks(["spec"], MACHINE)).toBe(false);
    expect(await asks(["spec"], "stranger")).toBe(false);
    expect(await asks(["ticket"])).toBe(false);
  });

  it("does not start on the owner's comment once the last done check put a sentence to him and called stuck (#1043)", async () => {
    const calledOwner = `## Done check\n\n1. **Did not hold**: one\n   saw it fail\n2. **Put to the owner**: two\n   open it on your phone\n\nSentence 1 missed again after the fix wave, so the spec is marked \`${STUCK}\`: one. Why: saw it fail\n`;

    expect(lastAsked([calledOwner, "an aside"])).toBe("true");
    for (const held of HELD) expect(await starts("done-check.yml", "asked", { labels: ["spec", held], sender: OWNER, action: "created" }), held).toBe(false);
  });

  it("runs bin/done-check on the spec only when the last ## Done check put a sentence to the owner", () => {
    const putToOwner = "## Done check\n\n1. **Held**: one\n   saw it\n2. **Put to the owner**: two\n   open it on your phone\n";
    const allTried = "## Done check\n\n1. **Held**: one\n   saw it\n2. **Did not hold**: two\n   saw it fail\n\n<!-- fix-wave -->\n";

    expect(lastAsked([putToOwner, "an aside"])).toBe("true");
    expect(lastAsked([putToOwner, allTried, "an aside"])).toBe("false");
    expect(lastAsked([`${putToOwner}\n<!-- fix-wave -->\n`, "an aside"])).toBe("false");
    expect(lastAsked([`${putToOwner}   found '<!-- fix-wave -->' spelled only in src/done-checker.ts\n`, "an aside"])).toBe("true");
    expect(lastAsked(["## Wave check\n\n- Sentence 2, **Waits for the end**: two"])).toBe("false");
    expect(lastAsked([`${putToOwner}\nClosed with sentence 2 put to the owner: each says what the owner could try, and a miss seen live is filed as a new ticket.\n`, "an aside"])).toBe("false");
    expect(lastAsked([])).toBe("false");
    const { asked, check } = workflow();
    const reading = asked.steps.find((one) => one.id === "asked")?.run ?? "";
    expect(reading).toContain("bin/done-check ${{ github.event.issue.number }} --asked");
    for (const spelling of ["## Done check", "fix-wave", "Put to the owner", "$SPEC", "|"]) expect(reading, spelling).not.toContain(spelling);
    expect(check.needs).toBe("asked");
    expect(holds(check.if ?? "", { needs: { asked: { result: "success", outputs: { asked: "true" } } } })).toBe(true);
    expect(holds(check.if ?? "", { needs: { asked: { result: "success", outputs: { asked: "false", marked: "" } } } })).toBe(false);
    expect(check.strategy?.matrix.spec).toBe("${{ fromJSON(needs.asked.outputs.asked == 'true' && format('[{0}]', github.event.issue.number) || needs.asked.outputs.marked) }}");
    const checked = check.steps.find((step) => step.run?.includes("bin/done-check"));
    expect(checked?.run).toContain("bin/done-check ${{ matrix.spec }}");
    expect(checked?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
  });
});

describe("done-check.yml tries again, on a push to main, each open spec the old rule left marked asked (#1213)", () => {
  type Job = { if?: string; strategy?: { matrix: Record<string, string> }; steps: WorkflowStep[] };
  const { asked, check } = workflowJobs("done-check.yml") as Record<string, Job>;
  const marking = asked?.steps.find((step) => step.id === "marked");

  it("starts the asked job on a push to main whoever pushed, and lists the specs only on a push", () => {
    expect(holds(asked?.if ?? "", { event: "push", sender: MACHINE })).toBe(true);
    expect(holds(marking?.if ?? "", { event: "push" })).toBe(true);
    expect(holds(marking?.if ?? "", { event: "issue_comment" })).toBe(false);
  });

  it("lists the open issues labelled spec and asked, by the labels spelled names", () => {
    const root = scratch("marked-");
    const called = join(root, "called");
    script(join(root, "stub", "gh"), `printf '%s\\n' "$*" >"${called}"\nprintf '[1164]\\n'\n`);
    const output = join(root, "output");
    const ran = spawnSync("bash", ["-e", "-c", marking?.run ?? ""], { cwd: join(import.meta.dirname, ".."), env: { ...process.env, PATH: `${join(root, "stub")}:${process.env.PATH}`, GITHUB_OUTPUT: output }, encoding: "utf8" });

    expect(ran.status, ran.stderr).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("marked=[1164]\n");
    expect(readFileSync(called, "utf8")).toContain("issue list --state open --label spec --label asked");
  });

  it("checks each listed spec in a run of its own, and none when the list is empty", () => {
    const listed = (marked: string) => holds(check?.if ?? "", { event: "push", needs: { asked: { result: "success", outputs: { marked } } } });

    expect(listed("[1164]")).toBe(true);
    expect(listed("[]")).toBe(false);
    expect(listed("")).toBe(false);
    expect(check?.steps.find((step) => step.id === "done-check")?.run).toContain("bin/done-check ${{ matrix.spec }}");
  });
});

describe("bin/done-check --asked answers whether the last ## Done check put a sentence to the owner, through the read-or-stop (#1118)", () => {
  it("ends red at unread, printing nothing and marking nothing, when the spec's comments cannot be read", () => {
    const checked = doneChecking({ gh: "[[ $1 == api ]] && { printf 'HTTP 401: Bad credentials\\n' >&2; exit 1; }" });

    expect(checked.run("974", "--asked")).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 could not read its comments, so nothing was asked\n" });
    expect(checked.calls()).toEqual([READ_COMMENTS]);
    expect(checked.marked()).toEqual([]);
  });

  it("ends red at unread naming the comments read, marking nothing and hiring no model, when a check cannot read the spec's comments (#1123)", () => {
    const checked = doneChecking({ gh: "[[ $1 == api ]] && { printf 'HTTP 401: Bad credentials\\n' >&2; exit 1; }" });

    expect(checked.run("974")).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 could not read its comments, so nothing was tried\n" });
    expect(checked.marked()).toEqual([]);
  });

  it("refuses --asked beside anything else, naming its usage", () => {
    for (const args of [["974", "--asked", "1"], ["--asked"], ["974", "--wave", "1", "--asked"]]) {
      expect(doneChecking().run(...args), args.join(" ")).toEqual({ status: 2, stdout: "", stderr: "done-check: usage: done-check <issue number> [--wave <sentence numbers> | --asked]\n" });
    }
  });
});

describe("bin/done-check settles a sentence about its own close by what this run does (#1049)", () => {
  const selfTries = (second: string) => [
    { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
    { sentence: 2, outcome: second, tried: "opened a ticket it filed" },
    { sentence: 3, outcome: "self", tried: "this run closes it" },
  ];

  it("posts the self sentence as held and closes the spec when every other sentence held", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("held") });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run closed the spec, since every other sentence held.`);
    expect(checked.closes()).toHaveLength(1);
    expect(checked.handed()).toContain("`self`");
  });

  it("posts the self sentence as held and files the fix wave on the other sentence's miss alone", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("missed") });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, so bin/slice --fix filed its one fix wave: ${DONE_CHECK_POSTED}`] });
    expect(checked.sliced()).toEqual(["974 --fix 2"]);
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run names each other sentence that did not hold, and why.`);
    expect(checked.closes()).toEqual([]);
    expect(checked.labelled()).toEqual([]);
  });

  it("stops on the other sentence's miss alone after the fix wave, never naming the self sentence", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("missed"), said: ["## Done check\n\n2. **Did not hold**: the first miss\n\n<!-- fix-wave -->"] });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked stuck, sentence 2 missed again after the fix wave: ${DONE_CHECK_POSTED}\n` });
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run names each other sentence that did not hold, and why.`);
    expect(checked.comments()[0]).not.toContain("Sentence 3 missed");
  });

  it("posts the self sentence as held and closes the spec when another was put to the owner (#1213)", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("owner") });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence it could try, put the rest to the owner, and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run closed the spec, since every other sentence held or was put to the owner.`);
    expect(checked.closes()).toHaveLength(1);
  });

  it("posts a self sentence at a wave check as waiting for the end, which the next re-slice reads as no miss", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: [{ sentence: 3, outcome: "self", tried: "this run closes it" }] });

    expect(heard(checked.run("974", "--wave", "3"))).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 wave check held every sentence it tried, and closes nothing: ${DONE_CHECK_POSTED}`] });
    const [comment = ""] = checked.comments();
    expect(comment).toContain(`- Sentence 3, **Waits for the end**: ${SENTENCES[2]}\n`);
    expect(comment).not.toContain("this run closes it");
    expect(missedIn(comment)).toEqual(new Set());
  });
});

describe("bin/done-check marks the spec checking while it runs (#1064)", () => {
  it("marks checking at the start of the done check and of a wave check", () => {
    const whole = doneChecking();
    const wave = doneChecking({ body: specWith(SENTENCES), tries: [{ sentence: 1, outcome: "held", tried: "saw it" }] });

    expect(whole.run().status).toBe(0);
    expect(whole.marked()).toEqual(["974 checking"]);
    expect(wave.run("974", "--wave", "1").status).toBe(0);
    expect(wave.marked()).toEqual(["974 checking"]);
  });

  it("marks nothing on an issue that is not a spec, or on a spec marked paused or stuck", () => {
    const ticket = doneChecking({ labels: ["ticket"] });

    expect(ticket.run().status).not.toBe(0);
    expect(ticket.marked()).toEqual([]);
    for (const held of HELD) {
      const stopped = doneChecking({ labels: ["spec", held] });
      expect(stopped.run().status, held).toBe(0);
      expect(stopped.marked(), held).toEqual([]);
      expect(stopped.hired(), held).toEqual([]);
    }
  });
});

describe("bin/done-check --wave gives a sentence nothing on main could show yet as not tried yet, and never as a miss (#1082)", () => {
  const unexercised = { sentence: 2, outcome: "unexercised", tried: "a spec would have to be filed after the ticket label exists" };

  it("lists it as not tried yet with what would have to happen for it to be seen, counting no miss", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: [unexercised] });

    expect(checked.run("974", "--wave", "2").status).toBe(0);
    const [comment = ""] = checked.comments();
    expect(comment).toContain(`- Sentence 2, **Not tried yet**: ${SENTENCES[1]}\n  a spec would have to be filed after the ticket label exists`);
    expect(missedIn(comment)).toEqual(new Set());
    expect(checked.handed()).toContain("`unexercised`");
    expect(checked.hired()[checked.hired().indexOf("--json-schema") + 1]).toContain("unexercised");
  });

  it.each([
    ["not tried yet at the last wave check and again now", "Not tried yet", unexercised],
    ["missed at the last wave check and not tried yet now", "Did not hold", unexercised],
    ["not tried yet at the last wave check and missed now", "Not tried yet", { ...unexercised, outcome: "missed" }],
  ])("marks the spec nothing when a sentence was %s", (_, before, now) => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: [now], said: [`## Wave check\n\n- Sentence 2, **${before}**: ${SENTENCES[1]}`] });

    expect(checked.run("974", "--wave", "2").status).toBe(0);
    expect(checked.labelled()).toEqual([]);
  });

  it("tries again a sentence the last wave check gave not tried yet, beside the ones this wave moved", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome: "held", tried: "opened a ticket filed since" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries, said: [`## Wave check\n\n- Sentence 2, **Not tried yet**: ${SENTENCES[1]}\n  a ticket would have to be filed`] });

    expect(checked.run("974", "--wave", "1").status).toBe(0);
    expect(checked.handed()).toContain("try only sentences 1, 2");
    expect(checked.comments()[0]).toContain(`- Sentence 2, **Held**: ${SENTENCES[1]}`);
  });
});

describe("bin/done-check's final check may not give a sentence not tried yet (#1082)", () => {
  it("offers no unexercised, and ends red naming the sentence without posting or closing when one is given anyway", () => {
    const tries = SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: at === 1 ? "unexercised" : "held", tried: "saw it" }));
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 ended red, the done checker gave sentence 2 as not tried yet, which only a wave check may give\n" });
    expect(checked.hired()[checked.hired().indexOf("--json-schema") + 1]).not.toContain("unexercised");
    expect(checked.handed()).not.toContain("`unexercised`");
    expect(checked.comments()).toEqual([]);
    expect(checked.closes()).toEqual([]);
    expect(checked.sliced()).toEqual([]);
  });
});

describe("bin/done-check stops at a mark GitHub refused, so it tries, posts and closes nothing on a spec whose labels lag (#1107)", () => {
  it("ends red at the checking mark, naming the stage, the label and the spec, and hires, posts and closes nothing after it", () => {
    const checked = doneChecking({ markRefusal: "mark: #974 not labelled checking: HTTP 403: Resource not accessible by integration" });

    const { status, stderr } = checked.run();

    expect(status).toBe(1);
    expect(stderr).toContain("done-check: bin/mark #974 checking ended non-zero, so nothing after it is posted, closed, marked or hired\n");
    expect(checked.marked()).toEqual(["974 checking"]);
    expectNothingDone(checked);
  });
});

describe("bin/done-check tries a caller's spec on that repo's own checkout, readied by its contract's setup (#1151)", () => {
  const LUMARIA = "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main";
  const READIED = '{ "setup": "touch readied", "steps": {} }\n';

  it("runs the tree's setup before the hire, and tells the model the running system is that checkout", () => {
    const checked = doneChecking({ contract: READIED, calledFrom: LUMARIA });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence and is closed: ${DONE_CHECK_POSTED}`] });
    expect(existsSync(join(checked.root, "readied"))).toBe(true);
    expect(checked.handed()).toContain("the running system is this checkout of the repo, readied by its contract's setup");
    expect(checked.handed()).not.toContain("For this repo the running system is its own Actions runs");
  });

  it("ends red when the tree's setup fails, hiring, posting and closing nothing", () => {
    const checked = doneChecking({ contract: '{ "setup": "echo no lockfile >&2; exit 3", "steps": {} }\n', calledFrom: LUMARIA });

    const { status, stderr } = checked.run();

    expect(status).toBe(1);
    expect(stderr).toContain("done-check: #974 ended red, its tree's setup failed: no lockfile");
    expectNothingDone(checked);
  });

  it("tries this repo's own spec on its Actions runs, as before", () => {
    const checked = doneChecking({ contract: READIED });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).toContain("For this repo the running system is its own Actions runs");
  });
});

describe("bin/done-check lets a check on this repo start a size trial to try a sentence about the size refusal (#1198)", () => {
  it("tells the checker a size trial counts as leaving GitHub as it is, how to start one, wait for it and read its log, and what misses", () => {
    const handed = doneChecking();
    expect(handed.run().status).toBe(0);
    const told = handed.handed();

    expect(told).toContain("Starting a size trial counts as leaving GitHub as it is, since a trial posts nothing.");
    expect(told).toContain("gh run watch");
    expect(told).toContain("`slice: trial #974`");
    expect(told).toContain("60 seconds or more");
  });

  it("sets the trial cap to the owner's bytes plus half the record's, both counted from the spec's current body, so the slicer's own folding cannot fit without being sent back (#1200)", () => {
    const record = "### Picks\n\n- **Read back**: read it back, once the wave merged.";
    const body = wellFormedSpec.replace("## I'll know it works when I can", `## Decisions record\n\n${record}\n\n## I'll know it works when I can`);
    const handed = doneChecking({ body });
    expect(handed.run().status).toBe(0);

    expect(handed.handed()).toContain(`gh workflow run reslice.yml -f issue=974 -f trial_cap=${Buffer.byteLength(wellFormedSpec) + Math.floor(Buffer.byteLength(record) / 2)}\``);
    expect(handed.handed()).toContain("the owner's bytes plus half the record's bytes");
  });

  it("tells a checker called from a caller file in the machine's own repo this repo's running system and the size trial, as at home (#1215)", () => {
    const checked = doneChecking({ calledFrom: "collod873/claude-workflow/.github/workflows/machine.yml@refs/heads/main" });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).toContain("For this repo the running system is its own Actions runs");
    expect(checked.handed()).toContain("gh workflow run reslice.yml -f issue=974");
  });

  it("tells a caller's checker nothing of a size trial, since its spec is not sliced by this repo's re-slice workflow", () => {
    const checked = doneChecking({ contract: '{ "setup": "true", "steps": {} }\n', calledFrom: "collod873/Lumaria/.github/workflows/machine.yml@refs/heads/main" });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).not.toContain("size trial");
  });
});
