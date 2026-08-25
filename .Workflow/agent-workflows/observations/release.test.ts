import { describe, expect, it } from "vitest";
import type { GhExec } from "../shared/gh";
import { observation } from "./observation.fixture";
import { mechanisedFinding, proseFinding, releaseBatch } from "./release-batch.fixture";
import { composeRelease } from "./release";

/**
 * A minimal recording `GhExec` — everything `composeRelease` needs is "what
 * argv was `gh` called with, and how many times," so this stands in for the
 * shared `FakeGh` (`shared/gh.fake.ts`) rather than extending it: that fake
 * models the issue/sub-issue/dependency surface `publishSubIssues` calls,
 * none of which `composeRelease` touches.
 */
function fakeGh(): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    return "https://github.com/owner/repo/pull/1\n";
  };
  return { gh, calls };
}

function flagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe("composeRelease", () => {
  it("opens exactly one PR for a batch mixing one mechanised and one prose finding", () => {
    const { gh, calls } = fakeGh();
    const batch = releaseBatch({
      mechanised: [mechanisedFinding({ observation: observation({ finding: "duplicated validation logic" }) })],
      prose: [
        proseFinding({
          observation: observation({ finding: "magic retry count" }),
          checklistItem: "Add a CODING_STANDARDS.md entry for the retry count.",
        }),
      ],
    });

    const result = composeRelease({ gh, batch });

    const prCreateCalls = calls.filter((args) => args[0] === "pr" && args[1] === "create");
    expect(prCreateCalls).toHaveLength(1);
    expect(result.opened).toBe(true);

    const body = flagValue(prCreateCalls[0], "--body");
    expect(body).toContain("- [ ] Add a CODING_STANDARDS.md entry for the retry count.");
    expect(body).not.toMatch(/closes/i);
  });

  it("makes no gh call at all for a batch with nothing release-eligible", () => {
    const { gh, calls } = fakeGh();
    const batch = releaseBatch();

    const result = composeRelease({ gh, batch });

    expect(calls).toHaveLength(0);
    expect(result.opened).toBe(false);
  });
});
