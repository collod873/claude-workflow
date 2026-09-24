import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { commentOnTicket, commentsOn, post, type Gh } from "./post.ts";
import { hired, machineLogs } from "./stage.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { acceptance, claims, quoted, why } from "./ticket-shape.ts";

export const DIFF_CAP = 32 * 1024;
export const TICKET_CAP = 8 * 1024;
export const LIST_CAP = 4 * 1024;

const TICKET_BRANCH = /^ticket\/(\d+)$/;
const FILE_START = /^(?=diff --git )/m;
const CHANGED_PATH = /^diff --git a\/.+? b\/(.+)$/m;
const TOOLS = ["Read", "Grep", "Glob"];
export const NO_EM_DASH = "^[^\\u2014]*$";

const VERDICT = {
  type: "object",
  properties: {
    verdict: { enum: ["match", "drift"] },
    gaps: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
    later: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
  },
  required: ["verdict", "gaps"],
  additionalProperties: false,
};

interface Verdict {
  verdict: "match" | "drift";
  gaps: string[];
  later?: string[];
}

interface AfterTurn {
  earlier: string;
  fix: string;
}

export const TOOK_ITS_TURN = "The fixer took its one turn on this ticket";
export const repairOf = (ticket: string) => `Repair #${ticket} in the fixer's one turn`;
const laterFinds = (ticket: string) => `The reviewer found these on #${ticket} after the fixer's turn, outside the earlier gaps and the fix's own lines, so they do not block its merge:`;

export const gh: Gh = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: Infinity });
export const git = (args: string[]) => spawnSync("git", args, { encoding: "utf8", maxBuffer: Infinity });

const firstLine = (text: string) => quoted(text.trim().split("\n")[0]);

function changedFiles(diff: string): { path: string; text: string }[] {
  return diff.split(FILE_START).flatMap((text) => {
    const path = CHANGED_PATH.exec(text)?.[1];
    return path === undefined ? [] : [{ path, text }];
  });
}

export function handedDiff(diff: string, claimed: string[]): string {
  const bytes = Buffer.byteLength(diff);
  if (bytes <= DIFF_CAP) return diff;
  const changed = changedFiles(diff);
  return [
    `The diff is ${bytes} bytes, over ${DIFF_CAP}, so only the claimed files' diff is here; read any other changed file in the repo.`,
    capped(changed.filter(({ path }) => claimed.includes(path)).map(({ text }) => text).join(""), DIFF_CAP),
    "Every file changed:",
    capped(changed.map(({ path }) => `- ${path}`).join("\n"), LIST_CAP),
  ].join("\n\n");
}

export function handedOn(body: string, diff: string, after?: AfterTurn): string {
  const turn =
    after === undefined
      ? []
      : ["## The fixer's turn", "This PR was judged drift, then the fixer took its one turn. The earlier judgements:", capped(after.earlier, LIST_CAP), "The fix's own diff:", capped(after.fix, DIFF_CAP) || "(none, the fixer changed the ticket)"];
  const sorted =
    after === undefined
      ? []
      : ["`gaps` holds only an earlier gap still open or a gap in the fix's own lines; these block, and the verdict is `drift` while any remain. Put every other gap in `later`: it never blocks."];
  return [
    "Review a pull request built for a ticket against the owner's `## Why` and the acceptance criteria. Change nothing; read the repo only where the diff leaves a question.",
    "## Why",
    capped(why(body), TICKET_CAP),
    "## Acceptance criteria",
    capped(acceptance(body), TICKET_CAP),
    "## Diff",
    handedDiff(diff, claims(body)),
    ...turn,
    "## Your verdict",
    "`match` if the diff builds what the Why means. `drift` if it builds less, more or something else. Name every gap you find in this one pass, not only the first, each one sentence a fixer can act on.",
    ...sorted,
    "",
  ].join("\n\n");
}

function isVerdict(answer: unknown): answer is Verdict {
  const verdict = (answer as Partial<Verdict> | undefined)?.verdict;
  return verdict === "match" || verdict === "drift";
}

