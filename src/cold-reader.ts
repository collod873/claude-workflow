import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { FENCED_OPUS } from "./fence.ts";
import { askedIssue, commentOnTicket, gh } from "./post.ts";
import { NO_EM_DASH } from "./reviewer.ts";
import { hired, machineLogs } from "./stage.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { quoted } from "./ticket-shape.ts";

export const SPEC_CAP = 16 * 1024;
const SPEC_LABEL = "spec";
const TOOLS = ["Read", "Grep", "Glob"];

const CHOICE = {
  type: "object",
  properties: {
    guess: { type: "string", pattern: NO_EM_DASH },
    why: { type: "string", pattern: NO_EM_DASH },
  },
  required: ["guess", "why"],
  additionalProperties: false,
};

const ANSWERS = {
  type: "object",
  properties: {
    build: { type: "string", pattern: NO_EM_DASH },
    choices: { type: "array", items: CHOICE },
  },
  required: ["build", "choices"],
  additionalProperties: false,
};

interface Choice {
  guess: string;
  why: string;
}

interface Answer {
  build: string;
  choices: Choice[];
}

export function handedOn(title: string, body: string): string {
  return [
    "Read this filed spec once, as the owner's one batch of guidance before any of it is sliced into work. Read the repo as you need; change nothing here.",
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Your answer",
    "A cold read says two things: what it would build, and where it had to choose. Give both, even if the second is empty.",
    "`build`: prose, what it would build from this spec, as if starting today.",
    "`choices`: a list of every place it had to guess rather than being told outright, each item a `guess` naming what it picked and a `why` naming what made it pick that. An empty list is a valid answer, and means it had to guess nowhere.",
    "",
  ].join("\n\n");
}

function isAnswer(answer: unknown): answer is Answer {
  const given = answer as Partial<Answer> | undefined;
  return typeof given?.build === "string" && Array.isArray(given.choices);
}

function posted(build: string, choices: Choice[]): string {
  const chosen = choices.length === 0 ? "It chose nowhere." : choices.map((choice, at) => `${at + 1}. ${choice.guess}: ${choice.why}`).join("\n");
  return ["## What I would build", "", build, "", "## Where I had to choose", "", chosen, ""].join("\n");
}

function coldRead(issue: string): Stop | undefined {
  const said = `cold-read: #${issue}`;
  const read = gh(["issue", "view", issue, "--json", "title,body,labels"]);
  const asked = read.status === 0 ? askedIssue(read.stdout) : undefined;
  if (asked === undefined) return stoppedAt("unread", `${said} could not be read, so nothing read it`);
  if (!asked.labels.some(({ name }) => name === SPEC_LABEL)) return stoppedAt("notSpec", `${said} is not a spec, so nothing read it`);
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: "cold reader", transcript: join(logs, `cold-read-${issue}.jsonl`), tools: TOOLS, reach: FENCED_OPUS, answers: ANSWERS });
  if (typeof spend === "string") return stoppedAt("modelRun", `${said} ended red, the owner's hooks could not be read from ${spend}`);
  const spent = spend(handedOn(asked.title, asked.body));
  if (spent.refusal !== undefined) return stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
  if (!isAnswer(spent.answer)) return stoppedAt("modelRun", `${said} ended red, the cold reader gave no answer`);
  const comment = commentOnTicket(issue, posted(spent.answer.build, spent.answer.choices), gh);
  const [refusal] = comment.refusals;
  if (refusal !== undefined) return stoppedAt("unrecorded", `${said} ended red, its comment would not post: ${quoted(refusal)}`);
  console.log(`${said} posted what it would build: ${comment.said}`);
  return undefined;
}

if (import.meta.main) {
  const issue = process.argv[2];
  if (issue === undefined) throw new Error("no issue number in the arguments");
  process.exit(exitFor(coldRead(issue)));
}
