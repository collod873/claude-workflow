import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sessionBuilding } from "./session-build.part.ts";

describe("bin/session-build builds an issue in one Claude session as the owner, the way he would in a terminal", () => {
  it("clones the repo, runs its setup, then hands the issue to /tdd in that clone with his own GitHub login, not the job's token", () => {
    const building = sessionBuilding();
    const built = building.run();
    const [cwd, token, ...argv] = readFileSync(join(building.root, "claude-call"), "utf8").trimEnd().split("\n");

    expect(built.status).toBe(0);
    expect(cwd).toBe(join(building.root, "temp", "tree"));
    expect(readFileSync(join(building.root, "temp", "tree", "set-up"), "utf8")).toBe("yes\n");
    expect(token).toBe("unset");
    expect(argv).toContain("bypassPermissions");
    expect(argv.find((arg) => arg.startsWith("/tdd"))).toMatch(/^\/tdd build https:\/\/github\.com\/collod873\/Mezzanine\/issues\/902\b/);
  });

  it("ends red naming the issue when the session ends with it still open, so the owner hears it stopped", () => {
    const built = sessionBuilding({ stateAfter: "OPEN" }).run();

    expect(built.status).toBe(1);
    expect(built.stderr).toContain("collod873/Mezzanine#902 is still open");
  });

  it("names the session's own exit when it ended red, so a failed login is not mistaken for unfinished work", () => {
    const built = sessionBuilding({ stateAfter: "OPEN", claudeExit: 7 }).run();

    expect(built.status).toBe(1);
    expect(built.stderr).toContain("its session exited 7");
  });

  it("starts no session on an issue already closed, as a second wake queued behind the first finds it", () => {
    const building = sessionBuilding({ stateBefore: "CLOSED" });

    expect(building.run().status).toBe(0);
    expect(building.claudeRan()).toBe(false);
  });
});
