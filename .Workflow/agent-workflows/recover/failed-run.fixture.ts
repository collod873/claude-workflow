import { githubHoldingClaims, type ClaimHost } from "../shared/claim-host.fixture";

/**
 * A failed `Implement` run as GitHub reports it to Recover: the artifacts it uploaded, the log
 * line it echoed, and the marker comments already on its ticket — composed over the claim host
 * lane 05's own tests use (`shared/claim-host.fixture.ts`), because a recovered answer takes the
 * very same claim and lands through the very same code.
 *
 * @fixture Reached only from the suite, by design.
 */
export interface FailedRunOptions {
  artifacts?: string[];
  logLine?: string;
  comments?: string[];
  existingClaimBranch?: string;
  prCreateUrl?: string;
}

export function failedRunWith(options: FailedRunOptions = {}): ClaimHost {
  return githubHoldingClaims({
    existingClaim: options.existingClaimBranch ? { branch: options.existingClaimBranch, createdAt: null } : undefined,
    prCreate: options.prCreateUrl,
    answer: (args) => {
      if (args[0] === "api" && args[1]?.includes("/artifacts")) {
        return JSON.stringify({ artifacts: (options.artifacts ?? []).map((name) => ({ name })) });
      }
      if (args[0] === "run" && args[1] === "view") return options.logLine ?? "";
      if (args[0] === "run" && args[1] === "download") return "";
      if (args[0] === "issue" && args[1] === "view" && args[4] === "comments") {
        return JSON.stringify({ comments: (options.comments ?? []).map((body) => ({ body })) });
      }
      return undefined;
    },
  });
}
