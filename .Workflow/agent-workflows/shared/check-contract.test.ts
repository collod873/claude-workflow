import { describe, expect, it } from "vitest";
import { parseCheckSlots, readCheckContract, renderCheckContractSection } from "./check-contract";

const CONTRACT = JSON.stringify({
  stop: { cmd: "bin/gauntlet stop", why: ".claude/hooks/gauntlet.sh#check-command" },
  all: { cmd: "npm run check", why: "package.json#scripts.check" },
});

describe("parseCheckSlots", () => {
  it("reads this repo's own check contract", () => {
    expect(parseCheckSlots(readCheckContract()).map((slot) => slot.name)).toContain("all");
  });

  it("keeps the contract's own slot order, so the brief reads as the file does", () => {
    expect(parseCheckSlots(CONTRACT).map((slot) => slot.name)).toEqual(["stop", "all"]);
  });

  it("drops a slot nulled to shrink the gate rather than reporting a command the runner will not run", () => {
    expect(parseCheckSlots(JSON.stringify({ clones: null, all: { cmd: "npm run check" } }))).toEqual([
      { name: "all", cmd: "npm run check", why: "" },
    ]);
  });

  it("reads an absent contract as no slots, never as a gate that runs nothing", () => {
    expect(parseCheckSlots(undefined)).toEqual([]);
  });

  it("reads an unparseable contract as no slots rather than throwing inside the brief", () => {
    expect(parseCheckSlots("{ not json")).toEqual([]);
  });
});

describe("renderCheckContractSection", () => {
  it("names each slot, its command, and where the command is declared", () => {
    expect(renderCheckContractSection(CONTRACT)).toBe(
      [
        "- `stop`: `bin/gauntlet stop` — .claude/hooks/gauntlet.sh#check-command",
        "- `all`: `npm run check` — package.json#scripts.check",
      ].join("\n"),
    );
  });

  it("names a slot carrying no declaration site by command alone", () => {
    expect(renderCheckContractSection(JSON.stringify({ all: { cmd: "npm run check" } }))).toBe("- `all`: `npm run check`");
  });

  it("renders the brief's placeholder when the target carries no contract", () => {
    expect(renderCheckContractSection(undefined)).toBe("(none)");
  });
});
