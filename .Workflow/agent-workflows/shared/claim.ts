import type { GhExec } from "./gh";
import { branchCreationPath, comparePath, GIT_REFS_PATH } from "./gh-paths";
import type { GitExec } from "./git";
import { reason } from "./reason";

export const CLAIM_TIMEOUT_MINUTES = 90;

export const LANE_BUDGET_MINUTES = 85;

function refPath(branch: string): string {
  return `${GIT_REFS_PATH}/heads/${branch}`;
}

function createClaimRef(gh: GhExec, branch: string, sha: string, log: (line: string) => void): boolean {
  try {
    gh(["api", GIT_REFS_PATH, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${sha}`]);
    return true;
  } catch (err) {
    log(`\`${branch}\` was not claimed here: ${reason(err)}`);
    return false;
  }
}

export function releaseDeadClaim(gh: GhExec, branch: string, base: string, log: (line: string) => void): boolean {
  try {
    if (hasPullRequest(gh, branch)) {
      log(`\`${branch}\` has a pull request, so its claim is somebody's finished work; left alone.`);
      return false;
    }
    if (commitsAhead(gh, branch, base) > 0) {
      log(`\`${branch}\` carries commits, so its claim is somebody's unfinished work; left alone.`);
      return false;
    }
  } catch (err) {
    log(`could not inspect \`${branch}\`, so its claim is left alone: ${reason(err)}`);
    return false;
  }
  releaseClaim(gh, branch, log);
  return true;
}

export function releaseClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
  try {
    gh(["api", "--method", "DELETE", refPath(branch)]);
    log(`released the claim on \`${branch}\``);
  } catch (err) {
    log(`could not release the claim on \`${branch}\`: ${reason(err)}`);
  }
}

function hasPullRequest(gh: GhExec, branch: string): boolean {
  const raw = gh(["pr", "list", "--head", branch, "--state", "all", "--json", "number"]);
  return (JSON.parse(raw) as unknown[]).length > 0;
}

function commitsAhead(gh: GhExec, branch: string, base: string): number {
  const raw = gh(["api", comparePath(base, branch)]);
  const ahead = (JSON.parse(raw) as { ahead_by?: unknown }).ahead_by;
  return typeof ahead === "number" ? ahead : 1;
}

function claimAgeMinutes(gh: GhExec, branch: string, now: Date): number | undefined {
  const raw = gh(["api", branchCreationPath(branch)]);
  const activity = (JSON.parse(raw) as Array<{ timestamp?: string }>)[0];
  if (!activity?.timestamp) return undefined;
  const created = Date.parse(activity.timestamp);
  if (Number.isNaN(created)) return undefined;
  return (now.getTime() - created) / 60_000;
}

function assessClaim(
  gh: GhExec,
  branch: string,
  base: string,
  now: Date,
  log: (line: string) => void,
): "live" | "stale" {
  try {
    if (hasPullRequest(gh, branch)) return "live";
    if (commitsAhead(gh, branch, base) > 0) return "live";
    const age = claimAgeMinutes(gh, branch, now);
    if (age === undefined) {
      log(`\`${branch}\` has no recorded creation time, so its claim is read as still held.`);
      return "live";
    }
    return age > CLAIM_TIMEOUT_MINUTES ? "stale" : "live";
  } catch (err) {
    log(`could not tell whether \`${branch}\`'s claim is still held, so it is: ${reason(err)}`);
    return "live";
  }
}

export interface ClaimOutcome {
  claimed: boolean;
  tookOverStaleClaim: boolean;
}

export function claimImplementationBranch(
  gh: GhExec,
  git: GitExec,
  branch: string,
  log: (line: string) => void = (line) => console.log(line),
  now: Date = new Date(),
): ClaimOutcome {
  const sha = git(["rev-parse", "HEAD"]).trim();
  if (createClaimRef(gh, branch, sha, log)) return { claimed: true, tookOverStaleClaim: false };

  if (assessClaim(gh, branch, sha, now, log) === "live") return { claimed: false, tookOverStaleClaim: false };

  log(`\`${branch}\` is a claim no run is holding; taking it over.`);
  releaseClaim(gh, branch, log);
  if (!createClaimRef(gh, branch, sha, log)) return { claimed: false, tookOverStaleClaim: false };
  return { claimed: true, tookOverStaleClaim: true };
}

export function releaseFailedClaim(gh: GhExec, branch: string, log: (line: string) => void): void {
  try {
    if (hasPullRequest(gh, branch)) {
      log(`\`${branch}\` already carries a pull request; leaving its claim in place.`);
      return;
    }
  } catch (err) {
    log(`could not tell whether \`${branch}\` carries a pull request, so its claim stands: ${reason(err)}`);
    return;
  }
  releaseClaim(gh, branch, log);
}

export async function holdingClaim<T>(
  gh: GhExec,
  git: GitExec,
  branch: string,
  log: (line: string) => void,
  now: Date,
  body: (claim: ClaimOutcome) => Promise<T>,
): Promise<T | { outcome: "already-claimed" }> {
  const claim = claimImplementationBranch(gh, git, branch, log, now);
  if (!claim.claimed) return { outcome: "already-claimed" };
  try {
    return await body(claim);
  } catch (err) {
    releaseFailedClaim(gh, branch, log);
    throw err;
  }
}
