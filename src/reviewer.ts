import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { post, type Gh } from "./post.ts";
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
  },
  required: ["verdict", "gaps"],
  additionalProperties: false,
};

interface Verdict {
  verdict: "match" | "drift";
  gaps: string[];
}

const gh: Gh = (args) => spawnSync("gh", args, { encoding: "utf8", maxBuffer: Infinity });

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

export function handedOn(body: string, diff: string): string {
  return [
    "Review a pull request built for a ticket against the owner's `## Why` and the acceptance criteria. Change nothing; read the repo only where the diff leaves a question.",
    "## Why",
    capped(why(body), TICKET_CAP),
    "## Acceptance criteria",
    capped(acceptance(body), TICKET_CAP),
    "## Diff",
    handedDiff(diff, claims(body)),
    "## Your verdict",
    "`match` if the diff builds what the Why means. `drift` if it builds less, more or something else, with each gap one sentence a fixer can act on.",
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
  const verdict = judged(handedOn(body, diff), pr);
  if (typeof verdict === "string") return stoppedAt("modelRun", `${said} ended red, ${verdict}`);
  if (verdict.verdict === "match") {
    console.log(`${said} matches the Why of #${ticket}`);
    return undefined;
  }
  const posted = post({ kind: "judgement", pr, text: judgement(ticket, verdict.gaps) }, gh);
  if (posted.refusals.length > 0) return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, and its judgement was refused: ${quoted(posted.refusals[0])}`);
  return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, ${verdict.gaps.length} gaps posted: ${posted.said}`);
}

if (import.meta.main) process.exit(exitFor(review(process.argv[2])));
