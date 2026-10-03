import { describe, expect, it } from "vitest";
import { heard, marking } from "./scenarios.ts";

const STATE_BLUE = "1d76db";
const LANDING = "Up to date with main and next to merge; auto-merge fires once its checks pass";

describe("bin/mark leaves one state on a ticket and its open PR, so one look at either says where it is (#1055)", () => {
  it("sets the state, takes every other state, asked and needs-human off, and leaves the kind and wayfinder labels alone", () => {
    const marked = marking({ labels: { "811": ["ticket", "checking", "queued", "asked", "needs-human", "wayfinder:map"] } });

    expect(heard(marked.run("811", "building"))).toEqual({ status: 0, stderr: "", lines: ["mark: #811 is at building"] });
    expect(marked.labels("811")).toEqual(["building", "ticket", "wayfinder:map"]);
  });

  it("writes the same state, try and owner labels on the open PR whose head is ticket/<number>", () => {
    const marked = marking({ labels: { "811": ["ticket", "building", "try-2"], "900": ["checking", "needs-human", "wayfinder:pr"] }, pr: "900" });

    expect(heard(marked.run("811", "checking")).lines).toEqual(["mark: #811 is at checking, try-2, and so is PR #900"]);
    expect(marked.labels("811")).toEqual(["checking", "ticket", "try-2"]);
    expect(marked.labels("900")).toEqual(["checking", "try-2", "wayfinder:pr"]);
  });

  it("raises the try label by one with --try and never leaves two", () => {
    const first = marking({ labels: { "811": ["ticket", "checking"] } });
    const again = marking({ labels: { "811": ["ticket", "checking", "try-2"], "900": ["checking", "try-2"] }, pr: "900" });

    expect(first.run("811", "building", "--try").status).toBe(0);
    expect(first.labels("811")).toEqual(["building", "ticket", "try-2"]);
    expect(again.run("811", "building", "--try").status).toBe(0);
    expect(again.labels("811")).toEqual(["building", "ticket", "try-3"]);
    expect(again.labels("900")).toEqual(["building", "try-3"]);
  });

  it("lowers the try label by one with --untry, so a flake rerun takes back the try it was counted", () => {
    const third = marking({ labels: { "811": ["ticket", "building", "try-3"] } });
    const second = marking({ labels: { "811": ["ticket", "building", "try-2"] } });
    const none = marking({ labels: { "811": ["ticket", "building"] } });

    expect(third.run("811", "checking", "--untry").status).toBe(0);
    expect(third.labels("811")).toEqual(["checking", "ticket", "try-2"]);
    expect(second.run("811", "checking", "--untry").status).toBe(0);
    expect(second.labels("811")).toEqual(["checking", "ticket"]);
    expect(none.run("811", "checking", "--untry").status).toBe(0);
    expect(none.labels("811")).toEqual(["checking", "ticket"]);
  });

  it("takes the try label off when a split parent is set waiting, since its build starts over once its pieces close", () => {
    const marked = marking({ labels: { "811": ["ticket", "building", "try-3"] } });

    expect(marked.run("811", "waiting").status).toBe(0);
    expect(marked.labels("811")).toEqual(["ticket", "waiting"]);
  });

  it("adds needs-human or asked beside the state on the ticket and its PR, removing nothing", () => {
    const stopped = marking({ labels: { "811": ["ticket", "building", "try-2"], "900": ["building", "try-2"] }, pr: "900" });
    const asked = marking({ labels: { "974": ["spec", "checking"] } });

    expect(heard(stopped.run("811", "needs-human")).lines).toEqual(["mark: #811 is at building, try-2, needs-human, and so is PR #900"]);
    expect(stopped.labels("811")).toEqual(["building", "needs-human", "ticket", "try-2"]);
    expect(stopped.labels("900")).toEqual(["building", "needs-human", "try-2"]);
    expect(asked.run("974", "asked").status).toBe(0);
    expect(asked.labels("974")).toEqual(["asked", "checking", "spec"]);
  });

  it("keeps a spec's try-2 from its fix wave's slicing through building, checking and asked, and clears asked once it checks again (#1064)", () => {
    const marked = marking({ labels: { "974": ["spec", "checking"] } });

    const steps: [string[], string[]][] = [
      [["slicing", "--try"], ["slicing", "spec", "try-2"]],
      [["building"], ["building", "spec", "try-2"]],
      [["checking"], ["checking", "spec", "try-2"]],
      [["asked"], ["asked", "checking", "spec", "try-2"]],
      [["checking"], ["checking", "spec", "try-2"]],
    ];
    for (const [label, held] of steps) {
      expect(marked.run("974", ...label).status).toBe(0);
      expect(marked.labels("974"), label.join(" ")).toEqual(held);
    }
  });

  it("with --closed strips every state, try and owner label from that issue or PR, and nothing else", () => {
    const marked = marking({ labels: { "811": ["ticket", "spec", "note", "research", "building", "try-3", "asked", "needs-human", "wayfinder:map"], "900": ["building"] }, pr: "900" });

    expect(heard(marked.run("811", "--closed")).lines).toEqual(["mark: #811 is closed, so it keeps only its kind"]);
    expect(marked.labels("811")).toEqual(["note", "research", "spec", "ticket", "wayfinder:map"]);
    expect(marked.labels("900")).toEqual(["building"]);
  });

  it("a research note reads researching while the researcher runs, and only its kind once it closes (#1065)", () => {
    const marked = marking({ labels: { "902": ["note", "research"] } });

    expect(marked.run("902", "researching").status).toBe(0);
    expect(marked.labels("902")).toEqual(["note", "research", "researching"]);
    expect(marked.run("902", "--closed").status).toBe(0);
    expect(marked.labels("902")).toEqual(["note", "research"]);
  });

  it("makes a label the repo lacks with its group's colour, and leaves one the repo has", () => {
    const marked = marking({ labels: { "811": ["ticket", "try-2"] }, repo: ["building"] });

    expect(marked.run("811", "waiting", "--try").status).toBe(2);
    expect(marked.run("811", "building", "--try").status).toBe(0);
    expect(marked.run("811", "needs-human").status).toBe(0);
    expect(marked.run("974", "asked").status).toBe(0);
    expect(marked.run("975", "waiting").status).toBe(0);
    expect(marked.run("976", "slicing").status).toBe(0);
    expect(marked.made()).toEqual(["building ededed", "try-3 f66a0a", "needs-human b60205", "asked 5319e7", "waiting fbca04", `slicing ${STATE_BLUE}`]);
  });

  it("describes landing as next to merge while its checks still run, since it shows before the PR is green (#1074)", () => {
    const marked = marking();

    expect(marked.run("811", "landing").status).toBe(0);
    expect(marked.calls()).toContain(`label create landing --color ${STATE_BLUE} --description ${LANDING}`);
  });

  it("refuses the old stage labels and anything outside the set, and asks GitHub for nothing", () => {
    const marked = marking();

    for (const args of [["811", "2-building"], ["811", "fixing"], ["811", "needs-human", "--try"], ["811", "--closed", "--try"], ["811", "building", "--again"], ["ticket", "building"], ["811"]]) {
      expect(heard(marked.run(...args)).status, args.join(" ")).toBe(2);
    }
    expect(marked.calls()).toEqual([]);
  });

  it("names in its usage line the states and owner labels bin/spelled prints, so the refusal lists what it would take (#1100)", () => {
    const { stderr } = marking().run("811", "fixing");

    expect(stderr).toBe(
      "mark: usage: mark <number> <building|checking|queued|resolving|landing|slicing|researching|waiting> [--try|--untry] | mark <number> <asked|needs-human> | mark <number> --closed\n",
    );
  });

  it("still marks the issue and succeeds when its token may not read PRs, so a caller's next step still runs, and names the refusal (#1077)", () => {
    const marked = marking({ labels: { "974": ["spec", "checking"] }, gh: "[[ $1 == pr ]] && { printf 'HTTP 403: Resource not accessible by integration\\n' >&2; exit 1; }\n" });

    expect(heard(marked.run("974", "needs-human"))).toEqual({ status: 0, stderr: "mark: #974's open PR not labelled needs-human: HTTP 403: Resource not accessible by integration\n", lines: ["mark: #974 is at checking, needs-human"] });
    expect(marked.labels("974")).toEqual(["checking", "needs-human", "spec"]);
  });

  it("says in one line why GitHub refused the label", () => {
    const marked = marking({ gh: "printf 'HTTP 403: Resource not accessible by integration\\n' >&2\nexit 1\n" });

    expect(marked.run("811", "building")).toEqual({
      status: 1,
      stdout: "",
      stderr: "mark: #811 not labelled building: HTTP 403: Resource not accessible by integration\n",
    });
  });
});
