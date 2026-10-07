import { spawnSync } from "node:child_process";
import { CALLER_FILE, commentOnTicket, gh, ghRead, heldOn, labelsHeld, machineBin, OWNER, readOrStop, STUCK, unread } from "./post.ts";
import { OWNER_CALL } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";

const stoppedAt = stopsOf({ unrerun: "Rerun: GitHub refuses to re-run a red run's failed jobs" });
type Stop = ReturnType<typeof stoppedAt>;

interface Job {
  id: number;
  conclusion: string | null;
}

interface Annotation {
  title: string | null;
  message: string;
}

interface Call {
  issue: string;
  run: string;
  ended: string;
}

const OUT_OF_TIME = /exceeded the maximum execution time/;
const CALLED = /^(\d+) (.+)$/;
const STOPPED = new Set(["failure", "timed_out", "cancelled"]);
const WAIT_SECONDS = Number(process.env.RERUN_WAIT_SECONDS ?? "30");

function parsed<Read>(text: string, line: string): Read {
  try {
    return JSON.parse(text) as Read;
  } catch {
    return unread(line);
  }
}

function callsOf(run: string, attempt: string): Call[] {
  const line = `the jobs of run ${run} could not be read, so nothing is re-run or marked`;
  const { jobs } = parsed<{ jobs: Job[] }>(ghRead(["api", `repos/{owner}/{repo}/actions/runs/${run}/attempts/${attempt}/jobs?per_page=100`], line), line);
  return jobs.flatMap((job) => {
    if (!STOPPED.has(job.conclusion ?? "")) return [];
    const said = `the annotations of job ${job.id} could not be read, so nothing is re-run or marked`;
    const annotations = parsed<Annotation[]>(ghRead(["api", `repos/{owner}/{repo}/check-runs/${job.id}/annotations?per_page=100`], said), said);
    const outOfTime = job.conclusion === "timed_out" || annotations.some(({ message }) => OUT_OF_TIME.test(message));
    if (job.conclusion === "cancelled" && !outOfTime) return [];
    return annotations.flatMap(({ title, message }) => {
      const [, issue, named] = (title === OWNER_CALL && CALLED.exec(message)) || [];
      return issue === undefined || named === undefined ? [] : [{ issue, run: named, ended: outOfTime ? "ran out of time" : "ended red" }];
    });
  });
}

const firstLine = (got: ReturnType<typeof gh>) => (got.stderr || got.stdout).trim().split("\n")[0] ?? "";

function callOwner(call: Call, url: string, attempt: string): void {
  const held = heldOn(labelsHeld(call.issue, gh));
  if (held !== undefined) {
    console.log(`rerun: #${call.issue} is labelled ${held}, so nothing is marked or posted`);
    return;
  }
  if (spawnSync(machineBin("mark"), [call.issue, STUCK], { stdio: ["ignore", "ignore", "inherit"] }).status !== 0) gh(["issue", "edit", call.issue, "--add-label", STUCK]);
  const text = [
    `@${OWNER} ${call.run} ${call.ended} twice, so #${call.issue} is labelled \`${STUCK}\`.`,
    `The machine re-ran it once by itself and it stopped again: the first run is ${url}/attempts/1 and the re-run is ${url}/attempts/${attempt}.`,
    `Look at the re-run to see what stopped it, and take \`${STUCK}\` off once the cause is fixed: that picks #${call.issue} up again.`,
  ].join(" ");
  const { refusals } = commentOnTicket(call.issue, text, gh);
  for (const refusal of refusals) console.error(`rerun: ${refusal}`);
  console.log(`rerun: #${call.issue} is labelled ${STUCK}, as ${call.run} ${call.ended} on its re-run`);
}

function waitFor(run: string, attempt: string): void {
  const line = `run ${run} could not be read, so nothing is re-run or marked`;
  while (ghRead(["api", `repos/{owner}/{repo}/actions/runs/${run}/attempts/${attempt}`, "--jq", ".status"], line).trim() !== "completed") spawnSync("sleep", [String(WAIT_SECONDS)]);
}

function handOn(run: string, attempt: string): undefined {
  const url = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${process.env.GH_REPO ?? ""}/actions/runs/${run}`;
  const handed = gh(["workflow", "run", CALLER_FILE, "-f", `ticket=${process.env.TICKET || "none"}`, "-f", `reason=Run ${url} ended red on attempt ${attempt}`, "-f", `rerun=${run}/${attempt}`]);
  if (handed.status !== 0) console.error(`rerun: run ${run} could not be handed to ${CALLER_FILE}, so it is not re-run: ${firstLine(handed)}`);
  else console.log(`rerun: run ${run} ended red on attempt ${attempt}, so ${CALLER_FILE} is dispatched to re-run it`);
  return undefined;
}

function rerun(run: string, attempt: string): Stop | undefined {
  waitFor(run, attempt);
  const [latest = "", url = ""] = ghRead(["api", `repos/{owner}/{repo}/actions/runs/${run}`, "--jq", '"\\(.run_attempt) \\(.html_url)"'], `run ${run} could not be read, so nothing is re-run or marked`).trim().split(" ");
  if (Number(latest) > Number(attempt)) {
    console.log(`rerun: run ${run} is already on attempt ${latest}, so attempt ${attempt} is neither re-run nor marked`);
    return undefined;
  }
  const calls = callsOf(run, attempt);
  if (calls.length === 0) {
    console.log(`rerun: no job of run ${run} that ended red or ran out of time called the owner, so nothing is re-run or marked`);
    return undefined;
  }
  if (attempt === "1") {
    const again = gh(["api", "-X", "POST", `repos/{owner}/{repo}/actions/runs/${run}/rerun-failed-jobs`]);
    if (again.status !== 0) return stoppedAt("unrerun", `rerun: run ${run} could not be re-run, so ${calls.map(({ run: named }) => named).join(" and ")} stays stopped: ${firstLine(again)}`);
    console.log(`rerun: ${calls.map(({ run: named, ended }) => `${named} ${ended}`).join(" and ")} on its first attempt, so run ${run} re-runs its failed jobs once`);
    return undefined;
  }
  for (const call of calls) callOwner(call, url, attempt);
  return undefined;
}

if (import.meta.main) {
  const dispatching = process.argv[2] === "--dispatch";
  const [run, attempt] = process.argv.slice(dispatching ? 3 : 2);
  if (run === undefined || attempt === undefined) throw new Error("no run id and attempt in the arguments");
  process.exit(exitFor(readOrStop("rerun", () => (dispatching ? handOn : rerun)(run, attempt))));
}
