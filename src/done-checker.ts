import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { capped, NO_EM_DASH, onDisk } from "./brief.ts";
import { UNFENCED } from "./fence.ts";
import { authoredOn, CALLER_FILE, commentOnTicket, commentsRead, FOREIGN, gh, machineBin, mark, OWNER, readOrStop, STUCK, unread, type Asked } from "./post.ts";
import { CONTRACT, opened, setupRefusal, type Spent, treePathed } from "./stage.ts";
import { CHECKING, SPEC } from "./spelled.ts";
import { exitFor, stopsOf } from "./stops.ts";
import { filedRecord, quoted, type Sentence, sentences, SPEC_CAP } from "./ticket-shape.ts";

const stoppedAt = stopsOf({
  notSpec: "Refused: the issue is not labelled `spec`, or the done check finds no sentence to try",
  calledOwner: "Done check: a sentence missed twice, so the spec is marked `stuck`",
  unfixed: "Done check: `bin/slice --fix` files no fix wave for the sentences that missed",
  unready: "Done check: the tree's setup from its contract fails, so nothing is tried",
});
type Stop = ReturnType<typeof stoppedAt>;

const CHECK_MINUTES = 10;
const OUTCOMES = { held: "Held", missed: "Did not hold", owner: "Put to the owner", self: "Held", unexercised: "Not tried yet" } as const;
type Outcome = keyof typeof OUTCOMES;
const DONE_OUTCOMES = Object.keys(OUTCOMES).filter((outcome) => outcome !== "unexercised");

const triesOf = (outcomes: string[]) => ({
  type: "object",
  properties: {
    tries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          sentence: { type: "integer", minimum: 1 },
          outcome: { type: "string", enum: outcomes },
          tried: { type: "string", pattern: NO_EM_DASH },
        },
        required: ["sentence", "outcome", "tried"],
        additionalProperties: false,
      },
    },
  },
  required: ["tries"],
  additionalProperties: false,
});

interface Try {
  sentence: number;
  outcome: Outcome;
  tried: string;
}

const numbered = (ran: number[]) => (ran.length === 1 ? `Sentence ${ran.join("")} carries a check command the machine ran itself; give no try for it.` : `Sentences ${ran.join(", ")} carry a check command the machine ran itself; give no try for them.`);

const waveOnly = (wave: number[]) =>
  `This is a wave check: try only sentences ${wave.join(", ")}, the ones the wave just closed should have moved, and give no try for any other. Answer \`owner\` for one only the owner can try, without trying it; it waits for the end. Answer \`unexercised\` for one nothing on main could have shown yet, since what it needs has not run or merged; \`tried\` then says what would have to happen for it to be seen, and the next wave check tries it again.`;

export const REPLIES_CAP = 8 * 1024;

const answered = (replies: string) =>
  replies === "" ? [] : ["## The owner's replies since the last done check", capped(replies, REPLIES_CAP), "Where the owner says a sentence held or did not, his word is its try."];

const RUNNING_HERE = "For this repo the running system is its own Actions runs and the issues and PRs they touched, read with `gh`.";
const RUNNING_THERE = "Here the running system is this checkout of the repo, readied by its contract's setup, and its Actions runs and the issues and PRs they touched, read with `gh`.";

function trialCap(body: string): number {
  const { owner, record } = filedRecord(body);
  return Buffer.byteLength(owner) + Math.floor(Buffer.byteLength(record) / 2);
}

const trialRun = (issue: string, cap: number, caller?: string) =>
  caller === undefined ? { start: `gh workflow run reslice.yml -f issue=${issue} -f trial_cap=${cap}`, file: "reslice.yml" } : { start: `gh workflow run ${caller} -f ticket=${issue} -f reason=size-trial -f trial_cap=${cap}`, file: caller };

const sizeTrial = (issue: string, body: string, caller?: string) => {
  const { start, file } = trialRun(issue, trialCap(body), caller);
  return `To try a sentence about a wave going over the spec cap, start a size trial on this spec with a trial cap of the owner's bytes plus half the record's bytes, so the slicer's own folding cannot fit without being sent back: \`${start}\`. Starting a size trial counts as leaving GitHub as it is, since a trial posts nothing. Find its run with \`gh run list --workflow ${file}\`, wait for it with \`gh run watch <run> --exit-status\`, and answer from \`gh run view <run> --log\`: each size round with the bytes over and the bytes the record had to lose, and the \`slice: trial #${issue}\` line saying the owner's bytes stand and the seconds from the first size round. A trial that ends red, or whose filing line gives 60 seconds or more, is \`missed\`.`;
};

