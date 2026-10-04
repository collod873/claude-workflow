import { capped } from "./brief.ts";
import { commentsRead, gh, ghRead, ghWhole, heldOf, opened, type Opened, prOfTicket, readOrStop, unread } from "./post.ts";
import { REVIEWED_FROM, SPLIT_FROM } from "./reviewer.ts";
import { NOTE, SPEC, type LabelName } from "./spelled.ts";
import { exitFor, stoppedAt, type Stop } from "./stops.ts";
import { why } from "./ticket-shape.ts";

const UNSLICED_LABELS: LabelName[] = [SPEC, NOTE];
const WAVE_HEADING = "## Wave ";
const MOVES_OPEN = "<!-- moves: ";
const MOVES_CLOSE = " -->";
const WAVE_NOTE = new RegExp(`^${WAVE_HEADING}\\d+\\b`);
const MOVES = new RegExp(`${MOVES_OPEN}([\\d, ]*)${MOVES_CLOSE}`);
export const waveHeading = (number: number) => `${WAVE_HEADING}${number}`;
export const movesMarker = (moves: number[]) => `${MOVES_OPEN}${moves.join(", ")}${MOVES_CLOSE}`;
const DEEPEST = 20;
const LISTED = 500;

interface Listed {
  number: number;
  title?: string;
  state?: string;
  state_reason?: string | null;
  body?: string;
}

export const FOUND_CAP = 32 * 1024;
export const DIFF_CAP = 48 * 1024;
const CUT_NOTE_CAP = 1024;
const SAID_CAP = 2 * 1024;

interface Found {
  spec?: Opened;
  chain: string[];
}

const followed = (body: string): string | undefined => {
  const said = why(body);
  return (REVIEWED_FROM.exec(said) ?? SPLIT_FROM.exec(said))?.[1];
};

function specOf(issue: string, chain: string[] = []): Found | "unread" {
  const parent = opened(`${issue}/parent`, gh);
  if (parent === "unread") return "unread";
  if (parent !== "missing") return heldOf(parent.labels).has(SPEC) ? { spec: parent, chain } : { chain };
  if (chain.length === DEEPEST) return { chain };
  const asked = opened(issue, gh);
  if (asked === "unread") return "unread";
  const of = asked === "missing" ? undefined : followed(asked.body ?? "");
  return of === undefined ? { chain } : specOf(of, [...chain, issue]);
}

function lines(args: string[], unreadLine: string): Listed[] {
  const listed = ghRead(args, unreadLine);
  try {
    return listed
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as Listed);
  } catch {
    return unread(unreadLine);
  }
}

export const underSpec = (spec: string, so: string): Listed[] => lines(["api", "--paginate", `repos/{owner}/{repo}/issues/${spec}/sub_issues`, "--jq", ".[] | {number, title, state, state_reason}"], `the tickets under #${spec} could not be read, ${so}`);

const UNSPENT = "so no model was spent";
const NO_WAVE_ENDED = "so no wave ended";

function prOf(ticket: number): string {
  const pr = prOfTicket(String(ticket), ["state", "files"], gh);
  if (pr === "none") return "Its PR: none";
  return `Its PR: ${pr.state ?? "unknown"}, touching ${(pr.files ?? []).map(({ path }) => path).join(", ") || "no file"}`;
}

function ticketFound(ticket: Listed): string {
  const said = commentsRead(String(ticket.number), `the comments on #${ticket.number} could not be read, ${UNSPENT}`, gh).map((comment) => capped(comment.trim(), SAID_CAP));
  return [`### #${ticket.number}, ${ticket.title ?? ""}: ${ticket.state ?? "unknown"}, ${ticket.state_reason ?? "no reason"}`, prOf(ticket.number), ...said].join("\n\n");
}

export const waveFound = (tickets: Listed[]): string =>
  capped(
    newestFirst(tickets)
      .map(ticketFound)
      .join("\n\n"),
    FOUND_CAP,
  );

const newestFirst = (tickets: Listed[]): Listed[] => [...tickets].sort((one, other) => other.number - one.number);

export function waveDiffs(tickets: Listed[]): string {
  const merged = newestFirst(tickets).filter(({ number }) => {
    const pr = prOfTicket(String(number), ["state"], gh);
    return pr !== "none" && pr.state === "MERGED";
  });
  const shown = merged.map(({ number }) => {
    const diff = ghWhole(["pr", "diff", `ticket/${number}`], `the diff of #${number}'s PR could not be read, ${UNSPENT}`);
    return { number, text: `### #${number}'s PR\n\n${diff}` };
  });
  const all = shown.map(({ text }) => text).join("\n\n");
  if (Buffer.byteLength(all) <= DIFF_CAP) return all;
  const kept = DIFF_CAP - CUT_NOTE_CAP;
  let upTo = 0;
  const cutAt = shown.findIndex(({ text }) => (upTo += Buffer.byteLength(text) + 2) > kept);
  const unshown = shown.slice(cutAt + 1).map(({ number }) => `#${number}`);
  return capped(all, kept) + capped(`\n\n(cut at the ${DIFF_CAP} byte cap inside #${shown[cutAt]?.number ?? ""}'s diff; not shown: ${unshown.join(", ") || "none"})`, CUT_NOTE_CAP);
}

function openFollowUps(tied: Set<string>, unreadLine: string): string[] {
  const listed = lines(["issue", "list", "--state", "open", "--limit", String(LISTED), "--json", "number,body", "--jq", ".[]"], unreadLine);
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

function moved(comments: string[]): string {
  const marker = MOVES.exec(waveNotes(comments).at(-1) ?? "")?.[1] ?? "";
  return marker.split(/[,\s]+/).filter((number) => number !== "").join(",");
}

function waveEnded(issue: string): Stop | undefined {
  const closed = opened(issue, gh);
  if (closed === "unread") return stoppedAt("unread", `slice: #${issue} could not be read`);
  const label = closed === "missing" ? undefined : UNSLICED_LABELS.find((one) => heldOf(closed.labels).has(one));
  if (label !== undefined) {
    console.error(`slice: #${issue} is a ${label}, so no wave ended`);
    return undefined;
  }
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
  const tickets = underSpec(number, NO_WAVE_ENDED);
  const unclosed = tickets.filter(({ state }) => state === "open").map((one) => `#${one.number}`);
  const followUps = unclosed.length > 0 ? [] : openFollowUps(new Set([...tickets.map((one) => String(one.number)), ...chain]), `the open issues could not be read to find follow-ups of #${number}'s tickets, ${NO_WAVE_ENDED}`);
  const [still] = [...unclosed, ...followUps];
  if (still !== undefined) {
    console.error(`slice: #${number}'s wave is not over, ${still} is still open`);
    return undefined;
  }
  const comments = commentsRead(number, `the comments on #${number} could not be read, ${NO_WAVE_ENDED}`, gh);
  console.log(`spec=${number}\nmoves=${moved(comments)}`);
  return undefined;
}

export const ended = (issue: string): number => exitFor(readOrStop("slice", () => waveEnded(issue)));
