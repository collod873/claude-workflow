import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { execute, heard, holds, MACHINE, OWNER, plant, type Said, scratch, script, type WorkflowStep } from "./scenarios.ts";
import { DONE_CHECK_POSTED, doneChecking, specWith } from "./done-checker.part.ts";

const READ_COMMENTS = "api --paginate repos/{owner}/{repo}/issues/974/comments";
const SENTENCES = ["file a spec and see its first wave show up under it", "open any ticket it filed and see my own words copied over", "see the spec close itself once every sentence held"];

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
  it.each([
    ["did not hold", "missed", "Did not hold", "did not hold sentence 2, so bin/slice --fix filed its one fix wave"],
    ["was put to the owner", "owner", "Put to the owner", "did not hold every sentence, so it stays open"],
  ])("posts the check and leaves the spec open when one sentence %s", (_, outcome, shown, line) => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome, tried: "opened a ticket it filed" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 ${line}: ${DONE_CHECK_POSTED}`] });
    expect(checked.calls()).toEqual(["issue view 974", READ_COMMENTS, "issue comment 974"]);
    expect(checked.comments()[0]).toContain(`2. **${shown}**: ${SENTENCES[1]}\n   opened a ticket it filed`);
    expect(checked.closes()).toEqual([]);
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

  it("marks the spec needs-human, saying which sentence and why, when a sentence that missed at the last wave check misses again", () => {
    const tries = [{ sentence: 2, outcome: "missed", tried: "opened a ticket and found no Out of Scope" }];
    const said = ["## Wave check\n\n- Sentence 2, **Did not hold**: the first miss", "## Wave 3\n\nThe fix ticket merged.", "## Wave check\n\n- Sentence 2, **Held**: an older hold"].reverse();
    const checked = doneChecking({ body: specWith(SENTENCES), tries, said });

    expect(checked.run("974", "--wave", "2")).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked needs-human, sentence 2 missed at two wave checks in a row: ${DONE_CHECK_POSTED}\n` });
    expect(checked.comments()).toHaveLength(1);
    expect(checked.comments()[0]).toContain(`Sentence 2 missed at this wave check and the last one, so the spec is marked \`needs-human\`: ${SENTENCES[1]}. Why: opened a ticket and found no Out of Scope`);
    expect(checked.labelled()).toEqual(["974 --add-label needs-human"]);
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

  it("marks the spec needs-human, saying which sentence failed and why, when a sentence misses after the fix wave was spent", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Done check\n\n2. **Did not hold**: the first miss\n\n<!-- fix-wave -->"] });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked needs-human, sentence 2, 3 missed again after the fix wave: ${DONE_CHECK_POSTED}\n` });
    expect(checked.sliced()).toEqual([]);
    expect(checked.comments()).toHaveLength(1);
    expect(checked.comments()[0]).not.toContain("<!-- fix-wave -->");
    expect(checked.comments()[0]).toContain(`Sentence 2 missed again after the fix wave, so the spec is marked \`needs-human\`: ${SENTENCES[1]}. Why: opened a ticket and found no Out of Scope`);
    expect(checked.comments()[0]).toContain(`Sentence 3 missed again after the fix wave, so the spec is marked \`needs-human\`: ${SENTENCES[2]}. Why: saw the spec stay open`);
    expect(checked.labelled()).toEqual(["974 --add-label needs-human"]);
    expect(checked.closes()).toEqual([]);
  });

  it("marks the spec needs-human, spending no fix wave, when a sentence that missed at the last wave check misses again at the end", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Wave check\n\n- Sentence 3, **Did not hold**: the wave's miss"] });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: `done-check: #974 marked needs-human, sentence 3 missed at the last wave check and again at the end: ${DONE_CHECK_POSTED}\n` });
    expect(checked.sliced()).toEqual([]);
    expect(checked.comments()[0]).toContain(`Sentence 3 missed at the last wave check and again at the end, so the spec is marked \`needs-human\`: ${SENTENCES[2]}. Why: saw the spec stay open`);
    expect(checked.comments()[0]).not.toContain("<!-- fix-wave -->");
    expect(checked.labelled()).toEqual(["974 --add-label needs-human"]);
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
  type Job = { if?: string; needs?: string; steps: WorkflowStep[] };
  function workflow(): { on: object; asked: Job; check: Job } {
    const { on, jobs } = parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "done-check.yml"), "utf8")) as { on: object; jobs: Record<string, Job> };
    const { asked, check } = jobs;
    if (asked === undefined || check === undefined) throw new Error("done-check.yml carries no asked and check jobs");
    return { on, asked, check };
  }

  function lastAsked(comments: string[]): string | undefined {
    const root = scratch("done-check-yml-");
    plant(root, "comments.json", JSON.stringify(comments.map((body) => ({ body, user: { login: MACHINE } }))));
    script(join(root, "bin", "gh"), `while [[ $1 != --jq ]]; do shift; done\njq -r "$2" <"${join(root, "comments.json")}"\n`);
    const output = join(root, "output");
    const step = workflow().asked.steps.find((one) => one.run !== undefined);
    const ran = execute("bash", root, { PATH: `${join(root, "bin")}:${process.env.PATH}`, GITHUB_OUTPUT: output, GH_REPO: "collod873/claude-workflow", SPEC: "974" }, ["-e", "-c", step?.run ?? ""]);
    if (ran.status !== 0) throw new Error(ran.stderr);
    return readFileSync(output, "utf8").match(/^asked=(.*)$/m)?.[1];
  }

  it("starts on the owner's comment on a spec, and on no one else's", () => {
    const { on, asked } = workflow();
    const starts = (labels: string[], sender = OWNER) => holds(asked.if ?? "true", { labels, sender, action: "created" });

    expect(on).toEqual({ issue_comment: { types: ["created"] } });
    expect(starts(["spec"])).toBe(true);
    expect(starts(["spec"], MACHINE)).toBe(false);
    expect(starts(["spec"], "stranger")).toBe(false);
    expect(starts(["ticket"])).toBe(false);
  });

  it("runs bin/done-check on the spec only when the last ## Done check put a sentence to the owner", () => {
    const putToOwner = "## Done check\n\n1. **Held**: one\n   saw it\n2. **Put to the owner**: two\n   open it on your phone\n";
    const allTried = "## Done check\n\n1. **Held**: one\n   saw it\n2. **Did not hold**: two\n   saw it fail\n\n<!-- fix-wave -->\n";

    expect(lastAsked([putToOwner, "an aside"])).toBe("true");
    expect(lastAsked([putToOwner, allTried, "an aside"])).toBe("false");
    expect(lastAsked([`${putToOwner}\n<!-- fix-wave -->\n`, "an aside"])).toBe("false");
    expect(lastAsked(["## Wave check\n\n- Sentence 2, **Waits for the end**: two"])).toBe("false");
    expect(lastAsked([])).toBe("false");
    const { check } = workflow();
    expect(check.needs).toBe("asked");
    expect(check.if).toBe("${{ needs.asked.outputs.asked == 'true' }}");
    const checked = check.steps.find((step) => step.run?.includes("bin/done-check"));
    expect(checked?.run).toContain("bin/done-check ${{ github.event.issue.number }}");
    expect(checked?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
  });
});
