import { type Admission, commentOnTicket, gh, opened, OWNER, underOwnerSpec } from "./post.ts";
import { REVIEWED_FROM, SPLIT_FROM } from "./reviewer.ts";
import { why } from "./ticket-shape.ts";

export const doesNotBuild = (ticket: string, refused: string) =>
  `#${ticket} does not build, since its checks would run as shell with the App's token and ${refused}. A ticket the App opens builds only as the reviewer's or the builder's follow-up, or under an open spec the owner opened.`;

export function admission(ticket: string): Admission {
  const asked = opened(ticket, gh);
  if (typeof asked === "string") return { unread: `#${ticket} could not be read` };
  const said = why(asked.body ?? "");
  if (asked.user?.login === OWNER || REVIEWED_FROM.test(said) || SPLIT_FROM.test(said)) return {};
  return underOwnerSpec(ticket, gh);
}

function admit(ticket: string): number {
  const { refused, unread } = admission(ticket);
  if (unread !== undefined) {
    console.error(`admit: ${unread}, so nothing was admitted`);
    return 1;
  }
  if (refused !== undefined) {
    const [unsaid] = commentOnTicket(ticket, doesNotBuild(ticket, refused), gh).refusals;
    if (unsaid !== undefined) console.error(`admit: #${ticket} was refused and not told why: ${unsaid}`);
    console.log("admitted=false");
    return 0;
  }
  console.log("admitted=true");
  return 0;
}

if (import.meta.main) {
  const [ticket] = process.argv.slice(2);
  if (ticket === undefined) throw new Error("no ticket number in the arguments");
  process.exit(admit(ticket));
}
