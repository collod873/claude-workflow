import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { commentOnTicket, commentsOn, gh, git, post } from "./post.ts";
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
export const PLAIN_WORDS = "^(?:(?!`|/|[\\w-]+\\.[A-Za-z]{1,8}\\b)[\\s\\S])*$";
const foundDrift = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.`;
export const earlierDrift = (ticket: string, comments: string[]) => comments.filter((comment) => comment.startsWith(foundDrift(ticket))).join("\n\n");

function fingerprintOf(diff: string, body: string): string {
  const args = ["patch-id", "--stable"];
  const stdout = spawnSync("git", args, { input: diff, encoding: "utf8", maxBuffer: Infinity }).stdout;
  const id = (stdout.trim().match(/^\S+/) ?? [""])[0];
  return `${id}-${createHash("sha256").update(body).digest("hex").slice(0, 12)}`;
}

const fingerprintLine = (fingerprint: string) => `Fingerprint: \`${fingerprint}\``;
export const FINGERPRINT = /Fingerprint: `([^`]+)`/;
const headLine = (head: string) => `Head: \`${head}\``;
const HEAD_LINE = /^Head: `([0-9a-f]{40,64})`$/m;

function lastJudgement(ticket: string, comments: string[]): { fingerprint: string; verdict: "match" | "drift" } | undefined {
  let found: { fingerprint: string; verdict: "match" | "drift" } | undefined;
  for (const comment of comments) {
    const fingerprint = FINGERPRINT.exec(comment)?.[1];
    if (fingerprint === undefined) continue;
    found = { fingerprint, verdict: comment.startsWith(foundDrift(ticket)) ? "drift" : "match" };
  }
  return found;
}
export const repairOf = (ticket: string) => `Repair #${ticket} as its fixer`;
const QUOTE_LINE = /^>.*$/gm;
const DOUBLE_QUOTE = /"[^"\n]+"/g;
const READBACK_PROMPT = "`readback`: for someone who does not read code, what to try and what should happen, or what it now does and did not before.";

function ownerQuotes(body: string): string[] {
  const text = why(body);
  return text.match(QUOTE_LINE) ?? text.match(DOUBLE_QUOTE) ?? [];
}

function readbackText(body: string, account: string, fingerprint: string): string {
  return [fingerprintLine(fingerprint), "", ...ownerQuotes(body), "", account, "", "Did this build what you meant, yes or no?"].join("\n");
}

const VERDICT = {
  type: "object",
  properties: {
    verdict: { enum: ["match", "drift"] },
    gaps: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
    readback: { type: "string", pattern: PLAIN_WORDS },
    later: {
      type: "array",
      items: {
        type: "object",
        properties: {
          gap: { type: "string", pattern: NO_EM_DASH },
          title: { type: "string", pattern: NO_EM_DASH },
          criteria: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
          claimed: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
        },
        required: ["gap", "title", "criteria", "claimed"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "gaps", "readback"],
  additionalProperties: false,
};

interface Later {
  gap: string;
  title: string;
  criteria: string[];
  claimed: string[];
}

interface Verdict {
  verdict: "match" | "drift";
  gaps: string[];
  later?: Later[];
  readback: string;
}

interface AfterTurn {
  earlier: string;
  fix: string;
}

const laterFinds = (ticket: string) => `The reviewer found these on #${ticket} after its fixer's repair, outside the earlier gaps and the fix's own lines, so they do not block its merge:`;
export const FOLLOW_UP_OF = "Follow-up of #";

const firstLine = (text: string) => quoted(text.trim().split("\n")[0] ?? "");

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
      : ["## The fixer's repair", "This PR was judged drift, then its fixer repaired it. The earlier judgements:", capped(after.earlier, LIST_CAP), "The fix's own diff:", capped(after.fix, DIFF_CAP) || "(none, the fixer changed the ticket)"];
  const sorted =
    after === undefined
      ? []
      : [
          "`gaps` holds only an earlier gap still open or a gap in the fix's own lines; these block, and the verdict is `drift` while any remain. Put every other gap in `later`: it never blocks.",
          "Each `later` item becomes its own ticket: the `gap` in one sentence, a `title`, 1 to 3 `criteria` each ending ` - check: `<command>`` with one a vitest run of a test not yet written, and the files it `claimed`.",
        ];
  return [
    "Review this PR against the `## Why` and its criteria. Change nothing; `bin/check` is green. Read the repo if the diff is unclear.",
    "## Why",
    capped(why(body), TICKET_CAP),
    "## Acceptance criteria",
    capped(acceptance(body), TICKET_CAP),
    "## Diff",
    handedDiff(diff, claims(body)),
    ...turn,
    "## Your verdict",
    "`match` if the diff builds the Why, else `drift`. Name every gap in one pass, each a fixer can act on.",
    READBACK_PROMPT,
    ...sorted,
    "",
  ].join("\n\n");
}

function isVerdict(answer: unknown): answer is Verdict {
  const verdict = (answer as Partial<Verdict> | undefined)?.verdict;
  return verdict === "match" || verdict === "drift";
}

export function answered(hire: { name: string; bin: string; answers: object }, prompt: string, pr: string): { answer: unknown; stdout: string } | string {
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: hire.name, transcript: join(logs, `${hire.bin}-${pr}.jsonl`), tools: TOOLS, answers: hire.answers });
  if (typeof spend === "string") return `the owner's hooks could not be read from ${spend}`;
  const spent = spend(prompt);
  return spent.refusal ?? { answer: spent.answer, stdout: spent.stdout };
}

