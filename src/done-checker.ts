import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { capped } from "./brief.ts";
import { UNFENCED } from "./fence.ts";
import { askedIssue, commentOnTicket, commentsOn, gh, type Asked } from "./post.ts";
import { NO_EM_DASH } from "./reviewer.ts";
import { hired, machineLogs } from "./stage.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { quoted, type Sentence, sentences, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Refused: the issue is not labelled `spec`, or the done check finds no sentence to try",
  calledOwner: "Done check: a sentence missed twice, so the spec is marked `needs-human`",
});
type Stop = ReturnType<typeof stoppedAt>;

const SPEC_LABEL = "spec";
const NEEDS_HUMAN = "needs-human";
const CHECK_MINUTES = 10;
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

const numbered = (ran: number[]) => (ran.length === 1 ? `Sentence ${ran.join("")} carries a check command the machine ran itself; give no try for it.` : `Sentences ${ran.join(", ")} carry a check command the machine ran itself; give no try for them.`);

const waveOnly = (wave: number[]) =>
  `This is a wave check: try only sentences ${wave.join(", ")}, the ones the wave just closed should have moved, and give no try for any other. Answer \`owner\` for one only the owner can try, without trying it; it waits for the end.`;

export function handedOn(title: string, body: string, { ran = [], wave }: { ran?: number[]; wave?: number[] } = {}): string {
  return [
    "Try each sentence under `## I'll know it works when I can` in this spec on the running system, not on its tests, and say how each came out. For this repo the running system is its own Actions runs and the issues and PRs they touched, read with `gh`. Read and run what you need, and leave the repo and GitHub as they are.",
    ...(wave === undefined ? [] : [waveOnly(wave)]),
    ...(ran.length === 0 ? [] : [numbered(ran)]),
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    "## Your answer",
    "`tries`: one item per sentence, `sentence` its number counting from 1 in the order the spec lists them. `outcome`: `held` when you saw it hold, `missed` when you saw it fail, `owner` when only the owner can try it, needing the owner's phone, eyes or a real customer. `tried`: what you did to try it and what you saw, or for `owner`, what the owner should do to try it.",
    "",
  ].join("\n\n");
}

function ranItself(check: string, sentence: number): Try {
  const { status } = spawnSync("bash", ["-c", check], { stdio: "ignore", timeout: CHECK_MINUTES * 60_000 });
  const exited = status === null ? `ran past its ${CHECK_MINUTES} minute cap` : `exited ${status}`;
  return { sentence, outcome: status === 0 ? "held" : "missed", tried: `Ran \`${check}\`, which ${exited}.` };
}

const isTry = (given: unknown): given is Try => {
  const one = given as Partial<Try> | undefined;
  return typeof one?.sentence === "number" && typeof one.tried === "string" && typeof one.outcome === "string" && one.outcome in OUTCOMES;
};

const posted = (tried: [string, Try][]) => ["## Done check", "", ...tried.map(([sentence, one], at) => `${at + 1}. **${OUTCOMES[one.outcome]}**: ${sentence}\n   ${one.tried}`), ""].join("\n");

const WAVE_CHECK = "## Wave check";
const WAVE_OUTCOMES: Record<Outcome, string> = { ...OUTCOMES, owner: "Waits for the end" };
const WAVE_MISSED = /^- Sentence (\d+), \*\*Did not hold\*\*/gm;

const wavePosted = (tried: [number, string, Try][], repeated: [number, string, Try][]) =>
  [
    WAVE_CHECK,
    "",
    ...tried.map(([number, sentence, one]) => `- Sentence ${number}, **${WAVE_OUTCOMES[one.outcome]}**: ${sentence}${one.outcome === "owner" ? "" : `\n  ${one.tried}`}`),
    ...repeated.flatMap(([number, sentence, one]) => ["", `Sentence ${number} missed at this wave check and the last one, so the spec is marked \`${NEEDS_HUMAN}\`: ${sentence}. Why: ${one.tried}`]),
    "",
  ].join("\n");

function triedByModel(issue: string, asked: Asked, ran: number[], wave?: number[]): Try[] | string {
  const logs = machineLogs(process.cwd());
  mkdirSync(logs, { recursive: true });
  const spend = hired({ name: "done checker", transcript: join(logs, `done-check-${issue}.jsonl`), reach: UNFENCED, answers: TRIES });
  if (typeof spend === "string") return `the owner's hooks could not be read from ${spend}`;
  const spent = spend(handedOn(asked.title, asked.body, { ran, wave }));
  if (spent.refusal !== undefined) return spent.refusal;
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  return Array.isArray(given) ? given.filter(isTry).filter(({ sentence }) => !ran.includes(sentence)) : [];
}

interface Read {
  issue: string;
  said: string;
  asked: Asked;
  comments: string[];
  listed: Sentence[];
}

