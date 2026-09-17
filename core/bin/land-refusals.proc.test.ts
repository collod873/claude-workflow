import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git, landSession, scratch } from "../scenarios.ts";

const DASH = "\u2014";

describe("core/bin/land refuses what must not reach main (#681)", () => {
  it("lands nothing and names the commit whose message carries an em dash", () => {
    const marker = join(scratch("land-refusals-"), "gh-called");
    const { remote, session, run } = landSession({
      gh: `touch ${JSON.stringify(marker)}\n`,
      messages: ["a clean change", `Refuse a thing\n\nbecause ${DASH} it matters`, "another clean change"],
    });
    const dashed = git(session, "rev-parse", "--short=7", "HEAD~1");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`land: commit ${dashed} carries an em dash in its message, so nothing landed; reword it\n`);
    expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
    expect(existsSync(marker)).toBe(false);
  });
});
