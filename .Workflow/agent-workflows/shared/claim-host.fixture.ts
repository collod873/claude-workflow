import type { GhExec } from "./gh";
import { createFakeGh, simulateClaimRef, type FakeDispatch } from "./gh.fake";
import { createFakeGit, type FakeGit } from "./git.fake";

/**
 * GitHub as the claim primitive sees it (`./implementation-landing.ts`, #179/#196): the set of refs
 * that exist — so `POST git/refs` 422s on one already there and succeeds once it is deleted — plus
 * what GitHub reports about a claim a run found standing: how many pull requests name it, how many
 * commits it carries, when it was created. Those three are exactly what `assessClaim` reads to tell
 * a live run from a dead one's debris, so a takeover test is only about anything if they are
 * modelled honestly.
 *
 * The ticket read, the comment, the escalation and the pull request are answered here too, because
 * every path through `runImplement`, `runRecover` and `landAnswer` makes them. Anything one case
 * models beyond that is `answer`, asked first; whatever nobody answers falls through to
 * `createFakeGh`, which records a dispatch and refuses everything else out loud.
 *
 * @fixture Reached only from the suites, by design.
 */
export interface ExistingClaim {
  branch: string;
  pullRequests?: number;
  commitsAhead?: number;
  createdAt?: string | null;
}

export interface ClaimHostOptions {
  ticket?: { title: string; body: string; state?: string };
  existingClaim?: ExistingClaim;
  prCreate?: string | Error;
  answer?: (args: string[]) => string | undefined;
}

export interface ClaimHost {
  gh: GhExec;
  calls: string[][];
  refs: Set<string>;
  dispatches: FakeDispatch[];
}

export const NOW = new Date("2026-08-28T22:00:00Z");

export const minutesAgo = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

export const HEAD_SHA = "0123456789abcdef0123456789abcdef01234567";
export const PR_URL = "https://github.com/owner/repo/pull/42";
export const TICKET = { title: "Do the thing", body: "## Files claimed\n- a/b.ts\n" };

export function githubHoldingClaims(options: ClaimHostOptions = {}): ClaimHost {
  const fallback = createFakeGh();
  const calls: string[][] = [];
  const refs = new Set<string>();
  const claim = options.existingClaim;
  if (claim) refs.add(claim.branch);

  const answerClaim = (args: string[]): string | undefined => {
    const claimed = simulateClaimRef(args, refs);
    if (claimed !== undefined) return claimed;
    if (args[0] === "pr" && args[1] === "list") {
      return JSON.stringify(Array.from({ length: claim?.pullRequests ?? 0 }, (_, index) => ({ number: index + 1 })));
    }
    if (args[0] === "api" && args[1].includes("/compare/")) return JSON.stringify({ ahead_by: claim?.commitsAhead ?? 0 });
    if (args[0] === "api" && args[1].includes("/activity?")) {
      const createdAt = claim?.createdAt === undefined ? NOW.toISOString() : claim.createdAt;
      return JSON.stringify(createdAt === null ? [] : [{ timestamp: createdAt }]);
    }
    if (args[0] === "issue" && args[1] === "view") return JSON.stringify(options.ticket ?? TICKET);
    if (args[0] === "issue" || args[0] === "label") return "";
    if (args[0] === "pr" && args[1] === "create") {
      const pr = options.prCreate ?? PR_URL;
      if (pr instanceof Error) throw pr;
      return `${pr}\n`;
    }
    return undefined;
  };

  const gh: GhExec = (args) => {
    calls.push([...args]);
    return options.answer?.(args) ?? answerClaim(args) ?? fallback.gh(args);
  };
  return { gh, calls, refs, dispatches: fallback.dispatches };
}

export function checkoutReporting(
  status: (paths: string[]) => string = (paths) => paths.map((path) => ` M ${path}`).join("\n"),
): FakeGit {
  return createFakeGit((args) => {
    if (args[0] === "rev-parse") return `${HEAD_SHA}\n`;
    if (args[0] === "status") return status(args.slice(args.indexOf("--") + 1));
    return "";
  });
}

export const refDeletesIn = (calls: string[][]): string[][] =>
  calls.filter((call) => call[0] === "api" && call[1] === "--method" && call[2] === "DELETE");

export const ticketCommentsIn = (calls: string[][]): string[] =>
  calls.filter((call) => call[0] === "issue" && call[1] === "comment").map((call) => call[call.indexOf("--body") + 1]);

export const prCreatesIn = (calls: string[][]): string[][] => calls.filter((call) => call[0] === "pr" && call[1] === "create");
