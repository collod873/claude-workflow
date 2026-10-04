import { createHash } from "node:crypto";
import { capped } from "./brief.ts";
import { answered as readAnswered, commentOnTicket, commentsRead, gh, ghRead, ghWhole, git, gitRead, post, readOrStop, underOwnerSpec, unread, WAITING } from "./post.ts";
import { hire } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { DONE_SENTENCES, quoted, why } from "./ticket-shape.ts";

const stoppedAt = stopsOf({ drift: "The reviewer finds drift from `## Why`" });
export type Stop = ReturnType<typeof stoppedAt>;

export const DIFF_CAP = 32 * 1024;
export const TICKET_CAP = 8 * 1024;
export const LIST_CAP = 4 * 1024;

export const TICKET_BRANCH = /^ticket\/(\d+)$/;
const FILE_START = /^(?=diff --git )/m;
const CHANGED_PATH = /^diff --git a\/.+? b\/(.+)$/m;
const TOOLS = ["Read", "Grep", "Glob"];
export const NO_EM_DASH = "^[^\\u2014]*$";
export const PLAIN_WORDS = "^(?:(?!`|/|[\\w-]+\\.[A-Za-z]{1,8}\\b)[\\s\\S])*$";
const foundDrift = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.`;
const foundOverlap = (ticket: string) => `The reviewer read this PR for #${ticket} against what merged to main since its last judgement and found overlap.`;
const foundMatchInWave = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found it builds it. Its spec's note for this wave reads it back to the owner.`;
const foundNoOverlap = (ticket: string) => `The reviewer read this PR for #${ticket} against what merged to main since its last judgement and found no overlap.`;
const drifted = (ticket: string, comment: string) => comment.startsWith(foundDrift(ticket)) || comment.startsWith(foundOverlap(ticket));
export const earlierDrift = (ticket: string, comments: string[]) => comments.filter((comment) => drifted(ticket, comment)).join("\n\n");

const unspent = (pr: string, read: string) => `#${pr} ended red, ${read} could not be read, so no model was spent`;

function fingerprintOf(pr: string, diff: string, body: string): string {
  const id = (gitRead(["patch-id", "--stable"], unspent(pr, "the patch id of its diff"), diff).match(/^\S+/) ?? [""])[0];
  return `${id}-${createHash("sha256").update(body).digest("hex").slice(0, 12)}`;
}

const fingerprintLine = (fingerprint: string) => `Fingerprint: \`${fingerprint}\``;
export const FINGERPRINT = /Fingerprint: `([^`]+)`/;
const headLine = (head: string) => `Head: \`${head}\``;
const HEAD_LINE = /^Head: `([0-9a-f]{40,64})`$/m;
const mainLine = (main: string) => `Main: \`${main}\``;
const MAIN_LINE = /^Main: `([0-9a-f]{40,64})`$/m;
const stamped = (fingerprint: string, main: string | undefined, head?: string) => [fingerprintLine(fingerprint), ...(main === undefined ? [] : [mainLine(main)]), ...(head === undefined ? [] : [headLine(head)])];

interface Judgement {
  fingerprint: string;
  verdict: "match" | "drift";
  main?: string;
}

function lastJudgement(ticket: string, comments: string[]): Judgement | undefined {
  let found: Judgement | undefined;
  for (const comment of comments) {
    const fingerprint = FINGERPRINT.exec(comment)?.[1];
    if (fingerprint === undefined) continue;
    found = { fingerprint, verdict: drifted(ticket, comment) ? "drift" : "match", main: MAIN_LINE.exec(comment)?.[1] };
  }
  return found;
}
export const repairOf = (ticket: string) => `Repair #${ticket} as its builder`;
const QUOTE_LINE = /^>.*$/gm;
const DOUBLE_QUOTE = /"[^"\n]+"/g;
const READBACK_PROMPT = "`readback`: for someone who does not read code, what to try and what should happen, or what it now does and did not before.";

function ownerQuotes(body: string): string[] {
  const text = why(body);
  return text.match(QUOTE_LINE) ?? text.match(DOUBLE_QUOTE) ?? [];
}

function ownerWords(pr: string, body: string): string[] {
  const parent = REVIEWED_FROM.exec(why(body))?.[1];
  if (parent === undefined) return ownerQuotes(body);
  return ownerQuotes(ghRead(["issue", "view", parent, "--json", "body", "--jq", ".body"], unspent(pr, `the owner's words on #${parent}`)));
}

function readbackText(words: string[], account: string, fingerprint: string, main: string): string {
  return [...stamped(fingerprint, main), "", ...words, "", account, "", "Did this build what you meant, yes or no?"].join("\n");
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
          done: { type: "array", items: { type: "string", pattern: NO_EM_DASH } },
        },
        required: ["gap", "title", "done"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdict", "gaps", "readback"],
  additionalProperties: false,
};

