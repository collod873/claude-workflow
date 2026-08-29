import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { reason } from "./reason.ts";

/**
 * `actionlint` at the push venue, which is the venue that can still stop the failure.
 *
 * `verify.yml` has linted workflow files since #40, and its comment there says this check is "the
 * one that does not go through `bin/gauntlet`, deliberately" — a binary the free venues would have
 * to download, and C4's law that a mechanism needing a ritual dies by month three. That reasoning
 * held right up until the class of failure it guards turned out to be one CI cannot report.
 *
 * A broken workflow file is not a red check. GitHub cannot parse it, so it cannot schedule it, so
 * a `repository_dispatch` aimed at it lands on **nothing at all** — no run, no conclusion, nothing
 * for a reader to notice. #40 was thirteen pushes that way. It happened again on 2026-08-29:
 * `runner.temp` in `implement.yml`'s job-level `env:` block, pushed green past every local gate,
 * and lane 04's `ticket-ready` dispatch for #237 disappeared into a workflow GitHub had already
 * refused. CI did eventually go red — on the *next* push, in a step named `Lint workflow files`,
 * long after the dispatch it was supposed to protect was gone. Nothing re-sends a dispatch.
 *
 * So the check moves to where the repair is cheap (ADR-0010), and the ritual objection is answered
 * by not requiring one:
 *
 * **It runs only when `.github/workflows/` differs from trunk.** Trunk's copies were linted by CI
 * when they landed, so the only YAML this venue can say anything new about is YAML that has
 * changed. A push touching no workflow file needs no linter and no Docker — which is nearly every
 * push, and is why nobody has to install anything to keep working here.
 *
 * **When it cannot run, it says so rather than passing.** A missing Docker daemon returns
 * `unchecked`, which `bin/gauntlet` reports as a gauntlet that could not run (exit 2) rather than
 * as a clean tree. Refusing a push is the right answer in that case and a cheap one: you only ever
 * reach it by editing a workflow file, which is precisely the edit that has to be checked.
 *
 * The image is not spelled here. It is read out of `verify.yml`'s own `uses:` line, so the two
 * venues cannot drift onto different linter versions the way two hand-typed pins would.
 */

/** The workflow file that carries the pin both venues use. */
export const PIN_SOURCE = ".github/workflows/verify.yml";

/** The pathspec that decides whether this check has anything to say. */
export const WORKFLOWS_PATHSPEC = ".github/workflows";

/** What "already linted by CI" means: the tip of trunk, as this checkout last saw it. */
export const TRUNK_REF = "origin/main";

const IMAGE_RE = /docker:\/\/(rhysd\/actionlint:[0-9]+\.[0-9]+\.[0-9]+)/g;

/**
 * The linter image `verify.yml` pins, read off its `uses:` line.
 *
 * Exactly one distinct version, or this throws. Two would mean the repo has quietly grown a second
 * pin, and a reader picking either one is a coin flip between the version CI enforces and the
 * version it doesn't — the drift this whole function exists to make impossible.
 */
export function pinnedActionlintImage(verifySource: string): string {
  const found = [...new Set([...verifySource.matchAll(IMAGE_RE)].map((match) => match[1]))];
  if (found.length === 1) return found[0];
  if (found.length === 0) {
    throw new Error(`${PIN_SOURCE} names no docker://rhysd/actionlint image to run`);
  }
  throw new Error(`${PIN_SOURCE} names ${found.length} different actionlint pins: ${found.join(", ")}`);
}

/** One command's result, with a non-zero exit reported rather than thrown. */
export interface Ran {
  status: number;
  output: string;
}

/** The subprocess seam, so every branch below is reachable from a test without a Docker daemon. */
export type Run = (cmd: string, args: string[], cwd: string) => Ran;

/**
 * The production `Run`. Argv, never a shell string: this estate's own checkout path contains a
 * space, and it is passed straight through to `-v <root>:/repo` below, where a hand-built command
 * line would split it into two mount arguments.
 */
