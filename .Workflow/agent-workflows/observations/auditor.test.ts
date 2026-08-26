import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import { createFakeStage } from "../shared/stage.fake";
import { runAuditor, type AuditorOptions } from "./auditor";

/**
 * Every test in this file runs the auditor through `createFakeGit` and
 * `createFakeStage` — no test here ever spawns the real `git` or `claude`
 * binaries.
 */
function baseOptions(overrides: Partial<AuditorOptions> = {}): AuditorOptions {
  const fakeGit = createFakeGit(() => "+ a diff line");
  const fakeStage = createFakeStage("no violations found");
  return {
    git: fakeGit.git,
    exec: fakeStage.exec,
    repoDir: "/repo",
    base: "abc123",
    head: "def456",
    touchedPaths: ["a.ts"],
    spine: "the session's own spine",
    standards: "the ratified standards",
    ...overrides,
  };
}

describe("runAuditor", () => {
  it("spawns the sandboxed claude call with the flags the sandbox requires", async () => {
    const fakeStage = createFakeStage("no violations found");
    const options = baseOptions({ exec: fakeStage.exec });

    await runAuditor(options);

    expect(fakeStage.calls).toHaveLength(1);
    const [argv] = fakeStage.calls;
    expect(argv).toContain("--tools");
    expect(argv).toContain("--no-session-persistence");
    expect(argv).toContain("--strict-mcp-config");
    expect(argv).toContain("--disable-slash-commands");
    expect(argv).toContain("--setting-sources");
    // "--tools" and "--setting-sources" are both followed by an empty
    // string argument, so the argv carries exactly two "" entries.
    expect(argv.filter((arg) => arg === "")).toHaveLength(2);
  });

  it("places every sandbox flag immediately after -p <prompt>, in the order the sandbox spec names", async () => {
    const fakeStage = createFakeStage("no violations found");
    const options = baseOptions({ exec: fakeStage.exec });

    await runAuditor(options);

    const [argv] = fakeStage.calls;
    expect(argv[0]).toBe("-p");
    expect(argv.slice(2)).toEqual([
      "--model",
      "sonnet",
      "--output-format",
      "text",
      "--no-session-persistence",
      "--tools",
      "",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--setting-sources",
      "",
    ]);
  });

  it("embeds the scoped diff, the spine, and the standards in the prompt argument", async () => {
    const fakeGit = createFakeGit(() => "+ export const mine = 1;");
    const fakeStage = createFakeStage("no violations found");
    const options = baseOptions({
      git: fakeGit.git,
      exec: fakeStage.exec,
      spine: "session did X",
      standards: "entry: never do Y",
    });

    await runAuditor(options);

    const [argv] = fakeStage.calls;
    const prompt = argv[1];
    expect(prompt).toContain("+ export const mine = 1;");
    expect(prompt).toContain("session did X");
    expect(prompt).toContain("entry: never do Y");
  });

  it("threads repoDir, base, head, and touchedPaths to the git executor via sessionRangeDiff", async () => {
    const fakeGit = createFakeGit(() => "");
    const fakeStage = createFakeStage("no violations found");
    const options = baseOptions({
      git: fakeGit.git,
      exec: fakeStage.exec,
      repoDir: "/some/repo",
      base: "abc",
      head: "def",
      touchedPaths: ["x.ts"],
    });

    await runAuditor(options);

    expect(fakeGit.calls).toHaveLength(1);
    expect(fakeGit.calls[0]).toEqual(["-C", "/some/repo", "diff", "--no-color", "abc", "def", "--", "x.ts"]);
  });

  it("returns the sandboxed call's raw stdout unparsed", async () => {
    const fakeGit = createFakeGit(() => "");
    const fakeStage = createFakeStage('<output>["a violation"]</output>');
    const options = baseOptions({ git: fakeGit.git, exec: fakeStage.exec });

    const result = await runAuditor(options);

    expect(result).toBe('<output>["a violation"]</output>');
  });
});
