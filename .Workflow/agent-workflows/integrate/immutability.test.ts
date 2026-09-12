import { describe, expect, it } from "vitest";
import { IMMUTABLE_SET } from "../shared/immutable-set";
import { judgeChangedFiles, namesPullRequest } from "./immutability";

describe("#519: the immutability job judges the claim from the files it was handed", () => {
  it("refuses a run that declared no changed files at all, rather than passing it", () => {
    expect(judgeChangedFiles([])).toEqual({ verdict: "undeclared" });
  });

  it("passes a claim that touches nothing the set names", () => {
    expect(judgeChangedFiles(["src/index.ts", "README.md"])).toEqual({ verdict: "clean" });
  });

  it.each(IMMUTABLE_SET)("refuses a claim on %s, naming it", (entry) => {
    expect(judgeChangedFiles(["src/index.ts", `${entry}whatever.yml`])).toEqual({
      verdict: "refused",
      paths: [`${entry}whatever.yml`],
    });
  });

  it("names every refused path, not just the first", () => {
    const paths = IMMUTABLE_SET.map((entry) => `${entry}x`);
    expect(judgeChangedFiles([...paths, "ok.ts"])).toEqual({ verdict: "refused", paths });
  });

  it("names the pull request in the line the fixer greps its log for", () => {
    expect(namesPullRequest(() => "implement/issue-241\n", "https://github.com/o/r/pull/250")).toBe(
      "judging https://github.com/o/r/pull/250 on implement/issue-241",
    );
  });
});