function read(issue: string): Read | Stop {
  const said = `done-check: #${issue}`;
  const view = gh(["issue", "view", issue, "--json", "title,body,labels"]);
  const asked = view.status === 0 ? askedIssue(view.stdout) : undefined;
  if (asked === undefined) return stoppedAt("unread", `${said} could not be read, so nothing was tried`);
  if (!asked.labels.some(({ name }) => name === SPEC_LABEL)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was tried`);
  const listed = sentences(asked.body);
  if (listed.length === 0) return stoppedAt("notSpec", `${said} carries no sentence to try, so nothing was tried or closed`);
  const comments = commentsOn(issue, gh);
  if (comments === undefined) return stoppedAt("unread", `${said} could not read its comments, so nothing was tried`);
  return { issue, said, asked, comments, listed };
}

function tried({ issue, said, asked, listed }: Read, numbers: number[], wave?: number[]): [number, string, Try][] | Stop {
  const ran = numbers.flatMap((number) => {
    const check = listed[number - 1]?.check;
    return check === undefined ? [] : [ranItself(check, number)];
  });
  const given = ran.length === numbers.length ? [] : triedByModel(issue, asked, ran.map(({ sentence }) => sentence), wave);
  if (typeof given === "string") return stoppedAt("modelRun", `${said} ended red, ${given}`);
  const tries = [...ran, ...given];
  const found: [number, string, Try][] = [];
  for (const number of numbers) {
    const one = tries.find(({ sentence }) => sentence === number);
    if (one === undefined) return stoppedAt("modelRun", `${said} ended red, the done checker gave no try for sentence ${number}`);
    found.push([number, listed[number - 1]?.said ?? "", one]);
  }
  return found;
}

function commented({ issue, said }: Read, text: string): { url: string } | Stop {
  const comment = commentOnTicket(issue, text, gh);
  const [refusal] = comment.refusals;
  return refusal === undefined ? { url: comment.said } : stoppedAt("unrecorded", `${said} ended red, its comment would not post: ${quoted(refusal)}`);
}

function waveCheck(issue: string, wave: number[]): Stop | undefined {
  const spec = read(issue);
  if (typeof spec === "string") return spec;
  const beyond = wave.find((number) => number < 1 || number > spec.listed.length);
  if (beyond !== undefined) return stoppedAt("notSpec", `${spec.said} carries no sentence ${beyond}, so nothing was tried`);
  const found = tried(spec, wave, wave);
  if (!Array.isArray(found)) return found;
  const last = spec.comments.filter((comment) => comment.startsWith(WAVE_CHECK)).at(-1) ?? "";
  const missedBefore = new Set([...last.matchAll(WAVE_MISSED)].map(([, number]) => Number(number)));
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  const repeated = missed.filter(([number]) => missedBefore.has(number));
  const comment = commented(spec, wavePosted(found, repeated));
  if (typeof comment === "string") return comment;
  const posted = comment.url;
  if (repeated.length > 0) {
    gh(["issue", "edit", issue, "--add-label", NEEDS_HUMAN]);
    return stoppedAt("calledOwner", `${spec.said} marked ${NEEDS_HUMAN}, sentence ${repeated.map(([number]) => number).join(", ")} missed at two wave checks in a row: ${posted}`);
  }
  const outcome = missed.length === 0 ? "held every sentence it tried" : `missed sentence ${missed.map(([number]) => number).join(", ")}`;
  console.log(`${spec.said} wave check ${outcome}, and closes nothing: ${posted}`);
  return undefined;
}

function doneCheck(issue: string): Stop | undefined {
  const spec = read(issue);
  if (typeof spec === "string") return spec;
  const found = tried(
    spec,
    spec.listed.map((_, at) => at + 1),
  );
  if (!Array.isArray(found)) return found;
  const posting = posted(found.map(([, sentence, one]) => [sentence, one]));
  const commentedOn = commented(spec, posting);
  if (typeof commentedOn === "string") return commentedOn;
  const { said } = spec;
  const comment = commentedOn.url;
  if (found.some(([, , one]) => one.outcome !== "held")) {
    console.log(`${said} did not hold every sentence, so it stays open: ${comment}`);
    return undefined;
  }
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `${said} held every sentence but would not close: ${comment}`);
  console.log(`${said} held every sentence and is closed: ${comment}`);
  return undefined;
}

if (import.meta.main) {
  const [issue, flag, numbers] = process.argv.slice(2);
  if (issue === undefined) throw new Error("no issue number in the arguments");
  const wave = flag === "--wave" ? (numbers ?? "").split(/[ ,]+/).filter((number) => number !== "").map(Number) : undefined;
  process.exit(exitFor(wave === undefined ? doneCheck(issue) : waveCheck(issue, wave)));
}
