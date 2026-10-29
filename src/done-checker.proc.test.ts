import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { heard, type Said, workflowJobs } from "./scenarios.ts";
import { HELD, OWNER } from "./spelled.ts";
import { BUG_FILED, DONE_CHECK_POSTED, doneChecking, specWith, TRYING_SESSION } from "./done-checker.part.ts";
import { OUT_OF_TIME, REPLIES_CAP } from "./done-checker.ts";

const SENTENCES = ["file a spec and see its first wave show up under it", "open any ticket it filed and see my own words copied over", "see the spec close itself once every sentence held"];

const expectNothingDone = (checked: ReturnType<typeof doneChecking>) => {
  expect(checked.hired()).toEqual([]);
  expect(checked.comments()).toEqual([]);
  expect(checked.closes()).toEqual([]);
};

const RERUN_SAFE = "Nothing was posted, so once its cause is fixed the done check is safe to run again on its own: `bin/done-check 974` on a checkout of main, with `stuck` off.";
const ownerCall = (why: string) => `@${OWNER} the done check of #974 stopped and needs you: ${why}. ${RERUN_SAFE}`;

const expectMarkedNeedsHuman = (checked: ReturnType<typeof doneChecking>) => {
  expect(checked.marked()).toEqual(["974 checking", "974 stuck"]);
};

describe("bin/done-check tries a spec's sentences and closes it only when every one held (#1023)", () => {
  it("posts one comment headed ## Done check, each sentence with how it came out and what was done to try it, then closes the spec", () => {
    const tries = SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: `read run ${at + 1} with gh` }));
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.closes()).toEqual([["issue", "close", "974", "--reason", "completed"]]);
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

describe("bin/done-check files each sentence that did not hold as a bug and closes the spec, where #1689 sat stuck 78 min on a second check of the same code", () => {
  it("files the miss as a bug quoting what the checker saw, with the sentence as its done, then closes the spec", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome: "missed", tried: "opened a ticket it filed and its Why was empty" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({
      status: 0,
      stderr: "",
      lines: [`done-check: #974 did not hold sentence 2, filed as ${BUG_FILED}, and is closed: ${DONE_CHECK_POSTED}`],
    });
    const created = checked.created();
    expect(created).toHaveLength(1);
    const body = created[0]?.[created[0].indexOf("--body") + 1] ?? "";
    expect(body).toContain("Follow-up of #974: its done check found this did not hold.");
    expect(body).toContain("> opened a ticket it filed and its Why was empty");
    expect(body).toContain(`## Done when\n\n- ${SENTENCES[1]}`);
    expect(created[0]).toContain("bug");
    expect(checked.closes()).toEqual([["issue", "close", "974", "--reason", "completed"]]);
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
    expect(checked.closes()).toEqual([["issue", "close", "974", "--reason", "completed"]]);
    const [comment = ""] = checked.comments();
    expect(comment).toContain(`2. **Put to the owner**: ${SENTENCES[1]}\n   open a ticket it filed on your phone`);
    expect(comment).toContain(`3. **Put to the owner**: ${SENTENCES[2]}\n   watch the next red run re-run`);
    expect(comment).toContain("Closed with sentence 2, 3 put to the owner: each says what the owner could try, and the owner files a miss he sees live as a new ticket.");
    expect(checked.marked()).toEqual(["974 checking"]);
  });
});

describe("bin/done-check marks a landed spec stuck and calls the owner with the real reason when it cannot finish, since nothing else wakes it (ADR-0009)", () => {

  it("posts no done check and closes nothing when the model gives no try for a sentence", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
      { sentence: 3, outcome: "missed", tried: "a second answer for the same sentence" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(checked.run()).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 marked stuck, the done checker gave no try for sentence 2\n" });
    expectMarkedNeedsHuman(checked);
    expect(checked.comments()).toEqual([ownerCall("the done checker gave no try for sentence 2")]);
    expect(checked.closes()).toEqual([]);
  });

  it("names GitHub's refusal when its comment will not post", () => {
    const checked = doneChecking({ gh: "[[ $1 == issue && $2 == comment && $* == *'## Done check'* ]] && { printf 'HTTP 422: Validation Failed (body is too long)\\n' >&2; exit 1; }" });

    const { status, stderr } = checked.run();

    expect(status).toBe(1);
    expect(stderr).toBe("done-check: #974 marked stuck, its comment would not post: gh issue comment failed: HTTP 422: Validation Failed (body is too long)\n");
    expectMarkedNeedsHuman(checked);
    expect(checked.comments().at(-1)).toBe(ownerCall("its comment would not post: gh issue comment failed: HTTP 422: Validation Failed (body is too long)"));
    expect(checked.closes()).toEqual([]);
  });

  it("asks the owner to close the spec by hand when every sentence held and its comment posted but the spec would not close", () => {
    const checked = doneChecking({ gh: "[[ $1 == issue && $2 == close ]] && { printf 'HTTP 403: Resource not accessible\\n' >&2; exit 1; }" });

    const { status, stderr } = checked.run();

    expect(status).toBe(1);
    expect(stderr).toBe(`done-check: #974 marked stuck, it held every sentence but would not close: ${DONE_CHECK_POSTED}\n`);
    expectMarkedNeedsHuman(checked);
    expect(checked.comments().at(-1)).toBe(`@${OWNER} the done check of #974 stopped and needs you: it held every sentence but would not close: ${DONE_CHECK_POSTED}. Its comment is posted, so nothing is left to try: close #974 by hand.`);
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

  it("keeps the owner's newest words when his replies run past their cap", () => {
    const said: Said[] = [`## Done check\n\n3. **Put to the owner**: ${SENTENCES[2]}\n   open it on your phone`, { author: OWNER, type: "User", body: "x".repeat(REPLIES_CAP) }, { author: OWNER, type: "User", body: "sentence 3 held on my phone" }];
    const checked = doneChecking({ body: specWith(SENTENCES), tries: SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: "the owner said so" })), said });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).toContain("sentence 3 held on my phone");
  });

  it("hands no replies when no done check ran before", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: "saw it" })), said: [{ author: OWNER, type: "User", body: "an aside" }] });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).not.toContain("## The owner's replies");
  });
});

