import { describe, expect, it } from "vitest";
import { githubCall } from "./scenarios.ts";

function github(refusals: string[], args?: string[]) {
  const { run, calls } = githubCall(refusals, args);
  return { ...run(), tries: () => calls().length, calls };
}

describe("a GitHub call that fails on a blip is tried up to 3 times before its stage goes red (#1206)", () => {
  it("answers with the try that passed, naming each retry in the log", () => {
    const ran = github(["gh: Server Error (HTTP 502)", "gh: Label does not exist (HTTP 404)"]);

    expect(ran.status, ran.stderr).toBe(0);
    expect(ran.stdout).toBe("answered\n");
    expect(ran.tries()).toBe(3);
    expect(ran.calls()).toEqual(Array.from({ length: 3 }, () => ["issue", "edit", "1202", "--add-label", "landing"]));
    expect(ran.stderr).toBe(
      [
        "github: gh issue edit 1202 --add-label landing failed on try 1 of 3, so it is tried again in 0s: gh: Server Error (HTTP 502)",
        "github: gh issue edit 1202 --add-label landing failed on try 2 of 3, so it is tried again in 0s: gh: Label does not exist (HTTP 404)",
        "",
      ].join("\n"),
    );
  });

  it.each([
    ["a server error", "gh: Server Error (HTTP 503)"],
    ["a rate limit", "gh: API rate limit exceeded for installation ID 1 (HTTP 403)"],
    ["a too-many-requests", "gh: Too Many Requests (HTTP 429)"],
    ["a timeout", 'Post "https://api.github.com/graphql": dial tcp: i/o timeout'],
    ["a not-found", "GraphQL: Could not resolve to an issue or pull request with the number of 0. (repository.issue)"],
  ])("ends red with the last refusal after 3 tries of %s", (_, refusal) => {
    const ran = github([refusal, refusal, refusal]);

    expect(ran.status).toBe(1);
    expect(ran.tries()).toBe(3);
    expect(ran.stdout).toBe("partial\n");
    expect(ran.stderr.split("\n").filter((line) => line.startsWith("github: "))).toHaveLength(2);
    expect(ran.stderr.endsWith(`\n${refusal}\n`)).toBe(true);
  });

  it("tries a refusal that is not a blip once, passing on what gh said", () => {
    const ran = github(["HTTP 422: Validation Failed"]);

    expect(ran.status).toBe(1);
    expect(ran.tries()).toBe(1);
    expect(ran.stdout).toBe("partial\n");
    expect(ran.stderr).toBe("HTTP 422: Validation Failed\n");
  });

  it("takes a not-found as the answer of a call that asks for it, while still retrying its other blips", () => {
    const missing = github(["gh: Not Found (HTTP 404)"], ["--missing-answers", "api", "repos/{owner}/{repo}/issues/874/parent"]);
    const blipped = github(["gh: Server Error (HTTP 502)"], ["--missing-answers", "api", "repos/{owner}/{repo}/issues/874/parent"]);

    expect(missing.status).toBe(1);
    expect(missing.calls()).toEqual([["api", "repos/{owner}/{repo}/issues/874/parent"]]);
    expect(missing.stderr).toBe("gh: Not Found (HTTP 404)\n");
    expect(blipped.status).toBe(0);
    expect(blipped.calls()).toEqual(Array.from({ length: 2 }, () => ["api", "repos/{owner}/{repo}/issues/874/parent"]));
  });
});
