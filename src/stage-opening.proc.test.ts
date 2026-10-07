import { describe, expect, it } from "vitest";
import { doneChecking } from "./done-checker.part.ts";
import { researching } from "./researcher.part.ts";
import { slicing } from "./slicer.part.ts";
import { HELD } from "./spelled.ts";

const ISSUE_UNREAD = "[[ $1 == issue && $2 == view ]] && { printf 'HTTP 401: Bad credentials\\n' >&2; exit 1; }";

const STAGES = [
  { stage: "slice", issue: "968", kind: ["spec"], open: (labels: string[] | undefined, gh: string) => slicing({ labels, gh }) },
  { stage: "research", issue: "902", kind: ["note", "research"], open: (labels: string[] | undefined, gh: string) => researching({ labels, gh }) },
  { stage: "done-check", issue: "974", kind: ["spec"], open: (labels: string[] | undefined, gh: string) => doneChecking({ labels, gh }) },
];

describe.each(STAGES)("bin/$stage opens through the one stage opening (#1111)", ({ stage, issue, kind, open }) => {
  it("ends red at unread naming the issue read when gh fails it, and changes no label and hires no model", () => {
    const opened = open(undefined, ISSUE_UNREAD);

    expect(opened.run()).toEqual({ status: 1, stdout: "", stderr: `${stage}: #${issue} could not be read, so no label changed and no model was hired\n` });
    expect(opened.marked()).toEqual([]);
    expect(opened.hired()).toEqual([]);
  });

  for (const held of HELD) {
    it(`ends green in one line on an issue marked ${held}, and changes no label and hires no model (#1166)`, () => {
      const opened = open([...kind, held], "");

      expect(opened.run()).toEqual({ status: 0, stdout: `${stage}: #${issue} is marked ${held}, so no label changed and no model was hired\n`, stderr: "" });
      expect(opened.marked()).toEqual([]);
      expect(opened.hired()).toEqual([]);
    });
  }
});
