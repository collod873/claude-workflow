import { mkdirSync, writeFileSync } from "node:fs";
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
import { CRITERIA_HEADING_RE, CRITERIA_ITEM_RE, normalizeNewlines, sectionText } from "../shared/ticket-shape";
import { runPushGate, runVitestJson, type PushGateOutcome, type TestRunResult } from "./push-gate";

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

const AuthorAnswer = z.object({
  files: z.array(AuthoredFile).min(1),
});
type AuthorAnswer = z.infer<typeof AuthorAnswer>;

/** The author's structured-output contract (`shared/structured-output.ts`). */
export const AUTHOR_OUTPUT = structuredOutput(AuthorAnswer);

/**
 * One `## Parent PRD\n#<n>` heading, as `shared/render-body.ts` writes it on
 * every ticket this repo publishes. Read here rather than reused from there
 * because that module renders a body; this one only ever reads one back.
 */
const PARENT_PRD_RE = /^##[ \t]+Parent PRD[ \t]*\n#(\d+)/m;

/**
 * The criterion strings a ticket body declares under `## Acceptance
 * criteria`, in the body's own order — each with its leading `- [ ]` and
 * surrounding whitespace stripped, everything after that verbatim.
 *
 * Built from `CRITERIA_HEADING_RE`/`CRITERIA_ITEM_RE`
 * (`shared/ticket-shape.ts`) rather than a second parser: those two already
 * define what a criterion line looks like for `render-body.ts` and the close
 * gate, and a third definition here is exactly the drift that module's own
 * header warns about.
 */
export function extractCriteria(body: string): string[] {
  const normalized = normalizeNewlines(body);
  const section = sectionText(normalized, CRITERIA_HEADING_RE);
  return section
    .split("\n")
    .filter((line) => CRITERIA_ITEM_RE.test(line))
    .map((line) => line.replace(/^[ \t]*-[ \t]*\[[ xX]\][ \t]*/, "").trim());
}

/** The parent PRD's issue number, or `undefined` when the body carries none. */
export function parentPrdNumber(body: string): number | undefined {
  const match = PARENT_PRD_RE.exec(normalizeNewlines(body));
  return match ? Number(match[1]) : undefined;
}

export interface TicketRead {
  title: string;
  body: string;
}

/** Reads a ticket's title and body through `gh` — the one `GhExec` call this lane makes. */
export function readTicket(gh: GhExec, issueNumber: number): TicketRead {
  const raw = gh(["issue", "view", String(issueNumber), "--json", "title,body"]);
  return JSON.parse(raw) as TicketRead;
}

export interface AuthorDeps {
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  ticket: TicketRead;
  /** The parent PRD's body, when the ticket names one — the other half of "from the spec alone". */
  prdBody?: string;
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
export async function authorAcceptanceTests(deps: AuthorDeps): Promise<string[]> {
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
    },
    deps.exec,
    AUTHOR_OUTPUT,
    { model: AUTHOR_MODEL, promptViaStdin: true },
  );

  for (const file of answer.files) {
    if (!file.path.startsWith(ACCEPTANCE_TEST_DIR)) {
      throw new Error(`author wrote outside ${ACCEPTANCE_TEST_DIR}: ${file.path}`);
    }
  }

  for (const file of answer.files) {
    deps.writeFile(file.path, file.content);
  }

  return answer.files.map((file) => file.path);
}

export interface RunAcceptanceDeps {
  gh: GhExec;
  exec: StageExec;
  writeFile: (path: string, content: string) => void;
  issueNumber: number;
  /** Runs the freshly written suite for `push-gate.ts` to classify. Defaults to a real vitest run over `ACCEPTANCE_TEST_DIR`. */
  runTests?: () => TestRunResult | Promise<TestRunResult>;
  git?: GitExec;
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

  const paths = await authorAcceptanceTests({
    exec: deps.exec,
    writeFile: deps.writeFile,
    issueNumber: deps.issueNumber,
    ticket,
    prdBody: prd?.body,
  });

  return runPushGate({
    runTests: deps.runTests ?? (() => runVitestJson(ACCEPTANCE_TEST_DIR)),
    git: deps.git ?? execGit,
    paths,
    commitMessage: authorCommitMessage(deps.issueNumber, paths),
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
 */
async function authorForSliceInProcess(sliceNumber: number): Promise<void> {
  const outcome = await runAcceptanceAuthor({
    gh: execGh,
    exec: execClaude,
    writeFile: fsWriteFile,
    issueNumber: sliceNumber,
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
    const outcome = await runAcceptanceAuthor({
      gh: execGh,
      exec: execClaude,
      writeFile: fsWriteFile,
      issueNumber: Number(issueArg),
    });
    if (outcome.verdict === "refused") {
      console.error(`refused: ${outcome.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log("pushed");
  } catch (err) {
    console.error(`acceptance authoring failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
