import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { affectedSlices, testsForCriteria, type ExistingTestCriterion, type SliceRef } from "../shared/affected-tests";
import { execGh, type GhExec } from "../shared/gh";
import { subIssuesPath } from "../shared/gh-paths";
import { execGit, type GitExec } from "../shared/git";
import { reason } from "../shared/reason";
import { execClaude, runStage, type StageExec } from "../shared/stage";
import { structuredOutput } from "../shared/structured-output";
import {
  CRITERIA_HEADING_RE,
  extractCriteria,
  extractFilesClaimed,
  parentPrdNumber,
  readTicket,
  type TicketRead,
} from "../shared/ticket-shape";
import {
  landingFromEnv,
  runPushGate,
  runVitestJson,
  type Landing,
  type PushGateOutcome,
  type TestRunResult,
} from "./push-gate";

/**
 * Lane: author acceptance tests from the spec alone.
 *
 * One Opus stage (§3: being subtly wrong here is expensive and invisible —
 * a criterion the author silently drops is a hole in coverage nobody sees
 * until the ticket that was supposed to close it turns out not to) reads a
 * ticket's `## Acceptance criteria` and its parent PRD, and writes one test
 * file per criterion under `tests/acceptance/`. `push-gate.ts` is the other
 * half: it decides whether what the author wrote is trustworthy enough to
 * land unattended.
 *
 * The author never opens a pull request — `authorAcceptanceTests` touches
 * only `StageExec` and the filesystem, and the one `GhExec` call this lane
 * makes is a read (`issue view`), never a write. Landing is `push-gate.ts`'s
 * job, straight onto `main`.
 */

/** §3: authoring a test from the spec alone is exactly the low-volume, high-consequence case. */
export const AUTHOR_MODEL = "claude-opus-5";

export const AUTHOR_PROMPT_PATH = ".Workflow/agent-workflows/acceptance/author/prompt.md";

/** Every acceptance test this lane writes lives under here. `push-gate.ts` refuses anything outside it. */
export const ACCEPTANCE_TEST_DIR = "tests/acceptance/";

const AuthoredFile = z.object({
  /** Repo-relative, always under `ACCEPTANCE_TEST_DIR`. */
  path: z.string().min(1),
  content: z.string().min(1),
});
/** One file the author wrote. Returned as well as written, so the gate judges the answer itself. */
export type AuthoredFile = z.infer<typeof AuthoredFile>;

const AuthorAnswer = z.object({
  files: z.array(AuthoredFile).min(1),
});
type AuthorAnswer = z.infer<typeof AuthorAnswer>;

/** The author's structured-output contract (`shared/structured-output.ts`). */
export const AUTHOR_OUTPUT = structuredOutput(AuthorAnswer);

export interface AuthorDeps {
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  ticket: TicketRead;
  /** The parent PRD's body, when the ticket names one — the other half of "from the spec alone". */
  prdBody?: string;
  /**
   * Reads one repo-relative file, `undefined` when it does not exist yet — the ordinary
   * case for a slice whose whole job is to create the file it claims. Defaults to a real
   * filesystem read.
   */
  readFile?: (path: string) => string | undefined;
  /**
   * Lists the file names directly under `ACCEPTANCE_TEST_DIR`. Defaults to a real directory read,
   * and is empty on a checkout where no acceptance test has landed yet.
   */
  listTestDir?: () => string[];
}

/** What a file that does not exist yet is shown as. */
export const CLAIMED_FILE_ABSENT = "(does not exist yet — this ticket creates it)";

/** Shown in place of the section when the ticket claims no files at all. */
export const NO_CLAIMED_FILES = "(this ticket claims no files)";

/** Shown in place of the section when nothing shared has been factored out yet. */
export const NO_SHARED_FILES = "(nothing shared lives there yet — you would be writing the first)";

/**
 * The suffix that makes a file under `ACCEPTANCE_TEST_DIR` a suite rather than something a suite
 * imports — `vitest.config.ts`'s include glob, spelled once here.
 */
const TEST_SUFFIX = ".test.ts";

