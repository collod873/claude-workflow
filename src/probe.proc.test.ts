import { describe, expect, it } from "vitest";
import { PROBE_RUN, probing } from "./probe.part.ts";
import { probeOutput, probeRunName } from "./probe.ts";

describe("a probe runs one command or prompt in a stage's real environment and ends, with no ticket (#1251)", () => {
  it("runs a script probe in the tree after the tree's own setup, on the tree's pinned PATH, keeps its output with the machine logs and ends with its status", () => {
    const probe = probing({ contract: '{ "setup": "printf \'readied\\\\n\' >readied" }', treePath: { node: "printf 'tree node\\n'\n" } });

    const ended = probe.run("script", "cat readied; node; exit 3");

    expect(ended.status).toBe(3);
    expect(ended.stdout).toBe(`probe: the script probe ended 3; its output is in ${ended.stdout.split(" in ").at(-1)}`);
    expect(probe.kept()).toBe("readied\ntree node\n");
  });

  it("probes nothing and ends red when the tree's setup fails, keeping why", () => {
    const probe = probing({ contract: '{ "setup": "printf \'lockfile out of date\\\\n\' >&2; exit 1" }' });

    const ended = probe.run("script", "touch probed");

    expect(ended.status).toBe(1);
    expect(ended.stderr).toMatch(/^probe: the tree's setup failed, so nothing was probed: .*lockfile out of date/);
    expect(probe.kept()).toBe("lockfile out of date");
  });

  it("hands a claude probe its prompt alone through the builder's own launch, keeping the transcript and the answer with the machine logs", () => {
    const probe = probing({ said: "check took 6.2s" });

    const ended = probe.run("claude", "Run ~/bin/check and say how long it took");

    expect(ended.status, ended.stderr).toBe(0);
    expect(probe.handed()).toBe("Run ~/bin/check and say how long it took");
    expect(probe.hired()).toEqual(expect.arrayContaining(["--print", "--model", "opus", "--setting-sources", "project", "--permission-mode", "bypassPermissions"]));
    expect(probe.hired()).not.toContain("--tools");
    expect(probe.transcripts()).toEqual([`probe-${PROBE_RUN}.jsonl`]);
    expect(probe.kept()).toBe("check took 6.2s");
  });

  it("ends a claude probe red when its session does, keeping why", () => {
    const probe = probing({ claudeEnds: 1 });

    const ended = probe.run("claude", "Commit a change and see the hook fire");

    expect(ended.status).toBe(1);
    expect(ended.stderr).toMatch(/^probe: the claude probe stopped: the probe ended 1/);
    expect(probe.kept()).toMatch(/^the probe ended 1/);
  });

  it("dispatches a probe to a repo's caller file, finds its run by name, waits for it and points at its output", () => {
    const probe = probing();

    const ended = probe.dispatch("script", "~/bin/check");

    expect(ended.status, ended.stderr).toBe(0);
    expect(probe.calls()[0]).toEqual(["workflow", "run", "machine.yml", "--repo", "collod873/Lumaria", "-f", "ticket=0", "-f", "reason=probe", "-f", "probe=~/bin/check", "-f", "probe_with=script"]);
    expect(probe.calls().map((call) => call.slice(0, 2).join(" "))).toEqual(["workflow run", "run list", "run watch", "run view", "run download"]);
    expect(ended.stdout).toMatch(new RegExp(`^probe: https://github.com/collod873/Lumaria/actions/runs/${PROBE_RUN} ended success; its output is in /.*/${probeOutput(PROBE_RUN)}\\n$`));
  });

  it("ends red when the probe's run does, or when no run names the probe", () => {
    expect(probing({ concluded: "failure" }).dispatch("script", "~/bin/check").stderr).toMatch(/ended failure; its output is in \//);
    expect(probing({ concluded: "failure", keptOutput: false }).dispatch("script", "~/bin/check").stderr).toMatch(/its output is in nowhere, as the run kept no probe output\n$/);
    const unlisted = probing({ listed: false }).dispatch("claude", "Say hi");
    expect(unlisted.status).toBe(1);
    expect(unlisted.stderr).toBe("probe: no run of machine.yml in collod873/Lumaria named the probe after 24 looks\n");
  });

  it("names its run as the caller file's run name does", () => {
    expect(probeRunName("claude", "Say hi")).toBe("Probe (claude): Say hi");
  });
});
