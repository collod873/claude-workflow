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
