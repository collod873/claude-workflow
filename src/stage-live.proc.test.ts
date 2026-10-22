import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scratch } from "./scenarios.ts";
import { hired } from "./stage.ts";

const CLAUDE = `#!/usr/bin/env node
const { writeFileSync } = require("fs");
writeFileSync("argv.json", JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({ type: "result", result: "done" }));
`;

function onThisPc(): string {
  const root = scratch("stage-live-");
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin", "claude"), CLAUDE);
  chmodSync(join(root, "bin", "claude"), 0o755);
  vi.stubEnv("PATH", `${join(root, "bin")}:${process.env.PATH}`);
  vi.stubEnv("STAGE_MINUTES", undefined);
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("a stage runs as the owner's own session does (ADR-0011)", () => {
  it("loads the owner's settings beside the repo's, on the model it was hired on, with full access", () => {
    const root = onThisPc();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      hired({ name: "reviewer", model: "opus", transcript: join(root, "transcript.jsonl") })("review it");

      const argv = JSON.parse(readFileSync(join(root, "argv.json"), "utf8")) as string[];
      expect(argv[argv.indexOf("--setting-sources") + 1]).toBe("user,project");
      expect(argv[argv.indexOf("--model") + 1]).toBe("opus");
      expect(argv[argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
      expect(argv).not.toContain("--tools");
      expect(argv).not.toContain("--add-dir");
    } finally {
      process.chdir(cwd);
    }
  });

  it("leaves every prompt it was handed beside its transcript, so the machine logs show what each round was told", () => {
    const root = onThisPc();
    const cwd = process.cwd();
    process.chdir(root);
    try {
      const stage = hired({ name: "builder", model: "opus", transcript: join(root, "fix-7.jsonl") });
      stage("# Ticket #7\n\nbuild it");
      stage("## How it failed\n\ncheck: red unit");

      const handed = readFileSync(join(root, "fix-7.handed.md"), "utf8");
      expect(handed).toContain("# Ticket #7\n\nbuild it");
      expect(handed).toContain("## How it failed\n\ncheck: red unit");
    } finally {
      process.chdir(cwd);
    }
  });
});