function judged(prompt: string, pr: string): Verdict | string {
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: "reviewer", transcript: join(logs, `review-${pr}.jsonl`), tools: TOOLS, answers: VERDICT });
  if (typeof spend === "string") return `the owner's hooks could not be read from ${spend}`;
  const spent = spend(prompt);
  if (spent.refusal !== undefined) return spent.refusal;
  return isVerdict(spent.answer) ? spent.answer : `the reviewer gave no verdict: ${firstLine(spent.stdout)}`;
}

export const foundDrift = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.`;

function judgement(ticket: string, gaps: string[]): string {
  const named = gaps.length === 0 ? ["- the reviewer ruled drift and named no gap"] : gaps.map((gap) => `- ${gap}`);
  return [foundDrift(ticket), "", ...named, ""].join("\n");
}

function fixDiff(ticket: string): string {
  const repair = (git(["log", "-1", "--format=%H", "--fixed-strings", `--grep=${repairOf(ticket)}`, "HEAD"]).stdout ?? "").trim();
  return repair === "" ? "" : (git(["show", "--format=", repair]).stdout ?? "");
}

function recordedLater(ticket: string, later: string[], turns: string[]): string {
  if (later.length === 0) return "";
  if (turns.some((said) => said.startsWith(laterFinds(ticket)))) return `, its later finds already on #${ticket}`;
  const posted = commentOnTicket(ticket, [laterFinds(ticket), "", ...later.map((gap) => `- ${gap}`), ""].join("\n"), gh);
  return posted.refusals.length > 0 ? `, its later finds refused: ${quoted(posted.refusals[0])}` : `, ${later.length} later finds posted: ${posted.said}`;
}

function review(pr: string): Stop | undefined {
  const said = `review: #${pr}`;
  const asked = (args: string[]) => {
    const got = gh(args);
    return got.status === 0 ? got.stdout : undefined;
  };
  const branch = asked(["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"]);
  if (branch === undefined) return stoppedAt("unread", `${said} could not be read, so nothing reviewed it`);
  const ticket = TICKET_BRANCH.exec(branch.trim())?.[1];
  if (ticket === undefined) {
    console.log(`${said} is not a ticket PR, so there is no Why to read it against`);
    return undefined;
  }
  const body = asked(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  const diff = asked(["pr", "diff", pr]);
  if (body === undefined || diff === undefined) {
    return stoppedAt("unread", `${said} ended red, ${body === undefined ? `ticket #${ticket}` : "its diff"} could not be read, so no model was spent`);
  }
  const turns = commentsOn(["issue", "view", ticket], gh);
  const onPr = commentsOn(["pr", "view", pr], gh);
  if (turns === undefined || onPr === undefined) return stoppedAt("unread", `${said} ended red, the comments on #${ticket} or its PR could not be read, so no model was spent`);
  const earlier = onPr.filter((comment) => comment.startsWith(foundDrift(ticket)));
  const after = earlier.length > 0 && turns.some((comment) => comment.startsWith(TOOK_ITS_TURN)) ? { earlier: earlier.join("\n\n"), fix: fixDiff(ticket) } : undefined;
  const verdict = judged(handedOn(body, diff, after), pr);
  if (typeof verdict === "string") return stoppedAt("modelRun", `${said} ended red, ${verdict}`);
  const blocking = after === undefined ? [...verdict.gaps, ...(verdict.later ?? [])] : verdict.gaps;
  const recorded = recordedLater(ticket, after === undefined ? [] : (verdict.later ?? []), turns);
  if (verdict.verdict === "match") {
    console.log(`${said} matches the Why of #${ticket}${recorded}`);
    return undefined;
  }
  const posted = post({ kind: "judgement", pr, text: judgement(ticket, blocking) }, gh);
  if (posted.refusals.length > 0) return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, and its judgement was refused: ${quoted(posted.refusals[0])}${recorded}`);
  return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, ${blocking.length} gaps posted: ${posted.said}${recorded}`);
}

if (import.meta.main) process.exit(exitFor(review(process.argv[2])));
