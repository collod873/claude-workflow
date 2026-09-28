import { describe, expect, it } from "vitest";
import { coldReading, COLD_READ_POSTED, heard, holds, onlyJob, wellFormedSpec } from "./scenarios.ts";

const FORBIDDEN = ["problem", "gap", "ambigu", "unclear", "flaw", "wrong", "check", "review", "critic", "question"];

describe("bin/cold-read reads a filed spec and posts what it would build, never asked for problems (#968)", () => {
  it("posts what it would build, then where it had to choose, each choice numbered with its guess and why, and leaves the spec open and unedited", () => {
    const read = coldReading({
      build: "A cold reader that hires one opus stage to read a filed spec, and posts what it would build.",
      choices: [
        { guess: "the stage reads only the repo, no web and no shell beyond a fenced run", why: "the ticket says fenced, no web" },
        { guess: "the prompt never uses the words the ticket forbids", why: "an agent asked for problems invents them" },
      ],
    });

    expect(heard(read.run())).toEqual({ status: 0, stderr: "", lines: [`cold-read: #968 posted what it would build: ${COLD_READ_POSTED}`] });
    expect(read.calls()).toEqual(["issue view 968", "issue comment 968"]);
    const [comment] = read.comments();
    expect(comment).toContain("## What I would build");
    expect(comment).toContain("A cold reader that hires one opus stage to read a filed spec, and posts what it would build.");
    expect(comment).toContain("## Where I had to choose");
    expect(comment).toContain("1. the stage reads only the repo, no web and no shell beyond a fenced run: the ticket says fenced, no web");
    expect(comment).toContain("2. the prompt never uses the words the ticket forbids: an agent asked for problems invents them");
    expect(read.hired()[read.hired().indexOf("--model") + 1]).toBe("opus");
    expect(read.hired()).toContain("--tools");
    expect(read.edits()).toEqual([]);
    expect(read.closes()).toEqual([]);

    const nowhere = coldReading({ build: "A cold reader that changes nothing here.", choices: [] });
    expect(nowhere.run().status).toBe(0);
    const [comment2] = nowhere.comments();
    expect(comment2).toContain("## What I would build");
    expect(comment2).toContain("A cold reader that changes nothing here.");
    expect(comment2).toContain("## Where I had to choose");
    expect((comment2 ?? "").toLowerCase()).toContain("chose nowhere");
  });

  it("never asked for problems: outside the spec, its prompt carries none of the forbidden words", () => {
    const named = `${wellFormedSpec}\n\nNamed here, so this test can prove they are read verbatim: problem, gap, ambiguity, unclear, flaw, wrong, check, review, critic, question.\n`;
    const read = coldReading({ body: named });

    read.run();
    const handed = read.handed();

    expect(handed).toContain(named.trim());
    expect(handed.toLowerCase()).toContain("what it would build");
    expect(handed.toLowerCase()).toContain("where it had to choose");
    const outsideSpec = handed.split(named.trim()).join("");
    for (const word of FORBIDDEN) expect(outsideSpec.toLowerCase()).not.toContain(word);
  });

  it("the owner's spec starts cold-read.yml; unlabelled, not spec, or opened by someone else does not, and bin/cold-read refuses an issue not labelled spec without spending a model", () => {
    const coldRead = onlyJob("cold-read.yml");
    const build = onlyJob("build.yml");
    const starts = (labels: string[], sender = "collod873") => holds(coldRead.if ?? "true", { labels, sender, action: "opened" });

    expect(starts(["spec"])).toBe(true);
    expect(starts([])).toBe(false);
    expect(starts(["ticket"])).toBe(false);
    expect(starts(["spec"], "stranger")).toBe(false);
    expect(holds(build.if ?? "true", { labels: ["spec"] })).toBe(false);

    const { run, calls, hired } = coldReading({ labels: ["ticket"] });
    expect(run()).toEqual({ status: 1, stdout: "", stderr: "cold-read: #968 is not a spec, so nothing read it\n" });
    expect(calls()).toEqual(["issue view 968"]);
    expect(hired()).toEqual([]);
  });
});
