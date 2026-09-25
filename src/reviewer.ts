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
export const foundDrift = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.`;
export const repairOf = (ticket: string) => `Repair #${ticket} as its fixer`;

const VERDICT = {
  type: "object",
  properties: {
    verdict: { enum: ["match", "drift"] },
    gaps: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
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
  required: ["verdict", "gaps"],
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
}

interface AfterTurn {
  earlier: string;
  fix: string;
}

const laterFinds = (ticket: string) => `The reviewer found these on #${ticket} after its fixer's repair, outside the earlier gaps and the fix's own lines, so they do not block its merge:`;
const FOLLOW_UP_OF = "Follow-up of #";

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
      : ["## The fixer's repair", "This PR was judged drift, then its fixer repaired it. The earlier judgements:", capped(after.earlier, LIST_CAP), "The fix's own diff:", capped(after.fix, DIFF_CAP) || "(none, the fixer changed the ticket)"];
  const sorted =
    after === undefined
      ? []
      : [
          "`gaps` holds only an earlier gap still open or a gap in the fix's own lines; these block, and the verdict is `drift` while any remain. Put every other gap in `later`: it never blocks.",
          "Each `later` item becomes its own ticket: the `gap` in one sentence, a `title`, 1 to 3 `criteria` each ending ` - check: `<command>`` with one a vitest run of a test not yet written, and the files it `claimed`.",
        ];
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

function judgement(ticket: string, gaps: string[]): string {
  const named = gaps.length === 0 ? ["- the reviewer ruled drift and named no gap"] : gaps.map((gap) => `- ${gap}`);
  return [foundDrift(ticket), "", ...named, ""].join("\n");
}

const fixDiff = (ticket: string): string => git(["log", "--format=", "-p", "--fixed-strings", `--grep=${repairOf(ticket)}`, "HEAD"]).stdout ?? "";

function followUp(ticket: string, { gap, criteria, claimed }: Later): string {
  return [
    "## Why",
    "",
    `${FOLLOW_UP_OF}${ticket}: its review found this after its fixer's repair, outside the earlier gaps and the fix's own lines.`,
    "",
    `> ${gap}`,
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
  if (posted.refusals.length > 0) return `, its later finds refused: ${quoted(posted.refusals[0])}`;
  if (deep) return `, ${later.length} later finds posted, not filed: ${posted.said}`;
  const filed = later.map((find) => ({ find, ...post({ kind: "ticket", title: find.title, text: followUp(ticket, find) }, gh) }));
  const refused = filed.flatMap(({ find, refusals }) => (refusals.length > 0 ? [`- ${find.gap}: ${quoted(refusals[0])}`] : []));
  if (refused.length > 0) commentOnTicket(ticket, [`These later finds on #${ticket} were not filed, their follow-up tickets were refused:`, "", ...refused, ""].join("\n"), gh);
  return `, ${later.length} later finds posted: ${posted.said}; follow-ups filed: ${filed.map(({ said }) => said).filter((said) => said !== "").join(" ") || "none"}`;
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
  const turns = commentsOn(ticket, gh);
  if (turns === undefined) return stoppedAt("unread", `${said} ended red, the comments on #${ticket} could not be read, so no model was spent`);
  const onPr = commentsOn(pr, gh);
  if (onPr === undefined) return stoppedAt("unread", `${said} ended red, the comments on its PR could not be read, so no model was spent`);
  const earlier = onPr.filter((comment) => comment.startsWith(foundDrift(ticket))).join("\n\n");
  const fix = fixDiff(ticket);
  const after = earlier !== "" && fix !== "" ? { earlier, fix } : undefined;
  const verdict = judged(handedOn(body, diff, after), pr);
  if (typeof verdict === "string") return stoppedAt("modelRun", `${said} ended red, ${verdict}`);
  const blocking = after === undefined ? [...verdict.gaps, ...(verdict.later ?? []).map(({ gap }) => gap)] : verdict.gaps;
  const recorded = recordedLater(ticket, body, after === undefined ? [] : (verdict.later ?? []), turns);
  if (verdict.verdict === "match") {
    console.log(`${said} matches the Why of #${ticket}${recorded}`);
    return undefined;
  }
  const posted = post({ kind: "judgement", pr, text: judgement(ticket, blocking) }, gh);
  if (posted.refusals.length > 0) return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, and its judgement was refused: ${quoted(posted.refusals[0])}${recorded}`);
  return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, ${blocking.length} gaps posted: ${posted.said}${recorded}`);
}

if (import.meta.main) process.exit(exitFor(review(process.argv[2])));
