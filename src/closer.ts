import { filedClosed, LABELLED_WAITING, splitClosed, splitInto, dependsOn } from "./builder.ts";
import { commentOnTicket, commentsRead, FAULT_FROM, gh, ghAs, ghRead, opened, readOrStop, unread, WAITING } from "./post.ts";
import { exitFor } from "./stops.ts";
import { quoted, waitsOn, why } from "./ticket-shape.ts";

const NAMED = /^(?:[ ,]*#\d+)+/;

const ticketState = (ticket: string, line: string) => ghRead(["issue", "view", ticket, "--json", "state,stateReason", "--jq", '.state + " " + .stateReason'], `the state of #${ticket} could not be read, ${line}`);

const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repository, GITHUB_RUN_ID: runId } = process.env;
const thisRun = server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : "a run outside Actions";

const ended = (ticket: string, held: string) => ticketState(ticket, `so #${held} is not woken`);
const hasEnded = (state: string) => state.startsWith("CLOSED") || state.startsWith("MERGED");
const stillWaits = (ticket: string, open: string[]) => `; #${ticket} still waits for ${open.map((waited) => `#${waited}`).join(", ")}`;

function openWaitedOn(ticket: string, body: string, known: string[]): string[] {
  return waitsOn(body).filter((waited) => waited !== ticket && !known.includes(waited) && !hasEnded(ended(waited, ticket)));
}

const howEnded = (states: { number: string; state: string }[]) => states.map(({ number, state }) => `#${number} ${state === "CLOSED COMPLETED" || state.startsWith("MERGED") ? "merged" : "closed unbuilt"}`).join(", ");

const dependedOnClosed = (ticket: string) => `Every ticket #${ticket} depends on has closed:`;

function wokenFromSplit(parent: string, body: string, split: string, said = splitInto(parent), closedLine = splitClosed(parent)): string {
  const pieces = ((NAMED.exec(split.slice(said.length).trimStart())?.[0] ?? "").match(/#\d+/g) ?? []).map((named) => named.slice(1));
  if (pieces.length === 0) return `; #${parent} waits, and no split record names what for`;
  const states = pieces.map((piece) => ({ piece, state: ended(piece, parent) }));
  const open = [...states.filter(({ state }) => !hasEnded(state)).map(({ piece }) => piece), ...openWaitedOn(parent, body, pieces)];
  if (open.length > 0) return stillWaits(parent, open);
  const how = howEnded(states.map(({ piece, state }) => ({ number: piece, state })));
  commentOnTicket(parent, `${closedLine} ${how}. #${parent} builds now.\n\nRun: ${thisRun}`, gh);
  const woke = gh(["issue", "edit", parent, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${parent} builds now, its split tickets all closed: ${how}` : `; #${parent} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
}

function wokenWaiting(ticket: string, body: string): string {
  const comments = commentsRead(ticket, `the comments on #${ticket} could not be read, so it is not woken`, gh);
  const parked = comments.filter((said) => said.includes(LABELLED_WAITING)).at(-1);
  if (parked?.startsWith(dependsOn(ticket)) === true) return wokenFromSplit(ticket, body, parked, dependsOn(ticket), dependedOnClosed(ticket));
  if (parked?.startsWith(splitInto(ticket)) === true) return wokenFromSplit(ticket, body, parked);
  return parked === undefined ? wokenFromWaitsOn(ticket, body) : "";
}

function wokenFromWaitsOn(ticket: string, body: string): string {
  const waited = waitsOn(body).filter((number) => number !== ticket);
  if (waited.length === 0) return "";
  const states = waited.map((number) => ({ number, state: ended(number, ticket) }));
  const open = states.filter(({ state }) => !hasEnded(state)).map(({ number }) => number);
  if (open.length > 0) return stillWaits(ticket, open);
  const how = howEnded(states);
  commentOnTicket(ticket, `${dependedOnClosed(ticket)} ${how}. #${ticket} builds now.\n\nRun: ${thisRun}`, gh);
  const woke = gh(["issue", "edit", ticket, "--remove-label", WAITING]);
  return woke.status === 0 ? `; #${ticket} builds now, everything it waits on closed: ${how}` : `; #${ticket} could not be woken: ${quoted((woke.stderr || woke.stdout).trim().split("\n")[0] ?? "")}`;
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
  const open = states.filter(({ state }) => !hasEnded(state)).map(({ number }) => `#${number}`);
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

if (import.meta.main) {
  process.exit(exitFor(readOrStop("close", () => close(process.argv[2]))));
}
