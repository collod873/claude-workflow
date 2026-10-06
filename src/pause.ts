import { type CheckRun, checksOf, updateBranch, wakeBuilder } from "./closer.ts";
import { gh, NO_PR, readOrStop, ticketBranch, unread } from "./post.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { quoted } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  unpaused: "Pause: GitHub keeps auto-merge on at the paused ticket's PR",
  unresumed: "Resume: GitHub refuses auto-merge, the branch update or the builder's wake on the resumed ticket's PR",
});
type Stop = ReturnType<typeof stoppedAt>;

interface HeldPr {
  number: number;
  state: string;
  headRefOid: string;
  autoMergeRequest: unknown;
  mergeStateStatus: string;
  statusCheckRollup: CheckRun[] | null;
}

function prOf(ticket: string, so: string): HeldPr | undefined {
  const line = `the PR of #${ticket} could not be read, ${so}`;
  const got = gh(["pr", "view", ticketBranch(ticket), "--json", "number,state,headRefOid,autoMergeRequest,mergeStateStatus,statusCheckRollup"]);
  if (got.status !== 0) return NO_PR.test(got.stderr) ? undefined : unread(line);
  try {
    return JSON.parse(got.stdout) as HeldPr;
  } catch {
    return unread(line);
  }
}

const refusal = (got: ReturnType<typeof gh>) => quoted((got.stderr || got.stdout).trim().split("\n")[0] ?? "");

function pause(ticket: string): Stop | undefined {
  const pr = prOf(ticket, "so its auto-merge is left as it is");
  if (pr === undefined || pr.state !== "OPEN" || pr.autoMergeRequest === null) {
    console.log(`pause: #${ticket} has no PR with auto-merge on, so nothing of it merges while it is paused`);
    return undefined;
  }
  const off = gh(["pr", "merge", String(pr.number), "--disable-auto"]);
  if (off.status !== 0) return stoppedAt("unpaused", `pause: PR #${pr.number} of #${ticket} keeps auto-merge on, so it can still merge: ${refusal(off)}`);
  console.log(`pause: PR #${pr.number} of #${ticket} has auto-merge off, so it does not merge while #${ticket} is paused`);
  return undefined;
}

function resume(ticket: string): Stop | undefined {
  const pr = prOf(ticket, "so nothing resumes");
  if (pr === undefined) {
    console.log("builds=true");
    return undefined;
  }
  if (pr.state !== "OPEN") {
    console.log("builds=false");
    console.error(`resume: PR #${pr.number} of #${ticket} is ${pr.state.toLowerCase()}, so nothing resumes and no fresh build starts`);
    return undefined;
  }
  if (checksOf(pr.statusCheckRollup ?? []) === "red") return woken(ticket, pr, `red at ${pr.headRefOid}`);
  const on = gh(["pr", "merge", String(pr.number), "--auto", "--merge", "--match-head-commit", pr.headRefOid]);
  if (on.status !== 0) return stoppedAt("unresumed", `resume: PR #${pr.number} of #${ticket} could not have auto-merge back on: ${refusal(on)}`);
  if (pr.mergeStateStatus === "BEHIND") return updated(ticket, pr);
  console.log("builds=false");
  console.error(`resume: PR #${pr.number} of #${ticket} has auto-merge back on, so the closer's queue takes it`);
  return undefined;
}

function woken(ticket: string, pr: HeldPr, standing: string): Stop | undefined {
  const woke = wakeBuilder(ticket, `#${ticket} was resumed with its PR #${pr.number} ${standing}`);
  if (woke.status !== 0) return stoppedAt("unresumed", `resume: #${ticket}'s builder could not be woken on its PR #${pr.number}: ${refusal(woke)}`);
  console.log("builds=false");
  console.error(`resume: PR #${pr.number} of #${ticket} is ${standing}, so its builder takes it up again`);
  return undefined;
}

function updated(ticket: string, pr: HeldPr): Stop | undefined {
  const number = String(pr.number);
  const moved = updateBranch({ number, headRefName: ticketBranch(ticket), headRefOid: pr.headRefOid }, console.error);
  if (typeof moved === "object") return stoppedAt("unresumed", `resume: PR #${number} of #${ticket} has auto-merge back on but could not be brought up to date with main: ${quoted(moved.retried)}`);
  console.log("builds=false");
  if (moved === "conflicted") console.error(`resume: PR #${number} of #${ticket} is in conflict with main, so its builder resolves it unless #${ticket} is held`);
  else console.error(`resume: PR #${number} of #${ticket} has auto-merge back on and was behind main, so it is brought up to date for the closer's queue`);
  return undefined;
}

if (import.meta.main) {
  const [ticket, mode] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  process.exit(exitFor(mode === "--resume" ? readOrStop("resume", () => resume(ticket)) : readOrStop("pause", () => pause(ticket))));
}