export const runCommand: Run = (cmd, args, cwd) => {
  try {
    const output = execFileSync(cmd, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
    });
    return { status: 0, output };
  } catch (err) {
    const status = typeof (err as { status?: unknown }).status === "number" ? (err as { status: number }).status : 127;
    return { status, output: reason(err) };
  }
};

/** What this check found — four outcomes, because "could not run" is not "clean" (bin/gauntlet:26-29). */
export type LintVerdict =
  | { verdict: "nothing-to-lint" }
  | { verdict: "clean" }
  | { verdict: "findings"; report: string }
  | { verdict: "unchecked"; why: string };

/**
 * Lints `root`'s workflow files, but only when they differ from `TRUNK_REF`.
 *
 * Every uncertainty resolves toward running the linter, never toward skipping it: a `git diff` that
 * fails — no `origin/main` in a fresh clone, a detached checkout that never fetched — is a question
 * this function could not answer, and the safe reading of "I don't know whether the workflows
 * changed" is to check them.
 *
 * Docker's reachability is probed separately, before the lint, because it has to be. A daemon that
 * is not running makes `docker run` exit **1**, which is the same code actionlint uses for "I found
 * something" — so without the probe, a stopped Docker Desktop would report itself as a workflow
 * defect and send whoever hit it looking for a bug in their YAML.
 */
export function lintChangedWorkflows(root: string, run: Run, readPin: () => string): LintVerdict {
  // A root with no workflow directory has no workflow files to be wrong about. Checked before the
  // diff rather than left to fall out of one, because every other branch below treats an
  // unanswerable question as a reason to lint, and "there is nothing here" is an answer.
  if (!existsSync(join(root, WORKFLOWS_PATHSPEC))) return { verdict: "nothing-to-lint" };

  const changed = run("git", ["diff", "--name-only", TRUNK_REF, "--", WORKFLOWS_PATHSPEC], root);
  if (changed.status === 0 && changed.output.trim() === "") return { verdict: "nothing-to-lint" };

  const daemon = run("docker", ["version", "--format", "{{.Server.Version}}"], root);
  if (daemon.status !== 0) {
    return {
      verdict: "unchecked",
      why: [
        "this push changes .github/workflows/ and no Docker daemon answered, so the workflow files",
        "were not linted. A workflow file GitHub cannot parse is not a red check — it is a lane that",
        "silently stops existing, and every dispatch aimed at it lands on nothing (#40).",
        "Start Docker and push again, or run the linter however you like and use --no-verify.",
        "",
        daemon.output.trim(),
      ].join("\n"),
    };
  }

  let image: string;
  try {
    image = pinnedActionlintImage(readPin());
  } catch (err) {
    return { verdict: "unchecked", why: reason(err) };
  }

  const lint = run("docker", ["run", "--rm", "-v", `${root}:/repo`, "--workdir", "/repo", image, "-color"], root);
  if (lint.status === 0) return { verdict: "clean" };
  if (lint.status === 1) return { verdict: "findings", report: lint.output };
  return { verdict: "unchecked", why: `${image} exited ${lint.status} rather than linting:\n${lint.output}` };
}

// --- CLI -------------------------------------------------------------------------------------
//
// `node workflow-lint.ts <root>`   0 clean or nothing to check, 1 findings, 2 could not check.
//                                  The three codes `bin/gauntlet` already distinguishes, and the
//                                  mode `bin/gauntlet push` runs.
//
// Guarded with `pathToFileURL(process.argv[1])`, never a hand-built `file://${argv[1]}` — the same
// defect #139 names, which loses percent-encoding on a path with a space and would make this guard
// silently never fire in this repo's own checkout.
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = process.argv[2] ?? process.cwd();
  const result = lintChangedWorkflows(root, runCommand, () => readFileSync(join(root, PIN_SOURCE), "utf8"));
  if (result.verdict === "findings") {
    console.log(result.report);
    process.exit(1);
  }
  if (result.verdict === "unchecked") {
    console.error(`workflow-lint: ${result.why}`);
    process.exit(2);
  }
  process.exit(0);
}
