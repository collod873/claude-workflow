import { capped, NO_EM_DASH } from "./brief.ts";
import { askedOn, commentOnTicket, commentsRead, endedRed, gh, MISSING, OWNER, readOrStop, REPAIR_HAND_OFF, standingOn, Stopped, STUCK, unread } from "./post.ts";
import { hireIn } from "./stage.ts";
import { quoted } from "./ticket-shape.ts";

export const ISSUE_CAP = 8 * 1024;
export const HAND_OFF_CAP = 8 * 1024;
const SAID_CAP = 8 * 1024;
const said = { type: "string", pattern: NO_EM_DASH, maxLength: SAID_CAP };

const ANSWER = {
  type: "object",
  properties: { outcome: { enum: ["fixed", "asks"] }, found: said, changed: said, question: said, recommendation: said },
  required: ["outcome", "found", "changed", "question", "recommendation"],
  additionalProperties: false,
};

interface Answer {
  outcome?: unknown;
  found?: unknown;
  changed?: unknown;
  question?: unknown;
  recommendation?: unknown;
}

interface Asking {
  repo: string;
  issue: string;
  title: string;
  body: string;
  handOff: string;
}

export function handedOn({ repo, issue, title, body, handOff }: Asking): string {
  return [
    `The machine marked ${repo}#${issue} \`${STUCK}\`. You are its repair agent, on the owner's PC as his own user: his checkouts and their \`.env.local\` files, his \`gh\`, Railway and other logins, and every tool in \`~/.agents/skills/bin\` (\`tools\` lists them) are yours. End what stopped it so he never has to look.`,
    "## What stopped it",
    capped(handOff, HAND_OFF_CAP),
    "## The issue",
    capped(`# ${title}\n\n${body}`, ISSUE_CAP),
    "## Your answer",
    "Read the stopped runs first (`gh run view <id> --log-failed`, their `machine-logs` artifact), then answer one way.",
    `\`fixed\`: you ended the cause. A fault in code lands through its repo's \`bin/land\` from a worktree off \`origin/main\`, its commit saying \`Refs #${issue}\`; a setting, secret or stale state you change directly. \`found\` says what stopped it, \`changed\` what you changed. The machine posts both and takes \`${STUCK}\` off, which resumes it; do neither yourself.`,
    "`asks`: only the owner can decide. Change nothing you cannot undo. `question` is one question a yes or no answers, `recommendation` your pick and why, `found` what you learned. The machine posts it to him.",
    "Spending his money, setting a live key where a test key belongs, or any step needing his identity is an `asks`, never a fix. Move a secret by command, never into your answer. Leave the fields the other outcome uses empty.",
    "",
  ].join("\n\n");
}

const filled = (value: unknown): value is string => typeof value === "string" && value.trim() !== "";

const handOffOn = (issue: string, line: string) => {
  const handOff = commentsRead(issue, line, gh).findLast((body) => body.includes(REPAIR_HAND_OFF));
  return handOff === undefined ? unread(line) : handOff.replace(REPAIR_HAND_OFF, "").trim();
};

const thisRun = () => {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = process.env;
  return server && repo && run ? ` Its run: ${server}/${repo}/actions/runs/${run}.` : "";
};

function posted(issue: string, text: string, saying: string): number | undefined {
  const [refusal] = commentOnTicket(issue, text, gh).refusals;
  return refusal === undefined ? undefined : endedRed(`${saying}, and its comment would not post: ${quoted(refusal)}`);
}

function resumed(issue: string, saying: string): number {
  const taken = gh(["api", "-X", "DELETE", `repos/{owner}/{repo}/issues/${issue}/labels/${STUCK}`]);
  if (taken.status !== 0 && !MISSING.test(taken.stderr)) return endedRed(`${saying}, and \`${STUCK}\` would not come off: ${quoted((taken.stderr || taken.stdout).trim().split("\n")[0] ?? "")}`);
  console.log(`${saying}, so \`${STUCK}\` is off and it resumes`);
  return 0;
}

async function repaired(issue: string): Promise<number> {
  const saying = `repair: #${issue}`;
  const asked = askedOn(issue, "so no repair agent was hired");
  if (asked.closed || !asked.labels.has(STUCK)) {
    console.log(`${saying} is ${asked.closed ? "closed" : `no longer \`${STUCK}\``}, so no repair agent was hired`);
    return 0;
  }
  const handOff = handOffOn(issue, `the hand-off on #${issue} could not be read, so no repair agent was hired`);
  const spend = hireIn(process.cwd(), "repair", issue, { name: "repair agent", model: "opus", effort: "high", answers: ANSWER }, { GH_TOKEN: "", GITHUB_TOKEN: "" });
  const spent = await spend(handedOn({ repo: process.env.GH_REPO ?? "", issue, title: asked.title, body: asked.body, handOff }));
  if (spent.refusal !== undefined) return endedRed(`${saying} ended red, ${spent.refusal}`);
  const { outcome, found, changed, question, recommendation } = (spent.answer ?? {}) as Answer;
  if (outcome === "fixed" && filled(found) && filled(changed)) {
    return posted(issue, `The repair agent fixed what stopped #${issue}.\n\n**What stopped it:** ${found}\n\n**What it changed:** ${changed}`, saying) ?? resumed(issue, `${saying} is fixed`);
  }
  if (outcome === "asks" && filled(found) && filled(question) && filled(recommendation)) {
    return posted(issue, `@${OWNER} the repair agent for #${issue} needs one answer from you: ${question}\n\n**Its pick:** ${recommendation}\n\n**What it found:** ${found}\n\nTake \`${STUCK}\` off once it is settled.`, saying) ?? 0;
  }
  return endedRed(`${saying} ended red, its repair agent gave no answer that fixes it or asks one question`);
}

const ENDED: Record<string, string> = { failure: "ended red", cancelled: "ran out of time or was cancelled" };

function unfinished(issue: string, ended: string): number {
  const saying = `repair: #${issue}`;
  if (!standingOn(issue, gh).labels.has(STUCK)) {
    console.log(`${saying} is no longer \`${STUCK}\`, so the owner is not called`);
    return 0;
  }
  let stopped = "";
  try {
    stopped = `\n\nWhat stopped #${issue}: ${handOffOn(issue, "no hand-off")}`;
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
  }
  const how = ENDED[ended] ?? "gave no answer";
  return posted(issue, `@${OWNER} the repair agent hired for #${issue} ${how} and did not finish, so #${issue} stays \`${STUCK}\` and needs you.${thisRun()} Take \`${STUCK}\` off once the cause is fixed.${stopped}`, saying) ?? 0;
}

if (import.meta.main) {
  const [mode, ...rest] = process.argv.slice(2);
  const unfinishing = mode === "--unfinished";
  const [issue, ended = ""] = unfinishing ? rest : [mode, ...rest];
  if (issue === undefined) throw new Error("no issue number in the arguments");
  process.exit(await readOrStop("repair", () => (unfinishing ? unfinished(issue, ended) : repaired(issue))));
}