function judged(prompt: string, pr: string): Verdict | string {
  const spent = answered({ name: "reviewer", bin: "review", answers: VERDICT }, prompt, pr);
  if (typeof spent === "string") return spent;
  return isVerdict(spent.answer) ? spent.answer : `the reviewer gave no verdict: ${firstLine(spent.stdout)}`;
}

function judgement(ticket: string, gaps: string[], fingerprint: string, head: string | undefined): string {
  const named = gaps.length === 0 ? ["- the reviewer ruled drift and named no gap"] : gaps.map((gap) => `- ${gap}`);
  return [foundDrift(ticket), "", ...named, "", fingerprintLine(fingerprint), ...(head === undefined ? [] : [headLine(head)]), ""].join("\n");
}

function headNow(): string | undefined {
  const got = git(["rev-parse", "HEAD"]);
  return got.status === 0 ? got.stdout.trim() : undefined;
}

function judgedHead(ticket: string, comments: string[]): string | undefined {
  const drifts = comments.filter((comment) => comment.startsWith(foundDrift(ticket)));
  return HEAD_LINE.exec(drifts.at(-1) ?? "")?.[1];
}

function fixSince(head: string): string | undefined {
  const base = git(["merge-base", "origin/main", "HEAD"]);
  if (base.status !== 0) return undefined;
  const merged = git(["merge-tree", "--write-tree", head, base.stdout.trim()]);
  const tree = merged.stdout.split("\n")[0] ?? "";
  if ((merged.status !== 0 && merged.status !== 1) || tree === "") return undefined;
  const fix = git(["diff", tree, "HEAD"]);
  return fix.status === 0 ? fix.stdout : undefined;
}

const followUp = (ticket: string, { gap, criteria, claimed }: Later): string =>
  followUpBody([`${FOLLOW_UP_OF}${ticket}: its review found this after its fixer's repair, outside the earlier gaps and the fix's own lines.`, "", `> ${gap}`], criteria, claimed);

export function followUpBody(whyLines: string[], criteria: string[], claimed: string[]): string {
  return [
    "## Why",
    "",
    ...whyLines,
    "",
    "## Acceptance criteria",
    "",
    ...criteria.map((criterion) => `- [ ] ${criterion}`),
    "",
    "## Files claimed",
    "",
    ...claimed.map((path) => `- ${path}`),
    "",
  ].join("\n");
}

