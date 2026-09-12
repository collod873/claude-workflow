import { describe, expect, it } from "vitest";
import { NEEDS_HUMAN_LABEL } from "../shared/needs-human";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "../shared/ready-set";
import {
  authoredSomethingToLand,
  landAuthoredBatch,
  landingFailedNote,
  PUSH_ATTEMPTS,
  siblingLandedFirstNote,
  type AuthoringResults,
  type LandDeps,
  type LandRequest,
} from "./land";

const RUN_URL = "https://github.com/collod873/claude-workflow/actions/runs/9";

interface Harness {
  deps: LandDeps;
  gh: string[][];
  git: string[][];
  slept: number[];
}

function harness(over: Partial<LandDeps> = {}): Harness {
  const gh: string[][] = [];
  const git: string[][] = [];
  const slept: number[] = [];
  return {
    gh,
    git,
    slept,
    deps: {
      gh: (args) => {
        gh.push([...args]);
        return "";
      },
      git: (args) => {
        git.push([...args]);
        return "";
      },
      download: () => undefined,
      patchesIn: () => ["/tmp/acceptance-patches/0001-author.patch"],
      gate: () => ({ ok: true }),
      sleep: async (seconds) => {
        slept.push(seconds);
      },
      log: () => undefined,
      ...over,
    },
  };
}

function refusing(refuse: (args: string[]) => boolean, over: Partial<LandDeps> = {}): Harness {
  const seen: string[][] = [];
  return harness({
    git: (args) => {
      seen.push([...args]);
      if (refuse(args)) throw new Error(`git ${args.join(" ")} refused`);
      return "";
    },
    ...over,
  });
}

function results(over: Partial<AuthoringResults> = {}): AuthoringResults {
  return { refireResult: "skipped", refireAuthored: "", authorResult: "success", authorAuthored: "true", ...over };
}

function request(over: Partial<LandRequest> = {}): LandRequest {
  return {
    eventAction: ACCEPTANCE_WANTED_DISPATCH_ACTION,
    results: results(),
    ticket: 412,
    ready: true,
    alreadyRefired: false,
    patchDir: "/tmp/acceptance-patches",
    runUrl: RUN_URL,
    ...over,
  };
}

const dispatches = (gh: string[][]) => gh.filter((args) => args[1] === "repos/{owner}/{repo}/dispatches");
const subcommands = (git: string[][]) => git.map((args) => args[0]);

describe("#519: the land job reads what the authoring jobs ended as, instead of a job condition", () => {
  it.each(["failure", "cancelled", "skipped"])("does not land when the author %s, whatever it claims to have authored", (result) => {
    expect(authoredSomethingToLand(results({ authorResult: result, authorAuthored: "true" }))).toBe(false);
  });

  it("does not land when the author succeeded without authoring anything", () => {
    expect(authoredSomethingToLand(results({ authorAuthored: "" }))).toBe(false);
  });

  it("lands what the author authored", () => {
    expect(authoredSomethingToLand(results())).toBe(true);
  });

  it("lands what the re-fire authored, on the door where the author never ran", () => {
    expect(
      authoredSomethingToLand(results({ refireResult: "success", refireAuthored: "true", authorResult: "skipped", authorAuthored: "" })),
    ).toBe(true);
  });

  it("does not land when both jobs ran and neither authored", () => {
    expect(authoredSomethingToLand(results({ refireResult: "success", authorAuthored: "" }))).toBe(false);
  });
});

