import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

/**
 * ADR-0045: `bin/new-adr --amends NNNN` writes the machine-readable `Amends:`
 * trailer the back-stamp and missing-trailer counter both read. Its one
 * requirement beyond that is silence: invoking the tool with no flag must
 * stay byte-for-byte what it already was, because every existing call site
 * (and every existing ADR) depends on that shape not moving.
 *
 * `bin/new-adr` derives its `docs/adr` location from its own script path
 * (`dirname "${BASH_SOURCE[0]}"/..`), not from `cwd` — so a scratch run needs
 * a scratch `bin/`, not just a scratch `docs/adr`. `makeScratchRepo` gives
 * every case that shape.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const NEW_ADR = join(REPO_ROOT, "bin/new-adr");

/** Captured from `bin/new-adr` before this ticket's change (`git show <pre-amends>:bin/new-adr`). */
const PRE_AMENDS_FIXTURE = join(REPO_ROOT, ".Workflow/agent-workflows/shared/new-adr-pre-amends.fixture.sh");

/** A repo-shaped scratch dir: `<root>/bin/new-adr` copied from `scriptPath`, so the script's own
 * `dirname/..` resolution lands `docs/adr` inside `<root>`, never in the real repo. */
function makeScratchRepo(prefix: string, scriptPath: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(root, "bin"));
  writeFileSync(join(root, "bin/new-adr"), readFileSync(scriptPath, "utf8"), { mode: 0o755 });
  return root;
}

/**
 * Runs `<root>/bin/new-adr` with the given argv and returns the created file's contents.
 * `EDITOR`/`VISUAL` are stripped so a set editor never `exec`s over the test and hangs it —
 * `bin/new-adr` opens the created file in `$EDITOR` when one is set.
 */
function runNewAdr(root: string, args: string[]): string {
  const env = { ...process.env };
  delete env.EDITOR;
  delete env.VISUAL;
  const createdPath = execFileSync(join(root, "bin/new-adr"), args, { cwd: root, encoding: "utf8", env }).trim();
  return readFileSync(createdPath, "utf8");
}

describe("bin/new-adr", () => {
  let scratch: string | undefined;

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
    scratch = undefined;
  });

  it("--amends 8 writes an Amends: ADR-0008 trailer into the created file", () => {
    scratch = makeScratchRepo("new-adr-amends-", NEW_ADR);

    const created = runNewAdr(scratch, ["--amends", "8", "a title"]);

    expect(created).toContain("Amends: ADR-0008");
  });

  // The no-flag path must not move. Rather than pin a dated string that goes stale the day after
  // it's captured, this runs the pre-change script and today's script side by side, same title, same
  // day, and asserts their outputs are byte-identical — which is what "unchanged" means for a file
  // whose contents include today's date.
  it("with no flag produces byte-identical output to the pre-change fixture", () => {
    const before = makeScratchRepo("new-adr-before-", PRE_AMENDS_FIXTURE);
    const after = makeScratchRepo("new-adr-after-", NEW_ADR);

    const beforeOutput = runNewAdr(before, ["a title"]);
    const afterOutput = runNewAdr(after, ["a title"]);

    rmSync(before, { recursive: true, force: true });
    scratch = after;

    expect(afterOutput).toBe(beforeOutput);
  });
});
