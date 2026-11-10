import { describe, expect, it } from "vitest";
import { callerWith, clocking } from "./scenarios.ts";

describe("bin/ship-clock has this PC dispatch each app's daily Ship at its cron time, since GitHub fires a schedule hours late", () => {
  it("installs a timer per app calling the shared Ship, at its cron time in UTC, caught up after the PC was off, that dispatches its ship.yml", () => {
    const { run, sudo } = clocking({ "collod873/Mezzanine": callerWith("0 8 * * *"), "collod873/PW-Zone2": callerWith("20 8 * * *") });

    const ran = run();

    expect(ran.stderr).toBe("");
    expect(ran.stdout).toContain("collod873/Mezzanine dispatches Ship daily at 08:00 UTC");
    expect(ran.stdout).toContain("collod873/PW-Zone2 dispatches Ship daily at 08:20 UTC");
    expect(ran.stdout).not.toContain("Lumaria");
    const written = sudo();
    expect(written).toContain("OnCalendar=*-*-* 08:00:00 UTC");
    expect(written).toContain("OnCalendar=*-*-* 08:20:00 UTC");
    expect(written).toContain("Persistent=true");
    expect(written).toContain("After=network-online.target");
    expect(written).toMatch(/ExecStart=\/\S+\/gh workflow run ship\.yml -R collod873\/PW-Zone2/);
    expect(written).toContain("systemctl enable --now ship-collod873-Mezzanine.timer ship-collod873-PW-Zone2.timer");
  });

  it("refuses a cron that is not once a day and installs nothing, rather than dispatching at a wrong time", () => {
    const { run, sudo } = clocking({ "collod873/Mezzanine": callerWith("0 8 * * 1-5") });

    const ran = run();

    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("collod873/Mezzanine");
    expect(ran.stderr).toContain("0 8 * * 1-5");
    expect(sudo()).toBe("");
  });

  it("installs one machine clock every 15 minutes that dispatches each enrolled repo's reconcile and this repo's runner watch, each dispatch tried even when one before it fails", () => {
    const { run, sudo } = clocking({ "collod873/Mezzanine": callerWith("0 8 * * *") }, ["collod873/Mezzanine", "collod873/claude-workflow"]);

    const ran = run();

    expect(ran.stderr).toBe("");
    expect(ran.stdout).toContain("ship-clock: every 15 minutes the machine clock dispatches reconcile in collod873/Mezzanine, collod873/claude-workflow and the runner watch in collod873/claude-workflow");
    const written = sudo();
    expect(written).toContain("OnCalendar=*:0/15");
    expect(written).toMatch(/ExecStart=-\/\S+\/gh workflow run machine\.yml -R collod873\/Mezzanine -f ticket=0\n/);
    expect(written).toMatch(/ExecStart=-\/\S+\/gh workflow run machine\.yml -R collod873\/claude-workflow -f ticket=0\n/);
    expect(written).toMatch(/ExecStart=-\/\S+\/gh workflow run runner-watch\.yml -R collod873\/claude-workflow -f minutes=false\n/);
    expect(written).not.toContain("Lumaria");
    expect(written).toContain("machine-clock.timer");
  });
});
