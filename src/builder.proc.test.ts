import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HANDS_BACK } from "./builder.ts";
import { ownerHooks } from "./fence.ts";
import { building, FULL_CHECK_RED_ONCE, heard, plant, scratch, writesOutsideRepo } from "./scenarios.ts";

const BUILDS = "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts\n";
const GREEN_ONCE_BUILT = [
  "if grep -q 'shaped = 2' src/ticket-shape.ts; then printf '      Tests  1 passed (1)\\n'; exit 0; fi",
  "printf ' FAIL  src/ticket-shape.test.ts > names the behaviour\\n      Tests  1 failed (1)\\n'",
  "exit 1",
  "",
].join("\n");

const RETRIES_ONCE_THEN_BUILDS = [
  "if [ -f ../retried ]; then",
  BUILDS.trimEnd(),
  "else",
  "touch ../retried",
  "printf 'the model overloaded\\n' >&2",
  "exit 1",
  "fi",
  "",
].join("\n");

const after = (argv: string, flag: string) => argv.split("\n")[argv.split("\n").indexOf(flag) + 1];

function fenceSays(argv: string, input: string) {
  const { hooks } = JSON.parse(after(argv, "--settings")) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] } };
  const [bash] = hooks.PreToolUse.filter(({ matcher }) => matcher === "Bash");
  return spawnSync("bash", ["-c", bash.hooks[0].command], { input, encoding: "utf8" });
}

const asking = (command: unknown) => JSON.stringify({ tool_name: "Bash", tool_input: { command } });

const WRITES_UNCLAIMED_FILE = [
  "printf 'export const shaped = 2;\\n' >src/ticket-shape.ts",
  "printf 'export const helper = 1;\\n' >src/unclaimed-helper.ts",
  "",
].join("\n");

const WRITES_ONLY_UNCLAIMED_FILE = "printf 'export const helper = 1;\\n' >src/unclaimed-helper.ts\n";

const GREEN_WHILE_FILE_PRESENT = [
  "if [ -f src/unclaimed-helper.ts ]; then printf '      Tests  1 passed (1)\\n'; exit 0; fi",
  "printf ' FAIL  src/ticket-shape.test.ts > names the behaviour\\n      Tests  1 failed (1)\\n'",
  "exit 1",
  "",
].join("\n");

