import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { UNFENCED } from "./fence.ts";
import { askedIssue, commentOnTicket, gh } from "./post.ts";
import { NO_EM_DASH } from "./reviewer.ts";
import { hired, machineLogs } from "./stage.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { quoted, sentences, SPEC_CAP } from "./ticket-shape.ts";

const SPEC_LABEL = "spec";
const OUTCOMES = { held: "Held", missed: "Did not hold", owner: "Put to the owner" } as const;
type Outcome = keyof typeof OUTCOMES;

const TRIES = {
  type: "object",
  properties: {
    tries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: { type: "integer", minimum: 1 },
          outcome: { type: "string", enum: Object.keys(OUTCOMES) },
          tried: { type: "string", pattern: NO_EM_DASH },
        },
        required: ["sentence", "outcome", "tried"],
        additionalProperties: false,
      },
    },
  },
  required: ["tries"],
  additionalProperties: false,
};

interface Try {
  sentence: number;
  outcome: Outcome;
  tried: string;
}

export function handedOn(title: string, body: string): string {
  return [
    "Try each sentence under `## I'll know it works when I can` in this spec on the running system, not on its tests, and say how each came out. For this repo the running system is its own Actions runs and the issues and PRs they touched, read with `gh`. Read and run what you need, and leave the repo and GitHub as they are.",
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Your answer",
    "`tries`: one item per sentence, `sentence` its number counting from 1 in the order the spec lists them. `outcome`: `held` when you saw it hold, `missed` when you saw it fail, `owner` when only the owner can try it, needing the owner's phone, eyes or a real customer. `tried`: what you did to try it and what you saw, or for `owner`, what the owner should do to try it.",
    "",
  ].join("\n\n");
}

const isTry = (given: unknown): given is Try => {
  const one = given as Partial<Try> | undefined;
  return typeof one?.sentence === "number" && typeof one.tried === "string" && typeof one.outcome === "string" && one.outcome in OUTCOMES;
};

const posted = (said: string[], tries: Try[]) =>
  ["## Done check", "", ...said.flatMap((sentence, at) => tries.filter((one) => one.sentence === at + 1).map((one) => `${at + 1}. **${OUTCOMES[one.outcome]}**: ${sentence}\n   ${one.tried}`)), ""].join("\n");

function doneCheck(issue: string): Stop | undefined {
  const said = `done-check: #${issue}`;
  const read = gh(["issue", "view", issue, "--json", "title,body,labels"]);
  const asked = read.status === 0 ? askedIssue(read.stdout) : undefined;
  if (asked === undefined) return stoppedAt("unread", `${said} could not be read, so nothing was tried`);
  if (!asked.labels.some(({ name }) => name === SPEC_LABEL)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was tried`);
  const listed = sentences(asked.body).map(({ said: sentence }) => sentence);
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: "done checker", transcript: join(logs, `done-check-${issue}.jsonl`), reach: UNFENCED, answers: TRIES });
  if (typeof spend === "string") return stoppedAt("modelRun", `${said} ended red, the owner's hooks could not be read from ${spend}`);
  const spent = spend(handedOn(asked.title, asked.body));
  if (spent.refusal !== undefined) return stoppedAt("modelRun", `${said} ended red, ${spent.refusal}`);
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  const tries = Array.isArray(given) ? given.filter(isTry) : [];
  const comment = commentOnTicket(issue, posted(listed, tries), gh);
  const [refusal] = comment.refusals;
  if (refusal !== undefined) return stoppedAt("unrecorded", `${said} ended red, its comment would not post: ${quoted(refusal)}`);
  if (listed.some((_, at) => !tries.some((one) => one.sentence === at + 1 && one.outcome === "held"))) {
    console.log(`${said} did not hold every sentence, so it stays open: ${comment.said}`);
    return undefined;
  }
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `${said} held every sentence but would not close: ${comment.said}`);
  console.log(`${said} held every sentence and is closed: ${comment.said}`);
  return undefined;
}

if (import.meta.main) {
  const issue = process.argv[2];
  if (issue === undefined) throw new Error("no issue number in the arguments");
  process.exit(exitFor(doneCheck(issue)));
}