/**
 * Everything under `ACCEPTANCE_TEST_DIR` that is not itself a suite: the readers already factored
 * out of tests this lane wrote on an earlier run, which a test it writes now may import instead of
 * restating.
 *
 * The author needs these for the same reason ADR-0098 gave it its claimed files, one level along.
 * It writes one file per criterion in a single answer, so several criteria about one workflow used
 * to mean several copies of one reader — three copies with three different bugs, on #201, two of
 * which are what made the landed tests wrong. `bin/clone-gate` reports that as clones on every
 * authoring run, and a baseline cannot absorb it: each run hashes differently, so the baseline
 * would grow forever and stop measuring anything (ADR-0056).
 *
 * The other tests are deliberately not shown. What the author needs is what it may *reuse*; a
 * sibling suite is neither reusable nor a shape it has to match, and showing every test this lane
 * has ever written would grow the prompt without bound.
 */
export function sharedTestFiles(listDir: () => string[] = listTestDirIfPresent): string[] {
  return listDir()
    .filter((name) => !name.endsWith(TEST_SUFFIX))
    .sort()
    .map((name) => `${ACCEPTANCE_TEST_DIR}${name}`);
}

/**
 * A set of files rendered as the files themselves rather than as a list of paths
 * ([ADR-0098](../../../docs/adr/0098-the-acceptance-author-is-shown-the-files-its-ticket-claims-r.md)).
 *
 * One rendering serves both sections the author is shown — its ticket's `## Files claimed`, and the
 * shared readers under `ACCEPTANCE_TEST_DIR` — because they are the same act: put the file's real
 * text in front of the model instead of its name. `whenEmpty` is the only thing that differs, and
 * it has to: *this ticket claims no files* and *nothing shared exists yet* are different facts, and
 * an empty fenced block would read as a third one.
 *
 * Lane 04's first production run is what asked for this: authoring #201's four tests blind, the
 * model wrote a YAML mini-parser matching `^on\s*:` against a file that writes `"on":` — quoted,
 * because YAML 1.1 reads a bare `on` as `true` — and a second test asserting the word `acceptance`
 * appears in a workflow job that by construction never names an event type. Two of four tests were
 * wrong, and both were wrong about a file's concrete shape rather than about the criterion.
 *
 * **Inlined, not handed over as a tool.** The stage keeps no toolbelt at all, so "reads its claimed
 * files and nothing else" stays a fact about what reached the prompt rather than a line the model
 * was asked to honour — the same reasoning
 * [ADR-0030](../../../docs/adr/0030-the-shaper-is-given-a-prepared-context-and-no-search-tools.md)
 * applies to lane 01's shaper. An allow list of `Read` would have given it the whole repository.
 *
 * Uncapped, deliberately: a truncated file is the half-seen state this exists to remove, and a
 * model shown two thirds of a workflow guesses about the last third exactly as it did about all of
 * it. The bound is the slice's own claim, which lane 03 already sizes to one session.
 */
export function renderFiles(
  paths: string[],
  readFile: (path: string) => string | undefined,
  whenEmpty: string,
): string {
  if (paths.length === 0) return whenEmpty;
  return paths
    .map((path) => {
      const content = readFile(path);
      if (content === undefined) return `### ${path}\n\n${CLAIMED_FILE_ABSENT}`;
      return `### ${path}\n\n\`\`\`\n${content}\n\`\`\``;
    })
    .join("\n\n");
}

