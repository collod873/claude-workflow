import { type Admission, commentOnTicket, FAULT_FROM, gh, opened, OWNER, readOrStop, REVIEWED_FROM, SPLIT_FROM, underOwnerSpec, unread } from "./post.ts";
import { exitFor } from "./stops.ts";
import { why } from "./ticket-shape.ts";

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as the reviewer's or the builder's follow-up, as a machine fault its builder filed from a ticket that builds in its own repo, or under an open spec the owner opened.`;

export function admission(ticket: string, so: string): Admission {
  const line = `#${ticket} could not be read, ${so}`;
  const asked = opened(ticket, line, gh);
  if (asked === "missing") return unread(line);
  const said = why(asked.body ?? "");
  if (asked.user?.login === OWNER || REVIEWED_FROM.test(said) || SPLIT_FROM.test(said)) return undefined;
  const [, repo, origin] = FAULT_FROM.exec(said) ?? [];
  if (repo === undefined || origin === undefined) return underOwnerSpec(ticket, `the parent of #${ticket} could not be read, ${so}`, gh);
  return faultAdmission(repo, origin, so);
}

function faultAdmission(repo: string, origin: string, so: string): Admission {
  const at = `${repo}#${origin}`;
  const asked = opened(origin, `${at} could not be read, ${so}`, gh, repo);
  if (asked === "missing") return `the App filed it as the machine's fault from ${at}, which does not exist`;
  if (asked.user?.login === OWNER) return undefined;
  const refused = underOwnerSpec(origin, `the parent of ${at} could not be read, ${so}`, gh, repo);
  return refused === undefined ? undefined : `the App filed it as the machine's fault from ${at}, where ${refused}`;
}

function admit(ticket: string): undefined {
  const refused = admission(ticket, "so nothing was admitted");
  if (refused !== undefined) {
    const [unsaid] = commentOnTicket(ticket, doesNotBuild(ticket, refused), gh).refusals;
    if (unsaid !== undefined) console.error(`admit: #${ticket} was refused and not told why: ${unsaid}`);
    console.log("admitted=false");
    return undefined;
  }
  console.log("admitted=true");
  return undefined;
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  process.exit(exitFor(readOrStop("admit", () => admit(ticket))));
}
