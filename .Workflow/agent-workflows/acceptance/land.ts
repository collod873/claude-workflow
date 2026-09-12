import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "../shared/gh";
import { execGit, type GitExec } from "../shared/git";
import { sayOnTicket } from "../shared/implementation-landing";
import { escalateToOwner } from "../shared/needs-human";
import { dispatchAcceptanceWanted, dispatchTicketReady } from "../shared/ready-set";
import { reason } from "../shared/reason";
import { gateOutputTail, gateVerdict, type GateVerdict } from "../shared/run-gauntlet";
import { authorsPublishedSlice } from "./doors";

export const PATCH_ARTIFACT = "acceptance-commits";

export const PUSH_ATTEMPTS = 5;

export const PUSH_BACKOFF_SECONDS = 5;

const STALLED_OUTCOMES = new Set<LandingOutcome["outcome"]>(["needs-human", "unreported"]);

export interface AuthoringResults {
  refireResult: string;
  refireAuthored: string;
  authorResult: string;
  authorAuthored: string;
}

export function authoredSomethingToLand(results: AuthoringResults): boolean {
  return (
    (results.refireResult === "success" && results.refireAuthored === "true") ||
    (results.authorResult === "success" && results.authorAuthored === "true")
  );
}

export class ReplayConflict extends Error {
  constructor(why: string) {
    super(why);
    this.name = "ReplayConflict";
  }
}

export function siblingLandedFirstNote(runUrl: string): string {
  return (
    "The authored tests were judged green, but a sibling's batch landed on main first and replaying " +
    "them conflicted, so the author runs once more against the main that moved. A second conflict " +
    `waits for a human. Run: ${runUrl}`
  );
}

export function landingFailedNote(runUrl: string): string {
  return (
    "The authored tests were judged green in the author job, but landing them on main failed, so " +
    `nothing landed and this ticket is waiting on a human. Run: ${runUrl}`
  );
}

export interface LandDeps {
  gh: GhExec;
  git: GitExec;
  download: (dir: string) => void;
  patchesIn: (dir: string) => string[];
  gate: () => GateVerdict;
  sleep: (seconds: number) => Promise<void>;
  log: (line: string) => void;
}

export interface LandRequest {
  eventAction: string;
  results: AuthoringResults;
  ticket: number;
  ready: boolean;
  alreadyRefired: boolean;
  patchDir: string;
  runUrl: string;
}

export type LandingOutcome =
  | { outcome: "nothing-authored" }
  | { outcome: "landed" }
  | { outcome: "re-authored"; why: string }
  | { outcome: "needs-human"; why: string }
  | { outcome: "unreported"; why: string };

function conflicting<T>(work: () => T): T {
  try {
    return work();
  } catch (err) {
    throw new ReplayConflict(reason(err));
  }
}

function replayOntoMain(git: GitExec, patches: string[]): void {
  conflicting(() => git(["am", "--3way", ...patches]));
  git(["fetch", "origin", "main"]);
  conflicting(() => git(["rebase", "origin/main"]));
}

async function pushToMain(deps: LandDeps): Promise<void> {
  for (let attempt = 1; attempt <= PUSH_ATTEMPTS; attempt++) {
    deps.git(["fetch", "origin", "main"]);
    conflicting(() => deps.git(["rebase", "origin/main"]));
    try {
      deps.git(["push", "origin", "HEAD:main"]);
      return;
    } catch (err) {
      deps.log(`push ${attempt} of ${PUSH_ATTEMPTS} lost the race: ${reason(err)}`);
    }
    await deps.sleep(attempt * PUSH_BACKOFF_SECONDS);
  }
  throw new Error(`main moved under all ${PUSH_ATTEMPTS} push attempts`);
}

function reportLandingFailure(deps: LandDeps, request: LandRequest, err: unknown): LandingOutcome {
  const why = reason(err);

  if (!authorsPublishedSlice(request.eventAction)) {
    deps.log(`landing failed on the re-fire door, which has no one ticket to say so on: ${why}`);
    return { outcome: "unreported", why };
  }

  if (err instanceof ReplayConflict && !request.alreadyRefired) {
    sayOnTicket(deps.gh, request.ticket, siblingLandedFirstNote(request.runUrl), deps.log);
    dispatchAcceptanceWanted(deps.gh, request.ticket, request.ready, true);
    return { outcome: "re-authored", why };
  }

  escalateToOwner(deps.gh, request.ticket, undefined);
  sayOnTicket(deps.gh, request.ticket, landingFailedNote(request.runUrl), deps.log);
  return { outcome: "needs-human", why };
}

export async function landAuthoredBatch(deps: LandDeps, request: LandRequest): Promise<LandingOutcome> {
  if (!authoredSomethingToLand(request.results)) return { outcome: "nothing-authored" };

  try {
    deps.download(request.patchDir);
    const patches = deps.patchesIn(request.patchDir);
    if (patches.length === 0) throw new Error(`the ${PATCH_ARTIFACT} artifact carried no patch to replay`);
    replayOntoMain(deps.git, patches);

    const verdict = deps.gate();
    if (!verdict.ok) throw new Error(`the gate is red on the replayed batch:\n${gateOutputTail(verdict.output)}`);

    await pushToMain(deps);
  } catch (err) {
    return reportLandingFailure(deps, request, err);
  }

  if (authorsPublishedSlice(request.eventAction) && request.ready) dispatchTicketReady(deps.gh, request.ticket);
  return { outcome: "landed" };
}

function patchesOnDisk(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".patch"))
    .sort()
    .map((name) => join(dir, name));
}

async function main(): Promise<void> {
  const repoDir = process.env.TARGET_WORKSPACE || process.cwd();
  const patchDir = join(process.env.RUNNER_TEMP || repoDir, "acceptance-patches");

  const outcome = await landAuthoredBatch(
    {
      gh: execGh,
      git: (args) => execGit(["-C", repoDir, ...args]),
      download: (dir) => execGh(["run", "download", process.env.GITHUB_RUN_ID ?? "", "-n", PATCH_ARTIFACT, "-D", dir]),
      patchesIn: patchesOnDisk,
      gate: () => gateVerdict(repoDir),
      sleep: (seconds) => new Promise((resolve) => setTimeout(resolve, seconds * 1000)),
      log: (line) => console.log(line),
    },
    {
      eventAction: process.env.EVENT_ACTION || "",
      results: {
        refireResult: process.env.REFIRE_RESULT || "",
        refireAuthored: process.env.REFIRE_AUTHORED || "",
        authorResult: process.env.AUTHOR_RESULT || "",
        authorAuthored: process.env.AUTHOR_AUTHORED || "",
      },
      ticket: Number(process.env.TICKET_NUMBER),
      ready: process.env.READY === "1",
      alreadyRefired: process.env.REFIRED === "1",
      patchDir,
      runUrl: process.env.RUN_URL || "",
    },
  );

  console.log(outcome.outcome === "landed" ? "landed" : `${outcome.outcome}: ${"why" in outcome ? outcome.why : "nothing was authored"}`);
  if (STALLED_OUTCOMES.has(outcome.outcome)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
