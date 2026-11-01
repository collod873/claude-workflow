import { describe, expect, it } from "vitest";
import { HERE, KIT, MACHINE, migrating } from "./migrate-waiting.part.ts";

const writes = (calls: string[][]) => calls.filter((args) => args.includes("POST") || (args[0] === "issue" && args[1] === "edit"));
const fault = "Filed by the builder of collod873/Lumaria#900, which waits on it, as the machine's fault.";
const woken = "#931 waits on it, labelled `waiting`, and the closer wakes it once every one of them closes:";

const today = [
  { number: 931, body: "## Why\n\nFollow-up of #920: its reviewer let this through.\n\n## Done when\n\n- x\n", comments: [`The builder of #931 found it depends on #5, #6, still open. ${woken} it needs them`] },
  { number: 932, body: "## Why\n\nNeeds a pattern.\n", comments: [`The builder of #932 handed its first step to ${KIT} and filed https://github.com/${KIT}/issues/301. ${woken}`, `The builder of #932 found the machine at fault and filed https://github.com/${MACHINE}/issues/1700. ${woken}`] },
  { number: 933, body: `## Problem\n\nA spec.\n\n## Waits on\n\n- #7\n`, comments: [] },
  { number: 934, body: `## Why\n\n${fault}\n`, comments: [] },
];

const migrated = [
  { ...today[0]!, body: `${today[0]!.body}\n<!-- from: ${HERE}#920 review -->\n`, blockers: [{ repo: HERE, number: 5 }, { repo: HERE, number: 6 }] },
  { ...today[1]!, blockers: [{ repo: KIT, number: 301 }, { repo: MACHINE, number: 1700 }] },
  { ...today[2]!, blockers: [{ repo: HERE, number: 7 }] },
  { ...today[3]!, body: `${today[3]!.body}\n<!-- from: ${HERE}#900 fault -->\n` },
];

describe("bin/migrate-waiting turns today's prose on open waiting tickets into links and marker lines (#1606)", () => {
  it("adds a blocked-by link per parked or Waits on issue, files handed steps and faults under their ticket, and writes the marker line for a provenance sentence", () => {
    const { migrate, calls } = migrating({ waiting: today });

    const result = migrate();

    expect(result.status, result.stderr).toBe(0);
    const made = writes(calls());
    const posted = (path: string) => made.filter((args) => args.includes(path)).map((args) => args.at(-1));
    expect(posted(`repos/${HERE}/issues/931/dependencies/blocked_by`)).toEqual(["issue_id=4242", "issue_id=4242"]);
    expect(posted(`repos/${HERE}/issues/932/dependencies/blocked_by`)).toEqual(["issue_id=4242", "issue_id=4242"]);
    expect(posted(`repos/${HERE}/issues/933/dependencies/blocked_by`)).toEqual(["issue_id=4242"]);
    expect(posted(`repos/${HERE}/issues/932/sub_issues`)).toEqual(["sub_issue_id=4242", "sub_issue_id=4242"]);
    const bodies = made.filter((args) => args[1] === "edit").map((args) => [args[2], args.at(-1)]);
    expect(bodies).toEqual([
      ["931", migrated[0]!.body],
      ["934", migrated[3]!.body],
    ]);
    expect(made).toHaveLength(9);
  });

  it("makes no call that writes on tickets it already migrated", () => {
    const { migrate, calls } = migrating({ waiting: migrated, parented: [`${KIT}#301`, `${MACHINE}#1700`] });

    const result = migrate();

    expect(result.status, result.stderr).toBe(0);
    expect(writes(calls())).toEqual([]);
  });
});