describe("#519: the land job's own steps are the lane's error path", () => {
  it("touches neither the repo nor the tracker when nothing was authored", async () => {
    const { deps, gh, git } = harness();
    expect(await landAuthoredBatch(deps, request({ results: results({ authorAuthored: "" }) }))).toEqual({ outcome: "nothing-authored" });
    expect([...gh, ...git]).toEqual([]);
  });

  it("replays, gauntlets and pushes, then tells lane 05 the slice is ready", async () => {
    const { deps, gh, git } = harness();
    expect(await landAuthoredBatch(deps, request())).toEqual({ outcome: "landed" });
    expect(subcommands(git)).toEqual(["am", "fetch", "rebase", "fetch", "rebase", "push"]);
    expect(dispatches(gh)[0]).toContain(`event_type=${TICKET_READY_DISPATCH_ACTION}`);
  });

  it("says nothing to lane 05 when the slice that landed was not marked ready", async () => {
    const { deps, gh } = harness();
    expect(await landAuthoredBatch(deps, request({ ready: false }))).toEqual({ outcome: "landed" });
    expect(dispatches(gh)).toEqual([]);
  });

  it("says nothing to lane 05 for a re-fire, which publishes no new slice", async () => {
    const { deps, gh } = harness();
    const refire = request({ eventAction: "edited", results: results({ refireResult: "success", refireAuthored: "true" }) });
    expect(await landAuthoredBatch(deps, refire)).toEqual({ outcome: "landed" });
    expect(dispatches(gh)).toEqual([]);
  });

  it("refuses an artifact that carried no patch, rather than replaying nothing and calling it landed", async () => {
    const { deps } = harness({ patchesIn: () => [] });
    expect((await landAuthoredBatch(deps, request())).outcome).toBe("needs-human");
  });

  it("re-authors once when a sibling's batch landed first and the replay conflicted", async () => {
    const { deps, gh } = refusing((args) => args[0] === "am");
    expect((await landAuthoredBatch(deps, request())).outcome).toBe("re-authored");
    expect(gh.some((args) => args.includes(siblingLandedFirstNote(RUN_URL)))).toBe(true);
    expect(dispatches(gh)[0]).toEqual(expect.arrayContaining([`event_type=${ACCEPTANCE_WANTED_DISPATCH_ACTION}`, "client_payload[refire]=1"]));
  });

  it("re-authors when the rebase onto the main that moved conflicts, not only the replay", async () => {
    const { deps, gh } = refusing((args) => args[0] === "rebase");
    expect((await landAuthoredBatch(deps, request())).outcome).toBe("re-authored");
    expect(dispatches(gh)[0]).toContain(`event_type=${ACCEPTANCE_WANTED_DISPATCH_ACTION}`);
  });

  it("waits for a human on a second conflict, rather than re-authoring forever", async () => {
    const { deps, gh } = refusing((args) => args[0] === "am");
    expect((await landAuthoredBatch(deps, request({ alreadyRefired: true }))).outcome).toBe("needs-human");
    expect(gh.some((args) => args.includes(landingFailedNote(RUN_URL)))).toBe(true);
    expect(gh.some((args) => args.includes(NEEDS_HUMAN_LABEL))).toBe(true);
    expect(dispatches(gh)).toEqual([]);
  });

  it("waits for a human on a red gate, which is not a conflict another author round would fix", async () => {
    const { deps, gh } = harness({ gate: () => ({ ok: false, output: "1 failed" }) });
    expect((await landAuthoredBatch(deps, request())).outcome).toBe("needs-human");
    expect(dispatches(gh)).toEqual([]);
  });

  it("retries a lost push race, and lands when one of the retries wins", async () => {
    let pushes = 0;
    const { deps, slept } = harness({
      git: (args) => {
        if (args[0] === "push" && ++pushes < 3) throw new Error("rejected: non-fast-forward");
        return "";
      },
    });
    expect(await landAuthoredBatch(deps, request())).toEqual({ outcome: "landed" });
    expect(slept).toEqual([5, 10]);
  });

  it("waits for a human when main moved under every push attempt, which is not a conflict", async () => {
    const { deps, gh, slept } = refusing((args) => args[0] === "push");
    expect((await landAuthoredBatch(deps, request())).outcome).toBe("needs-human");
    expect(slept).toHaveLength(PUSH_ATTEMPTS);
    expect(dispatches(gh)).toEqual([]);
  });

  it("says nothing on any ticket when a re-fire fails, the one door that never had a ticket of its own", async () => {
    const { deps, gh } = refusing((args) => args[0] === "am", {});
    const refire = request({ eventAction: "edited", ticket: Number.NaN, results: results({ refireResult: "success", refireAuthored: "true" }) });
    expect((await landAuthoredBatch(deps, refire)).outcome).toBe("unreported");
    expect(gh).toEqual([]);
  });
});