describe("the builder builds against the brief, and every red is handed back to it, resumed, up to 3 rounds (#725, #898)", () => {
  it("resumes its own session for each of 3 rounds handed back, handed the check's output tail capped at 8 KB", () => {
    const head = "HEAD-OF-CHECK-OUTPUT";
    const tail = "TAIL-OF-CHECK-OUTPUT";
    const npx = [
      `printf '%s' '${head}'`,
      "printf 'x%.0s' {1..50000}",
      `printf '%s\\n' '${tail}'`,
      "printf '      Tests  1 failed (1)\\n'",
      "exit 1",
      "",
    ].join("\n");
    const { run, calls, argv, stdin, sessionId } = building({ npx });

    const result = run();

    expect(heard(result).status).toBe(1);
    expect(calls()).toBe(4);
    for (const round of [2, 3, 4]) expect(argv(round)).toContain(`--resume\n${sessionId}`);
    expect(stdin(4)).toContain(tail);
    expect(stdin(4)).not.toContain(head);
    expect((stdin(4).match(/x/g) ?? []).length).toBeLessThan(50000);
  });

  it("hands back a red full bin/check with its log when the ticket's own checks pass, and ends green once it passes", () => {
    const { run, calls, stdin } = building({ claude: BUILDS, npx: GREEN_ONCE_BUILT, check: FULL_CHECK_RED_ONCE });

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("green after 1 of 3 rounds handed back")] });
    expect(calls()).toBe(2);
    expect(stdin(2)).toContain("OTHER-TEST-BROKE in src/stops.test.ts");
  });

  it("shows the builder bin/check in its brief and tells it the machine hands back anything red", () => {
    const { run, stdin } = building();

    run();

    expect(stdin(1)).toContain("### bin/check");
    expect(stdin(1)).toContain(HANDS_BACK);
  });

  it("hands the model a permission mode that lets it write a path under .claude/, so a ticket claiming one is built instead of refused", () => {
    const { run, argv } = building();

    run();

    expect(argv(1)).toContain("--permission-mode\nbypassPermissions");
  });

  it("ends red naming the path when the model writes a file outside the repo", () => {
    const outside = join(scratch("outside-"), "secret.txt");
    const { run } = building({ claude: writesOutsideRepo(outside) });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(outside);
  });

  it("lets its shell run its check commands and the static gates", () => {
    const { run, argv } = building();

    const result = run();

    expect(heard(result).status).toBe(1);
    expect(fenceSays(argv(1), asking("npx vitest run --config vitest.config.ts ticket-shape")).status).toBe(0);
    expect(fenceSays(argv(1), asking("bin/check static")).status).toBe(0);
    expect(fenceSays(argv(1), asking("bin/check")).status).toBe(0);
    expect(fenceSays(argv(1), asking("~/bin/check")).status).toBe(0);
  });

  it("fences its shell to its own commands, which the permission mode alone would not, and says which ones it may run", () => {
    const { run, argv } = building();

    run();

    const refused = fenceSays(argv(1), asking("touch unlisted-marker"));
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain("bin/check static");
    expect(after(argv(1), "--tools")).toBe("Read,Edit,Write,Grep,Glob,Bash");
  });

  it("refuses a shell command its fence cannot read, rather than let it through", () => {
    const { run, argv } = building();

    run();

    expect(fenceSays(argv(1), asking(42)).status).toBe(2);
    expect(fenceSays(argv(1), "what a broken hook call looks like").status).toBe(2);
  });

  it("commits what it built on the ticket branch and ends green on one call when the checks pass", () => {
    const { run, calls, committed, dirty } = building({ claude: BUILDS, npx: GREEN_ONCE_BUILT });

    const result = run();

    expect(heard(result)).toEqual({ status: 0, stderr: "", lines: [expect.stringContaining("#724 green")] });
    expect(calls()).toBe(1);
    expect(committed()).toEqual([expect.stringContaining("#724"), "src/ticket-shape.ts"]);
    expect(dirty()).toBe("");
  });

  it("calls its model once more when its process itself exits non-zero, not a session it must resume (#862)", () => {
    const { run, calls, argv } = building({ claude: RETRIES_ONCE_THEN_BUILDS, npx: GREEN_ONCE_BUILT });

    const result = run();

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("#724 green");
    expect(calls()).toBe(2);
    expect(argv(2)).not.toContain("--resume");
  });

  it("keeps every round's transcript in the machine logs, so whoever clears a red build can read what the model did", () => {
    const { run, session, sessionId } = building();

    run();

    const transcript = readFileSync(join(session, ".git", "machine-logs", "build-724.jsonl"), "utf8");
    expect(transcript.split(sessionId)).toHaveLength(5);
  });

  it("writes the transcript while the model is still running, so a run killed mid-stage still leaves what the model did", () => {
    const { run, session } = building({ claude: "printf '{\"session_id\":\"live-%s\"}\\n' $$\ngrep -q \"live-$$\" .git/machine-logs/build-724.jsonl || touch ../buffered" });

    run();

    expect(readFileSync(join(session, ".git", "machine-logs", "build-724.jsonl"), "utf8")).toContain("live-");
    expect(existsSync(join(session, "..", "buffered"))).toBe(false);
  });

  it("stops the model and everything it started at the stage's cap, which GitHub's own step cap never reached (#835)", () => {
    const { run, session } = building({ extra: { STAGE_MINUTES: "0.03" }, claude: "sleep 300 &\nprintf '%s' $! >../child\nwait" });
    const started = Date.now();

    const result = run();

    expect(Date.now() - started).toBeLessThan(15000);
    expect(result.stderr).toContain("ran past its 0.03 minute cap");
    const child = readFileSync(join(session, "..", "child"), "utf8");
    const state = existsSync(`/proc/${child}/stat`) ? readFileSync(`/proc/${child}/stat`, "utf8").split(") ")[1][0] : "gone";
    expect(["gone", "Z"]).toContain(state);
  });

  it("runs the owner's edit-time hooks and check-gate beside its fence, and no other hook that would hold the model from stopping", () => {
    const registered = (name: string, matcher?: string) => ({ ...(matcher === undefined ? {} : { matcher }), hooks: [{ type: "command", command: `python3 "/agent-hooks/hooks/${name}.py"` }] });
    const settings = join(scratch("agent-hooks-"), "settings.json");
    writeFileSync(settings, JSON.stringify({ hooks: { PreToolUse: [registered("no-prose", "Write|Edit"), registered("background-launch", "Bash")], Stop: [registered("check-gate")], SessionEnd: [registered("session-capture")], PostToolUse: [registered("post-edit-validate", "Edit")] } }));
    const { run, argv } = building({ extra: { AGENT_HOOKS_SETTINGS: settings } });

    run();

    const handed = after(argv(1), "--settings");
    expect(handed).toContain("hooks/no-prose.py");
    expect(handed).toContain("hooks/post-edit-validate.py");
    expect(handed).toContain("hooks/session-capture.py");
    expect(handed).toContain("hooks/check-gate.py");
    expect(handed).not.toContain("background-launch");
    expect(fenceSays(argv(1), asking("touch unlisted-marker")).status).toBe(2);
  });

  it("ends red rather than run without the owner's hooks when their registration cannot be read", () => {
    const { run, calls } = building({ extra: { AGENT_HOOKS_SETTINGS: join(scratch("agent-hooks-"), "missing.json") } });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("missing.json");
    expect(calls()).toBe(0);
  });

  it("keeps check-gate from a stage not gated on bin/check, since the test author's static check is red by design", () => {
    const gate = { Stop: [{ hooks: [{ command: 'python3 "/agent-hooks/hooks/check-gate.py"' }] }] };

    expect(ownerHooks(gate)).toEqual({});
    expect(ownerHooks(gate, true)).toEqual(gate);
  });

  it("commits a build still red after its 3 rounds handed back, so the save step has it to push", () => {
    const { run, calls, committed } = building({ claude: BUILDS });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("still red after 3 of 3 rounds handed back");
    expect(calls()).toBe(4);
    expect(committed()).toEqual([expect.stringContaining("#724"), "src/ticket-shape.ts"]);
  });

  it("spends no model on a branch that carries no test from the author", () => {
    const { run, calls } = building({ tests: {} });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no failing test");
    expect(calls()).toBe(0);
  });

  it("spends no model on a tree holding work nobody committed", () => {
    const { run, calls, session } = building();
    plant(session, "left-behind.txt", "work nobody committed\n");

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("uncommitted");
    expect(calls()).toBe(0);
  });

  it("undoes any change to the author's tests, whatever tool made it, and names the test it restored", () => {
    const { run, session, committed } = building({ claude: `${BUILDS}printf 'it.skip("gone", () => {});\\n' >src/ticket-shape.test.ts\n`, npx: GREEN_ONCE_BUILT });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("src/ticket-shape.test.ts");
    expect(readFileSync(join(session, "src", "ticket-shape.test.ts"), "utf8")).not.toContain("it.skip");
    expect(committed()).toEqual([expect.stringContaining("#724"), "src/ticket-shape.ts"]);
  });

  it("sets aside a file the ticket does not claim", () => {
    const { run, committed } = building({ claude: WRITES_UNCLAIMED_FILE, npx: GREEN_ONCE_BUILT });

    const result = run();

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("src/unclaimed-helper.ts");
    expect(committed()).toEqual([expect.stringContaining("#724"), "src/ticket-shape.ts"]);
  });

  it("needed a file the ticket does not claim", () => {
    const { run } = building({ claude: WRITES_ONLY_UNCLAIMED_FILE, npx: GREEN_WHILE_FILE_PRESENT });

    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/unclaimed-helper.ts");
  });
});
