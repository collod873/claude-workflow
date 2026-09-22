import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MINTED, minting, workflowSteps } from "./scenarios.ts";

const REPO = resolve(import.meta.dirname, "..");
const CHECK = ".github/workflows/core-check.yml";
const REFUSED = "printf '{\"message\":\"Not Found\"}\\n'\nexit 22\n";

describe("the stable check acts as the App, and fails red when its key is missing (#712)", () => {
  it("hands the minted token on, masked, and prints nothing else", () => {
    const session = minting();
    const { status, stdout, stderr } = session.run();

    expect(status).toBe(0);
    expect(stdout.trim()).toBe(`::add-mask::${MINTED}`);
    expect(stderr).toBe("");
    expect(session.handedOn().trim()).toBe(`GH_TOKEN=${MINTED}`);
  });

  it.each([
    ["CORE_APP_PRIVATE_KEY", { key: "" }],
    ["CORE_APP_CLIENT_ID", { id: "" }],
  ])("fails red with no %s, handing nothing on in its place", (missing, unset) => {
    const session = minting(unset);
    const { status, stdout, stderr } = session.run();

    expect(status).toBe(1);
    expect(stderr.trim().split("\n")).toEqual([expect.stringContaining(missing)]);
    expect(stdout).toBe("");
    expect(session.handedOn()).toBe("");
  });

  it("fails red when GitHub refuses the App, handing nothing on", () => {
    const session = minting({ curl: REFUSED });
    const { status, stderr } = session.run();

    expect(status).toBe(1);
    expect(stderr.trim().split("\n")).toHaveLength(1);
    expect(session.handedOn()).toBe("");
  });

  it("mints the token before bin/check runs, and never falls back to GITHUB_TOKEN", () => {
    const steps = workflowSteps(CHECK);
    const minted = steps.findIndex((step) => step.run?.includes("bin/app-token"));
    const checked = steps.findIndex((step) => step.run?.trim() === "bin/check");

    expect(minted).toBeGreaterThan(-1);
    expect(checked).toBeGreaterThan(minted);
    expect(steps[minted]?.env).toMatchObject({
      CORE_APP_CLIENT_ID: "${{ vars.CORE_APP_CLIENT_ID }}",
      CORE_APP_PRIVATE_KEY: "${{ secrets.CORE_APP_PRIVATE_KEY }}",
    });
    expect(readFileSync(join(REPO, CHECK), "utf8")).not.toMatch(/github\.token|secrets\.GITHUB_TOKEN/);
  });
});
