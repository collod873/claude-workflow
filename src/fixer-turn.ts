import { commentOnTicket, commentsOn, type Gh } from "./post.ts";

const TOOK_ITS_TURN = "The fixer took its one turn on this ticket";
export const foundDrift = (ticket: string) => `The reviewer read this PR against the Why of #${ticket} and found drift.`;
export const repairOf = (ticket: string) => `Repair #${ticket} in the fixer's one turn`;

export function turnOn(ticket: string, pr: string | undefined, gh: Gh): { taken: boolean; earlier: string } | undefined {
  const turns = commentsOn(ticket, gh);
  if (turns === undefined) return undefined;
  const onPr = pr === undefined ? [] : commentsOn(pr, gh);
  if (onPr === undefined) return undefined;
  return {
    taken: turns.some((said) => said.startsWith(TOOK_ITS_TURN)),
    earlier: onPr.filter((said) => said.startsWith(foundDrift(ticket))).join("\n\n"),
  };
}

export const takeTurn = (ticket: string, gh: Gh) => commentOnTicket(ticket, `${TOOK_ITS_TURN}.`, gh);