export function handedOn(title: string, body: string, { issue, ran = [], wave, replies = "", foreign = false, caller }: { issue?: string; ran?: number[]; wave?: number[]; replies?: string; foreign?: boolean; caller?: string } = {}): string {
  return [
    `Try each sentence under \`## I'll know it works when I can\` in this spec on the running system, not on its tests, and say how each came out. ${foreign ? RUNNING_THERE : RUNNING_HERE} Read and run what you need, and leave the repo and GitHub as they are.`,
    ...(issue === undefined ? [] : [sizeTrial(issue, body, caller)]),
    ...(wave === undefined ? [] : [waveOnly(wave)]),
    ...(ran.length === 0 ? [] : [numbered(ran)]),
    "## The spec",
    capped(`# ${title}\n\n${body}`, SPEC_CAP),
    ...answered(replies),
    "## Your answer",
    "`tries`: one item per sentence, `sentence` its number counting from 1 in the order the spec lists them. `outcome`: `held` when you saw it hold, `missed` when you saw it fail, `owner` when only the owner can try it, needing the owner's phone, eyes or a real customer. `self`, without trying it, for a sentence about the spec closing itself or the owner being told which sentence did not hold: this run is the one that closes the spec or names the miss, so the machine settles it from the other sentences. `tried`: what you did to try it and what you saw, or for `owner`, what the owner should do to try it.",
    "",
  ].join("\n\n");
}

function ranItself(check: string, sentence: number): Try {
  const { status } = spawnSync("bash", ["-c", check], { stdio: "ignore", env: treePathed(), timeout: CHECK_MINUTES * 60_000 });
  const exited = status === null ? `ran past its ${CHECK_MINUTES} minute cap` : `exited ${status}`;
  return { sentence, outcome: status === 0 ? "held" : "missed", tried: `Ran \`${check}\`, which ${exited}.` };
}

const isTry = (given: unknown): given is Try => {
  const one = given as Partial<Try> | undefined;
  return typeof one?.sentence === "number" && typeof one.tried === "string" && typeof one.outcome === "string" && one.outcome in OUTCOMES;
};

const DONE_CHECK_HEADING = "## Done check";
const FIX_WAVE = "<!-- fix-wave -->";
const spentFixWave = (comment: string) => comment.startsWith(DONE_CHECK_HEADING) && comment.trimEnd().split("\n").at(-1) === FIX_WAVE;

const posted = (tried: [number, string, Try][], after: string[] = []) =>
  [DONE_CHECK_HEADING, "", ...tried.map(([number, sentence, one]) => `${number}. **${OUTCOMES[one.outcome]}**: ${sentence}\n   ${one.tried}`), ...after.flatMap((line) => ["", line]), ""].join("\n");

const calledOwner = (missed: [number, string, Try][], when: string) =>
  missed.map(([number, sentence, one]) => `Sentence ${number} missed ${when}, so the spec is marked \`${STUCK}\`: ${sentence}. Why: ${one.tried}`);

const listing = (missed: [number, string, Try][], between: string) => missed.map(([number]) => number).join(between);
const CLOSED_WITH = "Closed with sentence";
const closedWith = (putToOwner: [number, string, Try][]) => `${CLOSED_WITH} ${listing(putToOwner, ", ")} put to the owner: each says what the owner could try, and a miss seen live is filed as a new ticket.`;

export const WAVE_CHECK_HEADING = "## Wave check";
const WAVE_OUTCOMES: Record<Outcome, string> = { ...OUTCOMES, owner: "Waits for the end", self: "Waits for the end" };
const waitsForTheEnd = (outcome: Outcome) => outcome === "owner" || outcome === "self";
const waveLine = (number: number | string, outcome: string) => `- Sentence ${number}, **${outcome}**`;
const givenIn = (outcome: string) => {
  const line = new RegExp(`^${waveLine("(\\d+)", outcome).replaceAll("*", "\\*")}`, "gm");
  return (waveCheck: string) => new Set([...waveCheck.matchAll(line)].map(([, number]) => Number(number)));
};
export const missedIn = givenIn(OUTCOMES.missed);
const unexercisedIn = givenIn(OUTCOMES.unexercised);

const wavePosted = (tried: [number, string, Try][], repeated: [number, string, Try][]) =>
  [
    WAVE_CHECK_HEADING,
    "",
    ...tried.map(([number, sentence, one]) => `${waveLine(number, WAVE_OUTCOMES[one.outcome])}: ${sentence}${waitsForTheEnd(one.outcome) ? "" : `\n  ${one.tried}`}`),
    ...calledOwner(repeated, "at this wave check and the last one").flatMap((line) => ["", line]),
    "",
  ].join("\n");