const SINCE = {
  type: "object",
  properties: { finds: { type: "array", items: { type: "string", pattern: NO_EM_DASH } } },
  required: ["finds"],
  additionalProperties: false,
};

const isSince = (answer: unknown): answer is { finds: string[] } => Array.isArray((answer as { finds?: unknown } | undefined)?.finds);

export function handedSince(body: string, diff: string, merged: string, landed: string): string {
  return [
    "This PR matched the `## Why` below at its last review. Since then main gained what is under `## Merged since`, and the PR was brought up to date with it. Judge only that. Change nothing; read the repo if the diff is unclear.",
    capped(body, TICKET_CAP),
    "## This PR's diff",
    handedDiff(diff),
    "## Merged since",
    capped(merged, LIST_CAP),
    handedDiff(landed),
    "## Your finds",
    "`finds`: each place this PR duplicates what merged, gives a second name to one thing, or clashes with it, naming which of the two to keep. Each goes to the PR's builder to act on. None if there is none.",
    "",
  ].join("\n\n");
}

interface Later {
  gap: string;
  title: string;
  done: string[];
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

const laterFinds = (ticket: string) => `The reviewer found these on #${ticket} after its builder's repair, outside the earlier gaps and the fix's own lines, so they do not block its merge:`;
export const FOLLOW_UP_OF = "Follow-up of #";
const reviewerOn = (ticket: string) => `The reviewer, on #${ticket}:`;
const REVIEW_FOUND = ": its review found";
export const BUILDER_SPLIT = ": its builder split it";
export const REVIEWED_FROM = new RegExp(`^${FOLLOW_UP_OF}(\\d+)${REVIEW_FOUND}`, "m");
export const SPLIT_FROM = new RegExp(`^${FOLLOW_UP_OF}(\\d+)${BUILDER_SPLIT}`, "m");

const firstLine = (text: string) => quoted(text.trim().split("\n")[0] ?? "");

const changedPaths = (diff: string): string[] => diff.split(FILE_START).flatMap((text) => CHANGED_PATH.exec(text)?.slice(1) ?? []);

export function handedDiff(diff: string): string {
  const bytes = Buffer.byteLength(diff);
  if (bytes <= DIFF_CAP) return diff;
  return [
    `The diff is ${bytes} bytes, over ${DIFF_CAP}, so it is cut here; read any changed file in the repo.`,
    capped(diff, DIFF_CAP),
    "Every file changed:",
    capped(changedPaths(diff).map((path) => `- ${path}`).join("\n"), LIST_CAP),
  ].join("\n\n");
}

export function handedOn(body: string, diff: string, after?: AfterTurn): string {
  const turn =
    after === undefined
      ? []
      : ["## The builder's repair", "This PR was judged drift, then its builder repaired it. The earlier judgements:", capped(after.earlier, LIST_CAP), "The fix's own diff:", capped(after.fix, DIFF_CAP) || "(none, the builder changed the ticket)"];
  const sorted =
    after === undefined
      ? []
      : [
          "`gaps` holds only an earlier gap still open or a gap in the fix's own lines; these block, and the verdict is `drift` while any remain. Put every other gap in `later`: it never blocks.",
          `Each \`later\` item becomes its own ticket: the \`gap\` in one sentence, a \`title\`, and \`done\` as ${DONE_SENTENCES}.`,
        ];
  return [
    "Review this PR against the `## Why` and its `## Done when`. Change nothing; `bin/check` is green. Read the repo if the diff is unclear.",
    capped(body, TICKET_CAP),
    "## Diff",
    handedDiff(diff),
    ...turn,
    "## Your verdict",
    "`match` if the diff builds the Why, else `drift`. Name every gap in one pass, each a builder can act on.",
    READBACK_PROMPT,
    ...sorted,
    "",
  ].join("\n\n");
}

function isVerdict(answer: unknown): answer is Verdict {
  const verdict = (answer as Partial<Verdict> | undefined)?.verdict;
  return verdict === "match" || verdict === "drift";
}

export function answered({ name, bin, answers }: { name: string; bin: string; answers: object }, prompt: string, pr: string): { answer: unknown; stdout: string } | string {
  const spend = hire(bin, pr, { name, tools: TOOLS, answers });
  if (typeof spend === "string") return `the owner's hooks could not be read from ${spend}`;
  const spent = spend(prompt);
  return spent.refusal ?? { answer: spent.answer, stdout: spent.stdout };
}

function judged(prompt: string, pr: string): Verdict | string {
  const spent = answered({ name: "reviewer", bin: "review", answers: VERDICT }, prompt, pr);
  if (typeof spent === "string") return spent;
  return isVerdict(spent.answer) ? spent.answer : `the reviewer gave no verdict: ${firstLine(spent.stdout)}`;
}

function judgement(found: string, gaps: string[], stamp: string[]): string {
  const named = gaps.length === 0 ? ["- the reviewer ruled drift and named no gap"] : gaps.map((gap) => `- ${gap}`);
  return [found, "", ...named, "", ...stamp, ""].join("\n");
}

const headNow = (pr: string) => gitRead(["rev-parse", "HEAD"], unspent(pr, "its head"));
const mainNow = (pr: string) => gitRead(["merge-base", "origin/main", "HEAD"], unspent(pr, "where it stands on main"));

function judgedHead(ticket: string, comments: string[]): string | undefined {
  const drifts = comments.filter((comment) => drifted(ticket, comment));
  return HEAD_LINE.exec(drifts.at(-1) ?? "")?.[1];
}

function fixSince(pr: string, head: string): string {
  const line = unspent(pr, "the fix's own diff");
  const merged = git(["merge-tree", "--write-tree", head, mainNow(pr)]);
  readAnswered(merged, line);
  const tree = merged.stdout.split("\n")[0] ?? "";
  return gitRead(["diff", tree === "" ? unread(line) : tree, "HEAD"], line);
}

const followUp = (ticket: string, { gap, done }: Later): string =>
  followUpBody([`${FOLLOW_UP_OF}${ticket}${REVIEW_FOUND} this after its builder's repair, outside the earlier gaps and the fix's own lines.`, "", reviewerOn(ticket), "", `> ${gap}`], done);

export function followUpBody(whyLines: string[], done: string[]): string {
  return ["## Why", "", ...whyLines, "", "## Done when", "", ...done.map((sentence) => `- ${sentence}`), ""].join("\n");
}

function recordedLater(ticket: string, body: string, later: Later[], turns: string[]): string {
  if (later.length === 0) return "";
  if (turns.some((said) => said.startsWith(laterFinds(ticket)))) return `, its later finds already on #${ticket}`;
  const deep = body.includes(FOLLOW_UP_OF);
  const fate = deep ? `Not filed, since #${ticket} is itself a follow-up.` : "Each is filed as a follow-up ticket that builds itself once this PR merges or closes.";
  const posted = commentOnTicket(ticket, [laterFinds(ticket), "", ...later.map(({ gap }) => `- ${gap}`), "", fate, ""].join("\n"), gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return `, its later finds refused: ${quoted(refusal)}`;
  if (deep) return `, ${later.length} later finds posted, not filed: ${posted.said}`;
  const filed = later.map((find) => ({ find, ...post({ kind: "ticket", title: find.title, text: followUp(ticket, find), labels: [WAITING] }, gh) }));
  const refused = filed.flatMap(({ find, refusals }) => refusals.slice(0, 1).map((refusal) => `- ${find.gap}: ${quoted(refusal)}`));
  if (refused.length > 0) commentOnTicket(ticket, [`These later finds on #${ticket} were not filed, their follow-up tickets were refused:`, "", ...refused, ""].join("\n"), gh);
  return `, ${later.length} later finds posted: ${posted.said}; follow-ups filed: ${filed.map(({ said }) => said).filter((said) => said !== "").join(" ") || "none"}`;
}

function bodyAndDiff(pr: string, ticket: string): { body: string; diff: string } {
  const body = ghWhole(["issue", "view", ticket, "--json", "body", "--jq", ".body"], unspent(pr, `ticket #${ticket}`));
  const diff = ghWhole(["pr", "diff", pr], unspent(pr, "its diff"));
  return { body, diff };
}

export function ticketPr(pr: string, said: string): { ticket: string; body: string; diff: string } | undefined {
  const branch = ghRead(["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"], `#${pr} could not be read, so nothing read it`);
  const ticket = TICKET_BRANCH.exec(branch)?.[1];
  if (ticket === undefined) {
    console.log(`${said} is not a ticket PR, so there is no Why to read it against`);
    return undefined;
  }
  return { ticket, ...bodyAndDiff(pr, ticket) };
}

interface Judging {
  pr: string;
  ticket: string;
  said: string;
  fingerprint: string;
}

function movedUnder({ pr, ticket, said, fingerprint }: Judging): { ended: Stop | undefined } | undefined {
  const now = bodyAndDiff(pr, ticket);
  if (fingerprintOf(pr, now.diff, now.body) === fingerprint) return undefined;
  console.log(`${said} writes nothing, a newer run judges #${ticket}: the PR moved under it while its model answered`);
  return { ended: undefined };
}

function reviewedSince(judging: Judging & { body: string; diff: string }, from: string, to: string): Stop | undefined {
  const { pr, ticket, said, fingerprint } = judging;
  const line = unspent(pr, "what merged to main since its last judgement");
  const merged = gitRead(["log", "--first-parent", "--format=- %s", `${from}..${to}`], line);
  const landed = gitRead(["diff", from, to], line);
  const spent = answered({ name: "reviewer", bin: "review", answers: SINCE }, handedSince(judging.body, judging.diff, merged, landed), pr);
  if (typeof spent === "string") return stoppedAt("modelRun", `${said} ended red, ${spent}`);
  if (!isSince(spent.answer)) return stoppedAt("modelRun", `${said} ended red, the reviewer gave no finds: ${firstLine(spent.stdout)}`);
  const moved = movedUnder(judging);
  if (moved !== undefined) return moved.ended;
  const { finds } = spent.answer;
  if (finds.length === 0) {
    const posted = post({ kind: "judgement", pr, text: [foundNoOverlap(ticket), "", ...stamped(fingerprint, to), ""].join("\n") }, gh);
    console.log(`${said} overlaps nothing merged to main since its last judgement on #${ticket}: ${posted.said || quoted(posted.refusals[0] ?? "")}`);
    return undefined;
  }
  const posted = post({ kind: "judgement", pr, text: judgement(foundOverlap(ticket), finds, stamped(fingerprint, to, headNow(pr))) }, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("drift", `${said} overlaps what merged to main since its last judgement on #${ticket}, and its judgement was refused: ${quoted(refusal)}`);
  return stoppedAt("drift", `${said} overlaps what merged to main since its last judgement on #${ticket}, ${finds.length} finds posted: ${posted.said}`);
}

function review(pr: string): Stop | undefined {
  const said = `review: #${pr}`;
  const read = ticketPr(pr, said);
  if (typeof read !== "object") return read;
  const { ticket, body, diff } = read;
  const onPr = commentsRead(pr, unspent(pr, "the comments on its PR"), gh);
  const fingerprint = fingerprintOf(pr, diff, body);
  const past = lastJudgement(ticket, onPr);
  const main = mainNow(pr);
  if (past?.fingerprint === fingerprint) {
    if (past.verdict === "match" && past.main !== undefined && past.main !== main) {
      return reviewedSince({ pr, ticket, body, diff, said, fingerprint }, past.main, main);
    }
    if (past.verdict === "match") {
      console.log(`${said} reuses its last judgement on #${ticket}, a match, hiring no model`);
      return undefined;
    }
    return stoppedAt("drift", `${said} reuses its last judgement on #${ticket}, a drift, hiring no model`);
  }
  const turns = commentsRead(ticket, unspent(pr, `the comments on #${ticket}`), gh);
  const head = headNow(pr);
  const spec = underOwnerSpec(ticket, gh);
  if (spec.unread !== undefined) unread(unspent(pr, `the parent of #${ticket}`));
  const inWave = spec.refused === undefined;
  const words = inWave ? [] : ownerWords(pr, body);
  const earlier = earlierDrift(ticket, onPr);
  const since = judgedHead(ticket, onPr);
  const after = earlier === "" ? undefined : { earlier, fix: since === undefined ? diff : fixSince(pr, since) };
  const verdict = judged(handedOn(body, diff, after), pr);
  if (typeof verdict === "string") return stoppedAt("modelRun", `${said} ended red, ${verdict}`);
  const moved = movedUnder({ pr, ticket, said, fingerprint });
  if (moved !== undefined) return moved.ended;
  const blocking = after === undefined ? [...verdict.gaps, ...(verdict.later ?? []).map(({ gap }) => gap)] : verdict.gaps;
  const recorded = recordedLater(ticket, body, after === undefined ? [] : (verdict.later ?? []), turns);
  if (verdict.verdict === "match") {
    const text = inWave ? [foundMatchInWave(ticket), "", ...stamped(fingerprint, main), ""].join("\n") : readbackText(words, verdict.readback, fingerprint, main);
    const posted = post({ kind: "judgement", pr, text }, gh);
    const [refusal] = posted.refusals;
    const kind = inWave ? "judgement, its readback left to its spec's wave note," : "readback";
    console.log(`${said} matches the Why of #${ticket}${recorded}, ${refusal === undefined ? `its ${kind} posted: ${posted.said}` : `its ${kind} was refused: ${quoted(refusal)}`}`);
    return undefined;
  }
  const posted = post({ kind: "judgement", pr, text: judgement(foundDrift(ticket), blocking, stamped(fingerprint, main, head)) }, gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, and its judgement was refused: ${quoted(refusal)}${recorded}`);
  return stoppedAt("drift", `${said} drifts from the Why of #${ticket}, ${blocking.length} gaps posted: ${posted.said}${recorded}`);
}

if (import.meta.main) {
  const pr = process.argv[2];
  if (pr === undefined) throw new Error("no PR number in the arguments");
  process.exit(exitFor(readOrStop("review", () => review(pr))));
}