function recordedLater(ticket: string, body: string, later: Later[], turns: string[]): string {
  if (later.length === 0) return "";
  if (turns.some((said) => said.startsWith(laterFinds(ticket)))) return `, its later finds already on #${ticket}`;
  const deep = body.includes(FOLLOW_UP_OF);
  const fate = deep ? `Not filed, since #${ticket} is itself a follow-up.` : "Each is filed as a follow-up ticket that builds itself.";
  const posted = commentOnTicket(ticket, [laterFinds(ticket), "", ...later.map(({ gap }) => `- ${gap}`), "", fate, ""].join("\n"), gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return `, its later finds refused: ${quoted(refusal)}`;
  if (deep) return `, ${later.length} later finds posted, not filed: ${posted.said}`;
  const filed = later.map((find) => ({ find, ...post({ kind: "ticket", title: find.title, text: followUp(ticket, find) }, gh) }));
  const refused = filed.flatMap(({ find, refusals }) => refusals.slice(0, 1).map((refusal) => `- ${find.gap}: ${quoted(refusal)}`));
  if (refused.length > 0) commentOnTicket(ticket, [`These later finds on #${ticket} were not filed, their follow-up tickets were refused:`, "", ...refused, ""].join("\n"), gh);
  return `, ${later.length} later finds posted: ${posted.said}; follow-ups filed: ${filed.map(({ said }) => said).filter((said) => said !== "").join(" ") || "none"}`;
}

function bodyAndDiff(pr: string, ticket: string, said: string): { body: string; diff: string } | Stop {
  const asked = (args: string[]) => {
    const got = gh(args);
    return got.status === 0 ? got.stdout : undefined;
  };
  const body = asked(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  const diff = asked(["pr", "diff", pr]);
  if (body === undefined || diff === undefined) {
    return stoppedAt("unread", `${said} ended red, ${body === undefined ? `ticket #${ticket}` : "its diff"} could not be read, so no model was spent`);
  }
  return { body, diff };
}

export function ticketPr(pr: string, said: string): { ticket: string; body: string; diff: string } | Stop | undefined {
  const gotBranch = gh(["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"]);
  const branch = gotBranch.status === 0 ? gotBranch.stdout : undefined;
  if (branch === undefined) return stoppedAt("unread", `${said} could not be read, so nothing read it`);
  const ticket = TICKET_BRANCH.exec(branch.trim())?.[1];
  if (ticket === undefined) {
    console.log(`${said} is not a ticket PR, so there is no Why to read it against`);
    return undefined;
  }
  const found = bodyAndDiff(pr, ticket, said);
  return typeof found === "object" ? { ticket, ...found } : found;
}

function review(pr: string): Stop | undefined {
  const said = `review: #${pr}`;
  const read = ticketPr(pr, said);
  if (typeof read !== "object") return read;
  const { ticket, body, diff } = read;
  const onPr = commentsOn(pr, gh);
  if (onPr === undefined) return stoppedAt("unread", `${said} ended red, the comments on its PR could not be read, so no model was spent`);
  const fingerprint = fingerprintOf(diff, body);
  const past = lastJudgement(ticket, onPr);
  if (past?.fingerprint === fingerprint) {
    if (past.verdict === "match") {
      console.log(`${said} reuses its last judgement on #${ticket}, a match, hiring no model`);
      return undefined;
    }
    return stoppedAt("drift", `${said} reuses its last judgement on #${ticket}, a drift, hiring no model`);
  }
  const turns = commentsOn(ticket, gh);
  if (turns === undefined) return stoppedAt("unread", `${said} ended red, the comments on #${ticket} could not be read, so no model was spent`);
  const head = headNow();
  const earlier = earlierDrift(ticket, onPr);
  const since = judgedHead(ticket, onPr);
  const after = earlier === "" ? undefined : { earlier, fix: (since === undefined ? undefined : fixSince(since)) ?? diff };
  const verdict = judged(handedOn(body, diff, after), pr);
  if (typeof verdict === "string") return stoppedAt("modelRun", `${said} ended red, ${verdict}`);
  const now = bodyAndDiff(pr, ticket, said);
  if (typeof now !== "object") return now;
  if (fingerprintOf(now.diff, now.body) !== fingerprint) {
    console.log(`${said} writes nothing, a newer run judges #${ticket}: the PR moved under it while its model answered`);
    return undefined;
  }
  const blocking = after === undefined ? [...verdict.gaps, ...(verdict.later ?? []).map(({ gap }) => gap)] : verdict.gaps;
  const recorded = recordedLater(ticket, body, after === undefined ? [] : (verdict.later ?? []), turns);
  if (verdict.verdict === "match") {
    const posted = post({ kind: "judgement", pr, text: readbackText(body, verdict.readback, fingerprint) }, gh);
    const [refusal] = posted.refusals;
    console.log(`${said} matches the Why of #${ticket}${recorded}, ${refusal === undefined ? `its readback posted: ${posted.said}` : `its readback was refused: ${quoted(refusal)}`}`);
    return undefined;
  }
  const posted = post({ kind: "judgement", pr, text: judgement(ticket, blocking, fingerprint, head) }, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, and its judgement was refused: ${quoted(refusal)}${recorded}`);
  return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, ${blocking.length} gaps posted: ${posted.said}${recorded}`);
}

if (import.meta.main) {
  const pr = process.argv[2];
  if (pr === undefined) throw new Error("no PR number in the arguments");
  process.exit(exitFor(review(pr)));
}