function triedByModel({ issue, asked, replies: owners, spend }: Read, ran: number[], wave?: number[]): Try[] | string {
  const replies = wave === undefined ? owners : "";
  const spent = spend(handedOn(asked.title, asked.body, { issue, ran, wave, replies, foreign: FOREIGN, caller: CALLER_FILE }));
  if (spent.refusal !== undefined) return spent.refusal;
  const given = (spent.answer as { tries?: unknown } | undefined)?.tries;
  return Array.isArray(given) ? given.filter(isTry).filter(({ sentence }) => !ran.includes(sentence)) : [];
}

interface Read {
  issue: string;
  said: string;
  asked: Asked;
  comments: string[];
  replies: string;
  listed: Sentence[];
  spend: (input: string) => Spent;
}

function read(issue: string, wave?: number[]): Read | Stop | undefined {
  const said = `done-check: #${issue}`;
  const opening = opened({
    stage: "done-check",
    issue,
    state: CHECKING,
    stoppedAt,
    hire: { name: "done checker", reach: UNFENCED, answers: triesOf(wave === undefined ? DONE_OUTCOMES : Object.keys(OUTCOMES)) },
    ready: (asked) => {
      if (!asked.labels.has(SPEC)) return stoppedAt("notSpec", `${said} is not a spec, so nothing was tried`);
      const listed = sentences(asked.body);
      if (listed.length === 0) return stoppedAt("notSpec", `${said} carries no sentence to try, so nothing was tried or closed`);
      const beyond = wave?.find((number) => number < 1 || number > listed.length);
      if (beyond !== undefined) return stoppedAt("notSpec", `${said} carries no sentence ${beyond}, so nothing was tried`);
      return { carrying: { listed, authored: authoredOn(issue, `#${issue} could not read its comments, so nothing was tried`, gh) } };
    },
  });
  if (typeof opening !== "object") return opening;
  const unready = setupRefusal(onDisk(join(process.cwd(), CONTRACT)) ?? "");
  if (unready !== undefined) return stoppedAt("unready", `${said} ended red, its tree's setup failed: ${quoted(unready)}`);
  const { asked, spend, carried: { listed, authored } } = opening;
  const comments = authored.map(({ body }) => body);
  const since = comments.map((comment) => comment.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  const replies = since === -1 ? "" : authored.slice(since + 1).flatMap(({ author, body }) => (author === OWNER ? [body] : [])).join("\n\n");
  return { issue, said, asked, comments, replies, listed, spend };
}

function tried(spec: Read, numbers: number[], wave?: number[]): [number, string, Try][] | Stop {
  const { said, listed } = spec;
  const ran = numbers.flatMap((number) => {
    const check = listed[number - 1]?.check;
    return check === undefined ? [] : [ranItself(check, number)];
  });
  const given = ran.length === numbers.length ? [] : triedByModel(spec, ran.map(({ sentence }) => sentence), wave);
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
  const spec = read(issue, wave);
  if (typeof spec !== "object") return spec;
  const lastWave = spec.comments.filter((comment) => comment.startsWith(WAVE_CHECK_HEADING)).at(-1) ?? "";
  const trying = [...new Set([...wave, ...unexercisedIn(lastWave)])].sort((one, other) => one - other);
  const found = tried(spec, trying, trying);
  if (!Array.isArray(found)) return found;
  const missedBefore = missedIn(lastWave);
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  const repeated = missed.filter(([number]) => missedBefore.has(number));
  const comment = commented(spec, wavePosted(found, repeated));
  if (typeof comment === "string") return comment;
  const posted = comment.url;
  if (repeated.length > 0) {
    mark(issue, STUCK);
    return stoppedAt("calledOwner", `${spec.said} marked ${STUCK}, sentence ${listing(repeated, ", ")} missed at two wave checks in a row: ${posted}`);
  }
  const outcome = missed.length === 0 ? "held every sentence it tried" : `missed sentence ${listing(missed, ", ")}`;
  console.log(`${spec.said} wave check ${outcome}, and closes nothing: ${posted}`);
  return undefined;
}

function fixWave(spec: Read, found: [number, string, Try][], missed: [number, string, Try][]): Stop | undefined {
  const { issue, said, comments } = spec;
  const lastWave = comments.map((comment) => comment.startsWith(WAVE_CHECK_HEADING)).lastIndexOf(true);
  const lastDone = comments.map((comment) => comment.startsWith(DONE_CHECK_HEADING)).lastIndexOf(true);
  const missedAtWave = lastWave > lastDone ? missedIn(comments[lastWave] ?? "") : new Set<number>();
  const repeated = missed.filter(([number]) => missedAtWave.has(number));
  if (repeated.length > 0) {
    const comment = commented(spec, posted(found, calledOwner(repeated, "at the last wave check and again at the end")));
    if (typeof comment === "string") return comment;
    mark(issue, STUCK);
    return stoppedAt("calledOwner", `${said} marked ${STUCK}, sentence ${listing(repeated, ", ")} missed at the last wave check and again at the end: ${comment.url}`);
  }
  if (comments.some(spentFixWave)) {
    const comment = commented(spec, posted(found, calledOwner(missed, "again after the fix wave")));
    if (typeof comment === "string") return comment;
    mark(issue, STUCK);
    return stoppedAt("calledOwner", `${said} marked ${STUCK}, sentence ${listing(missed, ", ")} missed again after the fix wave: ${comment.url}`);
  }
  const fixed = spawnSync(machineBin("slice"), [issue, "--fix", listing(missed, ",")], { encoding: "utf8" });
  const comment = commented(spec, posted(found, fixed.status === 0 ? [FIX_WAVE] : []));
  if (typeof comment === "string") return comment;
  const [why = ""] = `${fixed.stderr}${fixed.stdout}`.trim().split("\n");
  if (fixed.status !== 0) return stoppedAt("unfixed", `${said} did not hold sentence ${listing(missed, ", ")}, and bin/slice --fix filed no fix wave: ${JSON.stringify(quoted(why))}: ${comment.url}`);
  console.log(`${said} did not hold sentence ${listing(missed, ", ")}, so bin/slice --fix filed its one fix wave: ${comment.url}`);
  return undefined;
}

const SELF_SETTLED = {
  missed: "This run names each other sentence that did not hold, and why.",
  owner: "This run closed the spec, since every other sentence held or was put to the owner.",
  held: "This run closed the spec, since every other sentence held.",
};

const settled = (found: [number, string, Try][]): [number, string, Try][] => {
  const others = found.map(([, , one]) => one.outcome);
  const tried = SELF_SETTLED[others.includes("missed") ? "missed" : others.includes("owner") ? "owner" : "held"];
  return found.map(([number, sentence, one]) => [number, sentence, one.outcome === "self" ? { ...one, tried } : one]);
};

function doneCheck(issue: string): Stop | undefined {
  const spec = read(issue);
  if (typeof spec !== "object") return spec;
  const tries = tried(
    spec,
    spec.listed.map((_, at) => at + 1),
  );
  if (!Array.isArray(tries)) return tries;
  const unexercised = tries.filter(([, , one]) => one.outcome === "unexercised");
  if (unexercised.length > 0) return stoppedAt("modelRun", `${spec.said} ended red, the done checker gave sentence ${listing(unexercised, ", ")} as not tried yet, which only a wave check may give`);
  const found = settled(tries);
  const missed = found.filter(([, , one]) => one.outcome === "missed");
  if (missed.length > 0) return fixWave(spec, found, missed);
  const putToOwner = found.filter(([, , one]) => one.outcome === "owner");
  const comment = commented(spec, posted(found, putToOwner.length === 0 ? [] : [closedWith(putToOwner)]));
  if (typeof comment === "string") return comment;
  const { said } = spec;
  const held = putToOwner.length === 0 ? "held every sentence" : "held every sentence it could try, put the rest to the owner,";
  if (gh(["issue", "close", issue, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `${said} ${held} but would not close: ${comment.url}`);
  console.log(`${said} ${held} and is closed: ${comment.url}`);
  return undefined;
}

function askedOwner(issue: string): undefined {
  const comments = commentsRead(issue, `#${issue} could not read its comments, so nothing was asked`, gh);
  const last = comments.filter((comment) => comment.startsWith(DONE_CHECK_HEADING)).at(-1) ?? "";
  console.log(String(last.includes(`**${OUTCOMES.owner}**`) && !spentFixWave(last) && !last.includes(`\n${CLOSED_WITH} `)));
  return undefined;
}

if (import.meta.main) {
  const [issue, flag, numbers] = process.argv.slice(2);
  if (issue === undefined) throw new Error("no issue number in the arguments");
  const wave = flag === "--wave" ? (numbers ?? "").split(/[ ,]+/).filter((number) => number !== "").map(Number) : undefined;
  const ran = flag === "--asked" ? () => askedOwner(issue) : () => (wave === undefined ? doneCheck(issue) : waveCheck(issue, wave));
  process.exit(exitFor(readOrStop("done-check", ran)));
}
