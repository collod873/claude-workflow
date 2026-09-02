import { readFileSync } from "node:fs";
import { runTsDriver, subjectPath } from "./ts-driver.fixture";

/**
 * The reader #346's acceptance shares: it calls the real `watchdog/dead-lanes.ts` in a child
 * process and hands back what the signal actually says.
 *
 * **Why a child process.** Everything under `tests/acceptance/` is restored from trunk before CI
 * runs it, and only this directory is — so a test that imported the subject would reach through a
 * specifier the branch under test controls, and the lint rule here refuses it outright. The
 * subject is reached the way a shell reaches it instead: a generated driver, run from the
 * repository root, importing the module by an absolute path built at runtime. The pattern is
 * `238-reconcile-closer.fixture.ts`'s, reused rather than reinvented.
 *
 * **Why not assert on the source text.** Lane 04's own author was refused on this ticket for
 * writing a fixture that turned on a path no pull request may change, and the refusal's reason
 * generalises: an assertion about a file's bytes returns the same verdict whatever is built. What
 * a dead-lane signal *says* is behaviour, so it is called rather than read.
 */

const SENTINEL = "__ACCEPTANCE_346__";

/** One completed run, in the shape `dead-lanes.ts` reads. */
export interface FakeRun {
  path: string;
  name: string;
  id?: number;
}

/** What one call of the subject reports back. */
export interface SignalResult {
  title: string;
  body: string;
  marker: string;
  reusableHalf: string;
  callerHalf: string;
  error?: string;
}

const DRIVER_SOURCE = `
const SENTINEL = "${SENTINEL}";
const subject = process.env.ACCEPTANCE_SUBJECT;
const input = JSON.parse(process.env.ACCEPTANCE_INPUT || "{}");

const emit = (payload) => process.stdout.write("\\n" + SENTINEL + JSON.stringify(payload) + "\\n");

try {
  const mod = await import(subject);
  const run = {
    id: input.id ?? 1,
    name: input.name,
    path: input.path,
    status: "completed",
    conclusion: "failure",
    htmlUrl: "https://github.com/collod873/claude-workflow/actions/runs/" + (input.id ?? 1),
    headBranch: "main",
    createdAt: "2026-09-02T12:00:00Z",
    jobCount: 0,
  };
  const lane = { path: input.path, name: input.name, runs: [run] };
  emit({
    title: mod.signalTitle(lane),
    body: mod.signalBody(lane),
    marker: mod.signalMarker(input.path),
    reusableHalf: mod.reusableHalf(input.path),
    callerHalf: mod.callerHalf(input.path),
  });
} catch (err) {
  emit({ error: String((err && err.stack) || err) });
}
`;

/** The subject every call here reaches, as an absolute path built at runtime. */
const SUBJECT = subjectPath(".Workflow", "agent-workflows", "watchdog", "dead-lanes.ts");

/** Calls the subject against one dead run and returns everything the signal produced. */
export function signalFor(run: FakeRun): SignalResult {
  return runTsDriver<SignalResult>({
    source: DRIVER_SOURCE,
    sentinel: SENTINEL,
    prefix: "acceptance-346-",
    env: { ACCEPTANCE_SUBJECT: SUBJECT, ACCEPTANCE_INPUT: JSON.stringify(run) },
    failure: "could not call the dead-lane signal out of process",
  });
}

/** `watchdog/dead-lanes.ts`'s module docstring — everything above its first declaration. */
export function deadLanesDocstring(): string {
  const source = readFileSync(SUBJECT, "utf8");
  const firstDeclaration = source.search(/^export /m);
  return firstDeclaration === -1 ? source : source.slice(0, firstDeclaration);
}
