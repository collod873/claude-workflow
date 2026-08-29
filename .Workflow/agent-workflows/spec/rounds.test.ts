import { describe, expect, it } from "vitest";
import { CHANGE_REQUEST_CAP } from "../shape/sheet";
import { createIssueGh, type FakeIssueGh } from "./gh.fake";
import { answeringComments, openQuestionsComment, postOpenQuestions, roundFor } from "./rounds";

/** A fake `GhExec` reading `comments` for issue 1 and recording every call verbatim. */
function fakeGh(comments: string[] = []): FakeIssueGh {
  return createIssueGh(() => JSON.stringify({ comments: comments.map((body) => ({ body })) }));
}

describe("roundFor — recomputed, never stored", () => {
  it("is 0 on a spec nothing has spoken on", () => {
    expect(roundFor(fakeGh().gh, 1)).toBe(0);
  });

  it("ignores the owner's own comments — only lane 02's own count", () => {
    expect(roundFor(fakeGh(["looks good", "answered #1"]).gh, 1)).toBe(0);
  });

  it("counts a posted open-questions comment", () => {
    const comment = openQuestionsComment(["invented intent #1"]);

    expect(roundFor(fakeGh([comment]).gh, 1)).toBe(1);
  });
});

describe("the answering loop is uncapped, unlike lane 01's roundFor", () => {
  it("keeps counting past lane 01's two-round change-request cap with no cap of its own", () => {
    const comments = Array.from(
      { length: CHANGE_REQUEST_CAP + 3 },
      (_, i) => openQuestionsComment([`round ${i}`]),
    );

    const round = roundFor(fakeGh(comments).gh, 1);

    // Lane 01's `shape/rounds.ts` would report `capped: true` well before
    // this many rounds. This module has no `capped` field at all — the
    // uncapped count itself is the whole assertion, well past the cap.
    expect(round).toBe(CHANGE_REQUEST_CAP + 3);
    expect(round).toBeGreaterThan(CHANGE_REQUEST_CAP);
  });

  it("re-runs the chain on every answering comment: posting again after the cap is not refused", () => {
    const priorRounds = Array.from(
      { length: CHANGE_REQUEST_CAP + 1 },
      (_, i) => openQuestionsComment([`round ${i}`]),
    );
    const { gh, calls } = fakeGh(priorRounds);

    postOpenQuestions(gh, 1, ["one more open question"]);

    const posted = calls.find((call) => call[0] === "issue" && call[1] === "comment");
    expect(posted).toBeDefined();
    expect(posted?.[posted.indexOf("--body") + 1]).toContain("one more open question");
  });
});

describe("answeringComments — the other side of the same comment list", () => {
  it("is empty on a spec nothing has spoken on", () => {
    expect(answeringComments(fakeGh().gh, 1)).toEqual([]);
  });

  it("returns the owner's own comments, in the order he wrote them", () => {
    const { gh } = fakeGh(["done means the gauntlet exits 0", "yes, only the owner"]);

    expect(answeringComments(gh, 1)).toEqual([
      "done means the gauntlet exits 0",
      "yes, only the owner",
    ]);
  });

  it("excludes the rounds this lane posted, so the critic never reads its own findings back", () => {
    const { gh } = fakeGh([openQuestionsComment(["what does done mean?"]), "it means green"]);

    expect(answeringComments(gh, 1)).toEqual(["it means green"]);
  });
});

describe("openQuestionsComment", () => {
  it("carries the numbered questions and nothing of a draft body", () => {
    const comment = openQuestionsComment(["first question", "second question"]);

    expect(comment).toContain("1. first question");
    expect(comment).toContain("2. second question");
  });
});
