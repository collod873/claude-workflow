import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { stripComments } from "./273-shape.fixture";
import { commandLine, runVitest } from "./274-stage-names.fixture";
import { repoRoot } from "./workflow-shape.fixture";

/**
 * The readers #327's acceptance tests share.
 *
 * Not a `.test.ts`, so the acceptance include never collects it as a suite — it is only imported by
 * the eight test files beside it.
 *
 * It exists because #327's criteria fall into two groups that each ask one question repeatedly.
 * Four of them read the lane's own source ("is this name in the code, or only in a comment?"), and
 * three close on the same `npx vitest run .Workflow/agent-workflows/enrol/enrol.test.ts` the ticket
 * names as their check. Written into each file that would be four directory walks and three
 * spawn-and-report helpers to get subtly different from each other — the divergence this directory's
 * fixture convention exists to prevent, and which `bin/clone-gate` reports on push.
 *
 * Nothing here imports outward. The comment stripper already lives next door in
 * `273-shape.fixture.ts` and the vitest runner in `274-stage-names.fixture.ts`, so both are imported
 * rather than restated — the same reason this file exists at all.
 *
 * **Why comments are stripped before a source is read.** The criteria are about what the lane
 * *does*. A docstring in `enrol.ts` may perfectly well quote the setting it writes or explain which
 * secrets today's derivation happens to yield, and a reader that counted that sentence would be red
 * for a reason having nothing to do with the ticket. What is left after stripping is the code, which
 * is where a hard-coded manifest would have to live.
 *
 * A missing file reads as `""` rather than as an exception, so a criterion about a file the ticket
 * has not created yet comes back red on its own assertion instead of throwing on the read.
 */

/** The directory #327 claims — `.Workflow/agent-workflows/enrol/**`. */
export const ENROL_DIR = path.join(repoRoot, ".Workflow", "agent-workflows", "enrol");

/** The lane's entrypoint, the file three of the criteria's own checks name. */
export const ENROL_SOURCE = path.join(ENROL_DIR, "enrol.ts");

/** The same file spelled the way the criteria's checks spell it — relative to the checkout root. */
export const ENROL_SOURCE_RELATIVE = ".Workflow/agent-workflows/enrol/enrol.ts";

/** The lane's own suite, as three criteria's `npx vitest run` argument spells it. */
export const ENROL_TEST_RELATIVE = ".Workflow/agent-workflows/enrol/enrol.test.ts";

export const ENROL_TEST_SOURCE = path.join(ENROL_DIR, "enrol.test.ts");

/** The document criterion 7 is about. */
export const ENROLMENT_DOC = path.join(repoRoot, "docs", "agents", "enrolment.md");
export const ENROLMENT_DOC_RELATIVE = "docs/agents/enrolment.md";

/** A file's text, or `""` when it is not there. */
export function readIfPresent(file: string): string {
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/**
 * `"present"` when a file exists, and a sentence naming it when it does not — so an assertion about
 * a missing file prints the path rather than an empty-string diff.
 */
export function presence(relative: string, absolute: string): string {
  return existsSync(absolute) ? "present" : `${relative} does not exist`;
}

/** One file under the lane's directory, with the text a `grep -r` would be reading. */
export interface LaneFile {
  /** Path relative to the checkout root, with forward slashes. */
  relative: string;
  absolute: string;
  text: string;
}

/** Every file under `enrol/`, recursively and in path order; empty while the lane does not exist. */
export function laneFiles(): LaneFile[] {
  const found: string[] = [];

  const walk = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(full);
    }
  };

  walk(ENROL_DIR);

  return found.sort().map((absolute) => ({
    absolute,
    relative: path.relative(repoRoot, absolute).split(path.sep).join("/"),
    text: readIfPresent(absolute),
  }));
}

/** `enrol.ts` as it stands on disk, comments and all — what the criteria's own `grep` reads. */
export function enrolSource(): string {
  return readIfPresent(ENROL_SOURCE);
}

/**
 * Every non-test TypeScript file under `enrol/`, comments removed and concatenated.
 *
 * Every file rather than `enrol.ts` alone because the ticket claims the whole directory: a lane that
 * puts its derivation in `enrol/secrets.ts` is still the lane, and a reader that only ever looked at
 * the entrypoint would go red on a faithful implementation.
 */
export function laneCode(): string {
  return laneFiles()
    .filter((file) => file.relative.endsWith(".ts") && !file.relative.endsWith(".test.ts"))
    .map((file) => stripComments(file.text))
    .join("\n");
}

/** `docs/agents/enrolment.md`, or `""` while it does not exist. */
export function enrolmentDoc(): string {
  return readIfPresent(ENROLMENT_DOC);
}

/**
 * `""` when the lane's own suite is green, and the run when it is not.
 *
 * Three of #327's criteria name `npx vitest run .Workflow/agent-workflows/enrol/enrol.test.ts` as
 * their check, so the run-and-report is written once here. Reported as a string rather than thrown
 * so a red criterion prints the suite's own output, which is the only thing that says which
 * behaviour the lane got wrong.
 */
export function laneSuiteReport(): string {
  if (!existsSync(ENROL_TEST_SOURCE)) {
    return `${ENROL_TEST_RELATIVE} does not exist, so \`${commandLine([ENROL_TEST_RELATIVE])}\` cannot pass`;
  }
  const run = runVitest([ENROL_TEST_RELATIVE], 600_000);
  if (run.status === 0) return "";
  return `\`${commandLine([ENROL_TEST_RELATIVE])}\` exited ${String(run.status)}:\n${run.output}`;
}
