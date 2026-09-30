import { opened, type Opened } from "./admit.ts";
import { commentsOn, gh } from "./post.ts";
import { REVIEWED_FROM, SPLIT_FROM } from "./reviewer.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { why } from "./ticket-shape.ts";

const SPEC_LABEL = "spec";
const WAVE_NOTE = /^## Wave \d+\b/;
const MOVES = /<!-- moves: ([\d, ]*) -->/;
const DEEPEST = 20;
const LISTED = 500;

interface Listed {
  number: number;
  state?: string;
  body?: string;
}

interface Found {
  spec?: Opened;
  chain: string[];
}

export const followed = (body: string): string | undefined => {
  const said = why(body);
  return (REVIEWED_FROM.exec(said) ?? SPLIT_FROM.exec(said))?.[1];
};

function specOf(issue: string, chain: string[] = []): Found | "unread" {
  const parent = opened(`${issue}/parent`);
  if (parent === "unread") return "unread";
  if (parent !== "missing") return (parent.labels ?? []).some(({ name }) => name === SPEC_LABEL) ? { spec: parent, chain } : { chain };
  if (chain.length === DEEPEST) return { chain };
  const asked = opened(issue);
  if (asked === "unread") return "unread";
  const of = asked === "missing" ? undefined : followed(asked.body ?? "");
  return of === undefined ? { chain } : specOf(of, [...chain, issue]);
}

function lines(args: string[]): Listed[] | undefined {
  const got = gh(args);
  if (got.status !== 0) return undefined;
  try {
    return got.stdout
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Listed);
  } catch {
    return undefined;
  }
}

export const underSpec = (spec: string): Listed[] | undefined => lines(["api", "--paginate", `repos/{owner}/{repo}/issues/${spec}/sub_issues`, "--jq", ".[] | {number, state}"]);

function openFollowUps(tied: Set<string>): string[] | undefined {
  const listed = lines(["issue", "list", "--state", "open", "--limit", String(LISTED), "--json", "number,body", "--jq", ".[]"]);
  if (listed === undefined) return undefined;
  const still: string[] = [];
  for (let grew = true; grew; ) {
    grew = false;
    for (const { number, body } of listed) {
      const of = followed(body ?? "");
      if (of === undefined || !tied.has(of) || tied.has(String(number))) continue;
      tied.add(String(number));
      still.push(`#${number}`);
      grew = true;
    }
  }
  return still;
}

export const waveNotes = (comments: string[]): string[] => comments.filter((said) => WAVE_NOTE.test(said));

export function moved(comments: string[]): string {
  const marker = MOVES.exec(waveNotes(comments).at(-1) ?? "")?.[1] ?? "";
  return marker.split(/[,\s]+/).filter((number) => number !== "").join(",");
}

function waveEnded(issue: string): Stop | undefined {
  const found = specOf(issue);
  if (found === "unread") return stoppedAt("unread", `slice: #${issue} or the issue it follows up could not be read`);
  const { spec, chain } = found;
  if (spec?.number === undefined) {
    console.error(`slice: #${issue} is under no spec, so no wave ended`);
    return undefined;
  }
  if (spec.state !== "open") {
    console.error(`slice: #${issue} is under no open spec, so no wave ended`);
    return undefined;
  }
  const number = String(spec.number);
  const tickets = underSpec(number);
  if (tickets === undefined) return stoppedAt("unread", `slice: the tickets under #${number} could not be read`);
  const unclosed = tickets.filter(({ state }) => state === "open").map((one) => `#${one.number}`);
  const followUps = unclosed.length > 0 ? [] : openFollowUps(new Set([...tickets.map((one) => String(one.number)), ...chain]));
  if (followUps === undefined) return stoppedAt("unread", `slice: the open issues could not be read to find follow-ups of #${number}'s tickets`);
  const [still] = [...unclosed, ...followUps];
  if (still !== undefined) {
    console.error(`slice: #${number}'s wave is not over, ${still} is still open`);
    return undefined;
  }
  const comments = commentsOn(number, gh);
  if (comments === undefined) return stoppedAt("unread", `slice: the comments on #${number} could not be read`);
  console.log(`spec=${number}\nmoves=${moved(comments)}`);
  return undefined;
}

export const ended = (issue: string): number => exitFor(waveEnded(issue));