describe("an owner's comment runs no done check of its own: his replies reach the spec's next done check, the fix pass's (ADR-0013)", () => {
  it("leaves the caller file deaf to comments, specs.yml with no job on one, and bin/done-check with no --asked", () => {
    const { on } = parse(readFileSync(join(import.meta.dirname, "..", ".github", "caller.yml"), "utf8")) as { on: object };

    expect(Object.keys(on)).not.toContain("issue_comment");
    expect(Object.keys(workflowJobs("specs.yml"))).not.toContain("asked");
    expect(Object.keys(workflowJobs("specs.yml"))).not.toContain("check");
    for (const args of [["974", "--asked"], ["974", "1"], ["--asked"]]) {
      expect(doneChecking().run(...args), args.join(" ")).toEqual({ status: 2, stdout: "", stderr: "done-check: usage: done-check <issue number>\n" });
    }
  });

  it("ends red at unread naming the comments read, marking nothing and hiring no model, when a check cannot read the spec's comments (#1123)", () => {
    const checked = doneChecking({ gh: "[[ $1 == api ]] && { printf 'HTTP 401: Bad credentials\\n' >&2; exit 1; }" });

    expect(checked.run("974")).toEqual({ status: 1, stdout: "", stderr: "done-check: #974 could not read its comments, so nothing was tried\n" });
    expect(checked.marked()).toEqual([]);
  });
});

describe("bin/done-check, out of time, answers with what it tried, so a landed spec is never left with its sentences untried (#1023)", () => {
  it("resumes the session that ran past its cap, tells it to answer now, and posts its tries", () => {
    const tries = SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: at === 2 ? "missed" : "held", tried: at === 2 ? "ran out of time before trying it" : "saw it" }));
    const checked = doneChecking({ body: specWith(SENTENCES), tries, triesPastCap: true });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 3, filed as ${BUG_FILED}, and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.hired()[checked.hired().indexOf("--resume") + 1]).toBe(TRYING_SESSION);
    expect(checked.handed()).toBe(OUT_OF_TIME);
    expect(checked.comments()[0]).toContain(`3. **Did not hold**: ${SENTENCES[2]}\n   ran out of time before trying it`);
  });
});

describe("bin/done-check numbers the sentences for the model as it counts them, so each try pairs with its own sentence (#1023)", () => {
  it("hands the sentences numbered, a plain line under one folded into it rather than counted", () => {
    const body = specWith(SENTENCES).replace(`- [ ] ${SENTENCES[0]}\n`, `- [ ] ${SENTENCES[0]}\n  - on the phone too\n`);
    const checked = doneChecking({ body, tries: SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: "saw it" })) });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).toContain(`## The sentences to try\n\n1. ${SENTENCES[0]} - on the phone too\n2. ${SENTENCES[1]}\n3. ${SENTENCES[2]}`);
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

  it("posts the self sentence as held and names the other sentence's miss alone", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("missed") });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, filed as ${BUG_FILED}, and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run files each other sentence that did not hold as a bug, and closed the spec.`);
    expect(checked.closes()).toHaveLength(1);
    expect(checked.marked()).toEqual(["974 checking"]);
  });

  it("posts the self sentence as held and closes the spec when another was put to the owner (#1213)", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("owner") });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence it could try, put the rest to the owner, and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run closed the spec, since every other sentence held or was put to the owner.`);
    expect(checked.closes()).toHaveLength(1);
  });
});

describe("bin/done-check marks the spec checking while it runs (#1064)", () => {
  it("marks checking at the start of the done check", () => {
    const whole = doneChecking();

    expect(whole.run().status).toBe(0);
    expect(whole.marked()).toEqual(["974 checking"]);
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
    expect(checked.handed()).not.toContain("For this repo the running system is the landed code in this checkout");
  });

  it("marks the spec stuck and calls the owner when the tree's setup fails, hiring, posting and closing nothing else", () => {
    const checked = doneChecking({ contract: '{ "setup": "echo no lockfile >&2; exit 3", "steps": {} }\n', calledFrom: LUMARIA });

    const { status, stderr } = checked.run();

    expect(status).toBe(1);
    expect(stderr).toContain("done-check: #974 marked stuck, its tree's setup failed: no lockfile\n");
    expectMarkedNeedsHuman(checked);
    expect(checked.hired()).toEqual([]);
    expect(checked.comments()).toEqual([ownerCall("its tree's setup failed: no lockfile")]);
    expect(checked.closes()).toEqual([]);
  });

  it("tries this repo's own spec on the landed code in its checkout, putting to the owner what only a live run can show", () => {
    const checked = doneChecking({ contract: READIED });

    expect(checked.run().status).toBe(0);
    expect(checked.handed()).toContain("For this repo the running system is the landed code in this checkout");
    expect(checked.handed()).toContain("What only a live run can show goes to the owner.");
  });
});

