import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { execute, heard, holds, plant, type Said, scratch, script, starts, wellFormedSpec, workflowJobs, type WorkflowStep } from "./scenarios.ts";
import { HELD, MACHINE, OWNER, STUCK } from "./spelled.ts";
import { DONE_CHECK_POSTED, doneChecking, specWith } from "./done-checker.part.ts";

const READ_COMMENTS = "api --paginate repos/{owner}/{repo}/issues/974/comments";
const SENTENCES = ["file a spec and see its first wave show up under it", "open any ticket it filed and see my own words copied over", "see the spec close itself once every sentence held"];

const expectNothingDone = (checked: ReturnType<typeof doneChecking>) => {
  expect(checked.hired()).toEqual([]);
  expect(checked.comments()).toEqual([]);
  expect(checked.closes()).toEqual([]);
};

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

describe("bin/done-check leaves the spec open unless every sentence held (#1023)", () => {
  it("posts the check and leaves the spec open when one sentence did not hold", () => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome: "missed", tried: "opened a ticket it filed" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, so it stays open: ${DONE_CHECK_POSTED}`] });
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
    expect(checked.closes()).toEqual([["issue", "close", "974", "--reason", "completed"]]);
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

describe("bin/done-check leaves a miss to the scheduler, which owns the one fix pass and the second miss (ADR-0013)", () => {
  const missing = [
    { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
    { sentence: 2, outcome: "missed", tried: "opened a ticket and found no Out of Scope" },
    { sentence: 3, outcome: "owner", tried: "open the spec on your phone" },
  ];

  it("posts what it saw, so the fix pass's slicer reads the cause, and marks, closes and slices nothing, even on a second miss", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: missing, said: ["## Done check\n\n2. **Did not hold**: the first miss\n\n<!-- fix-wave -->"] });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, so it stays open: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()).toHaveLength(1);
    expect(checked.comments()[0]).toContain(`2. **Did not hold**: ${SENTENCES[1]}\n   opened a ticket and found no Out of Scope`);
    expect(checked.comments()[0]).not.toContain("Closed with sentence");
    expect(checked.marked()).toEqual(["974 checking"]);
    expect(checked.closes()).toEqual([]);
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

describe("specs.yml runs the done check again on the owner's reply to a sentence it put to him (#1038)", () => {
  type Job = { if?: string; needs?: string; steps: WorkflowStep[] };
  function workflow(): { on: object; asked: Job; check: Job } {
    const { on } = parse(readFileSync(join(import.meta.dirname, "..", ".github", "workflows", "machine.yml"), "utf8")) as { on: object };
    const { asked, check } = workflowJobs("specs.yml") as Record<string, Job>;
    if (asked === undefined || check === undefined) throw new Error("specs.yml carries no asked and check jobs");
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
    const asks = (labels: string[], sender = OWNER) => starts("specs.yml", "asked", { labels, sender, action: "created", event: "issue_comment" });

    expect(on).toMatchObject({ issue_comment: { types: ["created"] } });
    expect(await asks(["spec"])).toBe(true);
    expect(await asks(["spec"], MACHINE)).toBe(false);
    expect(await asks(["spec"], "stranger")).toBe(false);
    expect(await asks(["ticket"])).toBe(false);
  });

  it("does not start on the owner's comment once the last done check put a sentence to him and called stuck (#1043)", async () => {
    const calledOwner = `## Done check\n\n1. **Did not hold**: one\n   saw it fail\n2. **Put to the owner**: two\n   open it on your phone\n\nSentence 1 missed again after the fix wave, so the spec is marked \`${STUCK}\`: one. Why: saw it fail\n`;

    expect(lastAsked([calledOwner, "an aside"])).toBe("true");
    for (const held of HELD) expect(await starts("specs.yml", "asked", { labels: ["spec", held], sender: OWNER, action: "created", event: "issue_comment" }), held).toBe(false);
  });

  it("runs bin/done-check on the spec only when the last ## Done check put a sentence to the owner", () => {
    const putToOwner = "## Done check\n\n1. **Held**: one\n   saw it\n2. **Put to the owner**: two\n   open it on your phone\n";
    const allTried = "## Done check\n\n1. **Held**: one\n   saw it\n2. **Did not hold**: two\n   saw it fail\n";

    expect(lastAsked([putToOwner, "an aside"])).toBe("true");
    expect(lastAsked([putToOwner, allTried, "an aside"])).toBe("false");
    expect(lastAsked(["## Wave check\n\n- Sentence 2, **Waits for the end**: two"])).toBe("false");
    expect(lastAsked([`${putToOwner}\nClosed with sentence 2 put to the owner: each says what the owner could try, and a miss seen live is filed as a new ticket.\n`, "an aside"])).toBe("false");
    expect(lastAsked([])).toBe("false");
    const { asked, check } = workflow();
    const reading = asked.steps.find((one) => one.id === "asked")?.run ?? "";
    expect(reading).toContain("bin/done-check ${{ github.event.issue.number }} --asked");
    for (const spelling of ["## Done check", "fix-wave", "Put to the owner", "$SPEC", "|"]) expect(reading, spelling).not.toContain(spelling);
    expect(check.needs).toBe("asked");
    expect(holds(check.if ?? "", { needs: { asked: { result: "success", outputs: { asked: "true" } } } })).toBe(true);
    expect(holds(check.if ?? "", { needs: { asked: { result: "success", outputs: { asked: "false" } } } })).toBe(false);
    const checked = check.steps.find((step) => step.run?.includes("bin/done-check"));
    expect(checked?.run).toContain('bin/done-check" ${{ github.event.issue.number }}');
    expect(checked?.env?.GH_TOKEN).toBe("${{ steps.app.outputs.token }}");
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
    for (const args of [["974", "--asked", "1"], ["--asked"], ["974", "--wave", "1"], ["974", "--wave", "1", "--asked"]]) {
      expect(doneChecking().run(...args), args.join(" ")).toEqual({ status: 2, stdout: "", stderr: "done-check: usage: done-check <issue number> [--asked]\n" });
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

  it("posts the self sentence as held and names the other sentence's miss alone", () => {
    const checked = doneChecking({ body: specWith(SENTENCES), tries: selfTries("missed") });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold sentence 2, so it stays open: ${DONE_CHECK_POSTED}`] });
    expect(checked.comments()[0]).toContain(`3. **Held**: ${SENTENCES[2]}\n   This run names each other sentence that did not hold, and why.`);
    expect(checked.closes()).toEqual([]);
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

