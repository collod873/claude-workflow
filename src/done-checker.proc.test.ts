import { describe, expect, it } from "vitest";
import { DONE_CHECK_POSTED, doneChecking, heard, specWith } from "./scenarios.ts";

const SENTENCES = ["file a spec and see its first wave show up under it", "open any ticket it filed and see my own words copied over", "see the spec close itself once every sentence held"];

describe("bin/done-check tries a spec's sentences and closes it only when every one held (#1023)", () => {
  it("posts one comment headed ## Done check, each sentence with how it came out and what was done to try it, then closes the spec", () => {
    const tries = SENTENCES.map((_, at) => ({ sentence: at + 1, outcome: "held", tried: `read run ${at + 1} with gh` }));
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 held every sentence and is closed: ${DONE_CHECK_POSTED}`] });
    expect(checked.calls()).toEqual(["issue view 974", "issue comment 974", "issue close 974"]);
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
    ["did not hold", "missed", "Did not hold"],
    ["was put to the owner", "owner", "Put to the owner"],
  ])("posts the check and leaves the spec open when one sentence %s", (_, outcome, shown) => {
    const tries = [
      { sentence: 1, outcome: "held", tried: "saw the first wave under it" },
      { sentence: 2, outcome, tried: "opened a ticket it filed" },
      { sentence: 3, outcome: "held", tried: "saw it close" },
    ];
    const checked = doneChecking({ body: specWith(SENTENCES), tries });

    expect(heard(checked.run())).toEqual({ status: 0, stderr: "", lines: [`done-check: #974 did not hold every sentence, so it stays open: ${DONE_CHECK_POSTED}`] });
    expect(checked.calls()).toEqual(["issue view 974", "issue comment 974"]);
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
    expect(checked.calls()).toEqual(["issue view 974"]);
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
