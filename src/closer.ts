import { filedClosed, LABELLED_WAITING, splitClosed, splitInto } from "./builder.ts";
import { commentOnTicket, commentsRead, FAULT_FROM, gh, ghAs, ghRead, git, gitRead, markWith, opened, readOrStop, unread, WAITING } from "./post.ts";
import { exitFor, type Stop, stoppedAt } from "./stops.ts";
import { quoted, waitsOn, why } from "./ticket-shape.ts";

const NAMED = /^(?:[ ,]*#\d+)+/;

const quietly = { ...process.env, GH_TOKEN: process.env.QUIET_GH_TOKEN };
const quietGh = ghAs(quietly);
const mark = markWith(quietly);

const ticketState = (ticket: string, line: string) => ghRead(["issue", "view", ticket, "--json", "state,stateReason", "--jq", '.state + " " + .stateReason'], `the state of #${ticket} could not be read, ${line}`);

const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
const thisRun = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : "a run outside Actions";

interface Built {
  ticket: string;
  pr: string;
}

const record = ({ ticket, pr }: Built): string => `#${ticket} is done: PR #${pr} merged`;

const recorded = (said: string) => (said === "" ? "" : `; record ${said}`);


const ended = (ticket: string, held: string) => ticketState(ticket, `so #${held} is not woken`);
const stillWaits = (ticket: string, open: string[]) => `; #${ticket} still waits for ${open.map((waited) => `#${waited}`).join(", ")}`;

function openWaitedOn(ticket: string, body: string, known: string[]): string[] {
  return waitsOn(body).filter((waited) => waited !== ticket && !known.includes(waited) && !ended(waited, ticket).startsWith("CLOSED"));
}

const howEnded = (states: { number: string; state: string }[]) => states.map(({ number, state }) => `#${number} ${state === "CLOSED COMPLETED" ? "merged" : "closed unbuilt"}`).join(", ");

function wokenFromSplit(parent: string, body: string, split: string): string {
  const pieces = ((NAMED.exec(split.slice(splitInto(parent).length).trimStart())?.[0] ?? "").match(/#\d+/g) ?? []).map((named) => named.slice(1));
  if (pieces.length === 0) return `; #${parent} waits, and no split record names what for`;
  const states = pieces.map((piece) => ({ piece, state: ended(piece, parent) }));
  const open = [...states.filter(({ state }) => !state.startsWith("CLOSED")).map(({ piece }) => piece), ...openWaitedOn(parent, body, pieces)];
  if (open.length > 0) return stillWaits(parent, open);
  const how = howEnded(states.map(({ piece, state }) => ({ number: piece, state })));
  commentOnTicket(parent, `${splitClosed(parent)} ${how}. #${parent} builds now.\n\nRun: ${thisRun}`, gh);
  const woke = gh(["issue", "edit", parent, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${parent} builds now, its split tickets all closed: ${how}` : `; #${parent} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenWaiting(ticket: string, body: string): string {
  const comments = commentsRead(ticket, `the comments on #${ticket} could not be read, so it is not woken`, gh);
  const parked = comments.filter((said) => said.includes(LABELLED_WAITING)).at(-1);
  return parked?.startsWith(splitInto(ticket)) === true ? wokenFromSplit(ticket, body, parked) : "";
}

const filedHere = (repo: string) => new RegExp(`https://github\\.com/${repo.replaceAll(".", "\\.")}/issues/(\\d+)`, "g");

function wokenAtFaultOrigin(fault: string, body: string): string {
  const [, repo, origin] = FAULT_FROM.exec(why(body)) ?? [];
  const closedIn = process.env.GH_REPO;
  if (repo === undefined || origin === undefined || closedIn === undefined) return "";
  const at = `${repo}#${origin}`;
  const asked = opened(origin, `${at} could not be read, so it is not woken`, gh, repo);
  if (asked === "missing" || !(asked.labels ?? []).some(({ name }) => name === WAITING)) return "";
  const inOrigin = ghAs({ ...process.env, GH_REPO: repo });
  const parked = commentsRead(origin, `the comments on ${at} could not be read, so it is not woken`, inOrigin).filter((said) => said.includes(LABELLED_WAITING)).at(-1) ?? "";
  const filed = [...new Set(Array.from(parked.matchAll(filedHere(closedIn)), ([, number]) => number ?? ""))];
  if (!filed.includes(fault)) return "";
  const states = filed.map((number) => ({ number, state: ended(number, at) }));
  const open = states.filter(({ state }) => !state.startsWith("CLOSED")).map(({ number }) => `#${number}`);
  if (open.length > 0) return `; ${at} still waits for ${open.join(", ")}`;
  const how = howEnded(states);
  commentOnTicket(origin, `${filedClosed(origin)} ${how}. #${origin} builds now.\n\nRun: ${thisRun}`, inOrigin);
  const woke = inOrigin(["issue", "edit", origin, "--remove-label", WAITING]);
  return woke.status === 0 ? `; ${at} builds now, every ticket it filed and waits on closed: ${how}` : `; ${at} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenByClosedFault(closed: string | undefined): string {
  if (closed === undefined) return "";
  const body = ghRead(["issue", "view", closed, "--json", "body", "--jq", ".body"], `#${closed} could not be read, so the ticket waiting on it is not woken`);
  return wokenAtFaultOrigin(closed, body);
}

function wokenAfterParents(): string {
  const line = `the tickets labelled ${WAITING} could not be read, so none is woken`;
  const listed = ghRead(["issue", "list", "--state", "open", "--label", WAITING, "--limit", "100", "--json", "number,body"], line);
  let waiting: { number: number; body: string }[];
  try {
    waiting = JSON.parse(listed) as { number: number; body: string }[];
  } catch {
    return unread(line);
  }
  return waiting.map(({ number, body }) => wokenWaiting(String(number), body)).join("");
}

function close(closed: string | undefined): undefined {
  const woke = `${wokenAfterParents()}${wokenByClosedFault(closed)}`;
  console.log(`close: ${woke === "" ? "no waiting ticket woke" : woke.slice(2)}`);
  return undefined;
}

function closeMerged(merge: Built): Stop | undefined {
  const { ticket, pr } = merge;
  const asked = gh(["issue", "view", ticket, "--json", "body", "--jq", ".body"]);
  if (asked.status !== 0) return stoppedAt("unread", `close: ticket ${ticket} could not be read, so nothing judged it`);
  const posted = commentOnTicket(ticket, record(merge), gh);
  const [refusal] = posted.refusals;
  if (refusal !== undefined) return stoppedAt("unrecorded", `close: #${ticket} got no closing record: ${quoted(refusal)}`);
  const state = ticketState(ticket, "so it is not closed");
  mark(ticket, "--closed");
  if (state !== "CLOSED COMPLETED") {
    if (state.startsWith("CLOSED")) quietGh(["issue", "reopen", ticket]);
    if (quietGh(["issue", "close", ticket, "--reason", "completed"]).status !== 0) return stoppedAt("unrecorded", `close: #${ticket} is done but could not be closed${recorded(posted.said)}`);
  }
  console.log(`close: #${ticket} closed as completed, its PR merged${recorded(posted.said)}`);
  return undefined;
}

if (import.meta.main) {
  const [closed, pr] = process.argv.slice(2);
  process.exit(exitFor(readOrStop("close", () => (closed !== undefined && pr !== undefined ? closeMerged({ ticket: closed, pr }) : close(closed)))));
}