/** `readFile`'s default: the file's text, or `undefined` when it is not there yet. */
function readIfPresent(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/** `listTestDir`'s default: the names under `ACCEPTANCE_TEST_DIR`, empty when it does not exist. */
function listTestDirIfPresent(): string[] {
  try {
    return readdirSync(ACCEPTANCE_TEST_DIR);
  } catch {
    return [];
  }
}

/**
 * Runs the author stage and writes what it returns under
 * `ACCEPTANCE_TEST_DIR`, returning the paths written (in the order the
 * model listed them).
 *
 * Throws — without writing anything — when the ticket declares no
 * acceptance criteria, or when the model names a path outside
 * `ACCEPTANCE_TEST_DIR`: a test written wherever the model felt like isn't
 * this lane's to place, and `push-gate.ts` never gets a chance to refuse it
 * either, since nothing here has committed it yet.
 */
export async function authorAcceptanceTests(deps: AuthorDeps): Promise<AuthoredFile[]> {
  const criteria = extractCriteria(deps.ticket.body);
  if (criteria.length === 0) {
    throw new Error(
      `issue #${deps.issueNumber} declares no acceptance criteria under ${CRITERIA_HEADING_RE.source}`,
    );
  }

  const answer = await runStage(
    AUTHOR_PROMPT_PATH,
    {
      ISSUE_NUMBER: String(deps.issueNumber),
      ISSUE_TITLE: deps.ticket.title,
      ISSUE_BODY: deps.ticket.body,
      PRD_BODY: deps.prdBody ?? "(no parent PRD)",
      TEST_DIR: ACCEPTANCE_TEST_DIR,
      CLAIMED_FILES: renderFiles(
        extractFilesClaimed(deps.ticket.body),
        deps.readFile ?? readIfPresent,
        NO_CLAIMED_FILES,
      ),
      SHARED_FILES: renderFiles(
        sharedTestFiles(deps.listTestDir ?? listTestDirIfPresent),
        deps.readFile ?? readIfPresent,
        NO_SHARED_FILES,
      ),
    },
    deps.exec,
    AUTHOR_OUTPUT,
    { model: AUTHOR_MODEL, promptViaStdin: true, stage: "author" },
  );

  for (const file of answer.files) {
    if (!file.path.startsWith(ACCEPTANCE_TEST_DIR)) {
      throw new Error(`author wrote outside ${ACCEPTANCE_TEST_DIR}: ${file.path}`);
    }
  }

  for (const file of answer.files) {
    deps.writeFile(file.path, file.content);
  }

  return answer.files;
}

export interface RunAcceptanceDeps {
  gh: GhExec;
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  /** Runs the freshly written suite for `push-gate.ts` to classify. Defaults to a real vitest run over `ACCEPTANCE_TEST_DIR`. */
  runTests?: () => TestRunResult | Promise<TestRunResult>;
  /** Lints the freshly written files for the gate to refuse on (ADR-0102). Defaults to a real eslint run over them. */
  lint?: (paths: string[]) => string | null;
  git?: GitExec;
  /** Passed through to the gate. `"commit"` when a `contents: write` job does the push (ADR-0091). */
  landing?: Landing;
}

/**
 * The whole authoring flow, end to end: read the ticket (and its parent PRD,
 * when it names one), author the tests, and hand what was written to
 * `push-gate.ts`. Never opens a PR — `readTicket` is the only `GhExec` call
 * anywhere in this function, and it is a read.
 */
export async function runAcceptanceAuthor(deps: RunAcceptanceDeps): Promise<PushGateOutcome> {
  const ticket = readTicket(deps.gh, deps.issueNumber);
  const prdNumber = parentPrdNumber(ticket.body);
  const prd = prdNumber === undefined ? undefined : readTicket(deps.gh, prdNumber);

  const files = await authorAcceptanceTests({
    exec: deps.exec,
    writeFile: deps.writeFile,
    issueNumber: deps.issueNumber,
    ticket,
    prdBody: prd?.body,
  });
  const paths = files.map((file) => file.path);

  return runPushGate({
    runTests: deps.runTests ?? (() => runVitestJson(ACCEPTANCE_TEST_DIR)),
    lint: deps.lint,
    // The gate reads what the author actually returned rather than re-opening the files it just
    // wrote: same bytes, one fewer thing that can be true of the disk and false of the answer.
    readSource: (path) => files.find((file) => file.path === path)?.content ?? "",
    git: deps.git ?? execGit,
    paths,
    commitMessage: authorCommitMessage(deps.issueNumber, paths),
    landing: deps.landing,
  });
}

/**
 * Every sub-issue number attached under `prdNumber` — a slice this spec was cut into. Reads the
 * same `subIssuesPath` `publish-sub-issues.ts` writes and `lost-dispatch-counter.ts` counts, so a
 * fourth spelling of that path never has to exist.
 */
function readSliceNumbers(gh: GhExec, prdNumber: number): number[] {
  const raw = gh(["api", subIssuesPath(prdNumber)]);
  const issues = JSON.parse(raw) as Array<{ number: number }>;
  return issues.map((issue) => issue.number);
}

export interface RefireDeps {
  gh: GhExec;
  /** The spec issue that was just edited — a PRD, carrying `prd`. */
  prdNumber: number;
  /** Called once per affected slice, in ascending slice-number order — the re-fire itself. */
  authorForSlice: (sliceNumber: number) => void | Promise<void>;
  /** Where existing acceptance tests live. Defaults to `ACCEPTANCE_DIR`. */
  testsDir?: string;
}

/**
 * ADR-0033's re-entry trigger, end to end: read the edited spec and every slice it was cut into,
 * find which of each slice's own criteria an existing test in `testsDir` already proves
 * (`testsForCriteria`, one slice's criteria at a time — so a criterion no slice's test has ever
 * proved contributes nothing to the diff), hand that record to `affectedSlices`, and call
 * `deps.authorForSlice` once per slice it names.
 *
 * Nothing here re-authors a slice whose criteria are all still present, and nothing here reacts
 * to a criterion newly added to the spec with no existing test — both are exactly what
 * `affectedSlices` refuses to do, on the record this function builds for it.
 */
export async function refireAcceptance(deps: RefireDeps): Promise<SliceRef[]> {
  const prd = readTicket(deps.gh, deps.prdNumber);
  const sliceNumbers = readSliceNumbers(deps.gh, deps.prdNumber);

  const existingTests: ExistingTestCriterion[] = [];
  for (const sliceNumber of sliceNumbers) {
    const slice = readTicket(deps.gh, sliceNumber);
    for (const criterion of extractCriteria(slice.body)) {
      if (testsForCriteria([criterion], deps.testsDir).length > 0) {
        existingTests.push({ sliceNumber, criterion });
      }
    }
  }

  const affected = affectedSlices(prd.body, existingTests);
  for (const { sliceNumber } of affected) {
    await deps.authorForSlice(sliceNumber);
  }
  return affected;
}

/** CLAUDE.md: why, not what. */
function authorCommitMessage(issueNumber: number, paths: string[]): string {
  return `Author acceptance tests for #${issueNumber} from the spec alone

Nobody has implemented #${issueNumber} yet, so these are expected to fail —
that's what makes them acceptance tests rather than a report on working code.
${paths.map((path) => `- ${path}`).join("\n")}

Part of #162`;
}

function fsWriteFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

/**
 * `--refire`'s per-slice call: re-runs the same authoring flow `main()`'s single-issue mode does,
 * against the affected slice, and throws when it refuses — a re-fire that silently drops a
 * refused slice would look identical to one that succeeded.
 *
 * Under `ACCEPTANCE_LANDING=commit` (ADR-0091's split, which is how `acceptance.yml` runs it) the
 * throw is also what makes a multi-slice re-fire all-or-nothing: the commits sit unpushed in the
 * model job's working tree, and the job that pushes them never starts. Under the old arrangement
 * the slices before the refusal had already landed on `main` individually.
 */
async function authorForSliceInProcess(sliceNumber: number): Promise<void> {
  const outcome = await runAcceptanceAuthor({
    gh: execGh,
    exec: execClaude,
    writeFile: fsWriteFile,
    issueNumber: sliceNumber,
    landing: landingFromEnv(),
  });
  if (outcome.verdict === "refused") {
    throw new Error(`refused for #${sliceNumber}: ${outcome.reason}`);
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === "--refire") {
    const prdArg = process.argv[3];
    if (!prdArg) {
      console.error("usage: acceptance.ts --refire <prd-issue-number>");
      process.exitCode = 1;
      return;
    }
    try {
      const affected = await refireAcceptance({
        gh: execGh,
        prdNumber: Number(prdArg),
        authorForSlice: authorForSliceInProcess,
      });
      console.log(
        affected.length === 0
          ? "no slice's test lost its criterion; nothing re-fired"
          : `re-fired acceptance for ${affected.length} slice(s): ${affected.map((s) => s.sliceNumber).join(", ")}`,
      );
    } catch (err) {
      console.error(`acceptance re-entry failed: ${reason(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  const issueArg = process.argv[2];
  if (!issueArg) {
    console.error("usage: acceptance.ts <issue-number>");
    process.exitCode = 1;
    return;
  }
  try {
    const landing = landingFromEnv();
    const outcome = await runAcceptanceAuthor({
      gh: execGh,
      exec: execClaude,
      writeFile: fsWriteFile,
      issueNumber: Number(issueArg),
      landing,
    });
    if (outcome.verdict === "refused") {
      console.error(`refused: ${outcome.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(landing === "commit" ? "committed" : "pushed");
  } catch (err) {
    console.error(`acceptance authoring failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
