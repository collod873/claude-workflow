import { describe, expect, it } from "vitest";
import { EARLIER_ID, SESSION_ID, sessionBuilding } from "./session-build.part.ts";

describe("bin/session-build builds an issue in a background Claude session in the owner's own checkout, the way he would in a terminal", () => {
  it("starts /tdd as a background session in a worktree of the checkout whose origin is the repo, with his own login and none of the job's environment", () => {
    const building = sessionBuilding();
    const built = building.run();
    const [cwd, token, actions, ...argv] = building.claudeCall();

    expect(built.status).toBe(0);
    expect(building.worktreeFrom()).toEqual([building.checkout]);
    expect(cwd).toBe(building.tree);
    expect(token).toBe("unset");
    expect(actions).toBe("unset");
    expect(argv).toContain("--bg");
    expect(argv).toContain("bypassPermissions");
    expect(argv.join(" ")).toContain("--model opus --effort medium");
    expect(argv.find((arg) => arg.startsWith("/tdd"))).toMatch(/^\/tdd build https:\/\/github\.com\/collod873\/Mezzanine\/issues\/902\b/);
  });

  it("opens a terminal window attached to the session, so the owner sees it the moment it starts", () => {
    const building = sessionBuilding();
    building.run();

    expect(building.window()).toEqual(expect.arrayContaining(["attach", SESSION_ID]));
  });

  it("waits out the session's work, then stops it once the issue is closed", () => {
    const building = sessionBuilding();

    expect(building.run().status).toBe(0);
    expect(building.stopped()).toEqual([SESSION_ID]);
  });

  it("keeps waiting through a status read that fails, so a hiccup mid-build is not taken for its end", () => {
    const building = sessionBuilding({ answers: ["fail", "working", "done"] });

    expect(building.run().status).toBe(0);
    expect(building.stopped()).toEqual([SESSION_ID]);
  });

  it("ends red naming the issue, how the session ended and how to pick it up, and leaves the session for the owner", () => {
    const building = sessionBuilding({ stateAfter: "OPEN", answers: ["working", "blocked"] });
    const built = building.run();

    expect(built.status).toBe(1);
    expect(built.stderr).toContain("collod873/Mezzanine#902 is still open");
    expect(built.stderr).toContain("its session is blocked");
    expect(built.stderr).toContain(`claude attach ${SESSION_ID}`);
    expect(building.stopped()).toEqual([]);
  });

  it("starts no second session in a worktree a session from before worked in, and names that one to pick up instead", () => {
    const building = sessionBuilding({ earlier: true });
    const built = building.run();

    expect(built.status).toBe(1);
    expect(built.stderr).toContain(`claude attach ${EARLIER_ID}`);
    expect(building.claudeRan()).toBe(false);
  });

  it("builds in the checkout under ~/.agents when that is the repo's only one, as agent-hooks and agent-skills are", () => {
    const building = sessionBuilding({ under: ".agents" });

    expect(building.run().status).toBe(0);
    expect(building.worktreeFrom()).toEqual([building.checkout]);
  });

  it("ends red before any session when no folder under ~/Claude Projects or ~/.agents is a checkout of the repo", () => {
    const building = sessionBuilding({ checkedOut: false });
    const built = building.run();

    expect(built.status).toBe(1);
    expect(built.stderr).toContain("no checkout of collod873/Mezzanine");
    expect(building.claudeRan()).toBe(false);
  });

  it("starts no session on an issue already closed, as a second wake queued behind the first finds it", () => {
    const building = sessionBuilding({ stateBefore: "CLOSED" });

    expect(building.run().status).toBe(0);
    expect(building.claudeRan()).toBe(false);
  });
});
