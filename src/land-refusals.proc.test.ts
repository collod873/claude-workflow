import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git, landSession, scratch } from "./scenarios.ts";

const DASH = "\u2014";

function refusesLanding(message: string, stderr: (commit: string) => string) {
  const marker = join(scratch("land-refusals-"), "gh-called");
  const { remote, session, run } = landSession({
    gh: `touch ${JSON.stringify(marker)}\n`,
    messages: ["a clean change", message, "another clean change"],
  });
  const refused = git(session, "rev-parse", "--short=7", "HEAD~1");

  const result = run();

  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe(stderr(refused));
  expect(git(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  expect(existsSync(marker)).toBe(false);
}

describe("bin/land refuses what must not reach main (#681)", () => {
  it("lands nothing and names the commit whose message carries an em dash", () => {
    refusesLanding(
      `Refuse a thing\n\nbecause ${DASH} it matters`,
      (commit) => `land: commit ${commit} carries an em dash in its message, so nothing landed; reword it\n`,
    );
  });

  it("lands nothing and names the commit whose message carries a closing keyword before a ticket number", () => {
    refusesLanding(
      "Fix the thing\n\nCloses #812",
      (commit) => `land: commit ${commit} carries a closing keyword before #812, so nothing landed; reword it\n`,
    );
  });
});
