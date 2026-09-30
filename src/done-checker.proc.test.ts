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
