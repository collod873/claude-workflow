import { pathToFileURL } from "node:url";
import { commaList } from "../shared/event-door";
import { execGh, type GhExec } from "../shared/gh";
import { touchesImmutableSet } from "../shared/immutable-set";
import { reason } from "../shared/reason";
import { judgesPullRequest } from "./doors";

export type ImmutabilityVerdict =
  | { verdict: "undeclared" }
  | { verdict: "refused"; paths: string[] }
  | { verdict: "clean" };

export function judgeChangedFiles(changedFiles: readonly string[]): ImmutabilityVerdict {
  if (changedFiles.length === 0) return { verdict: "undeclared" };
  const paths = changedFiles.filter((path) => touchesImmutableSet([path]));
  return paths.length > 0 ? { verdict: "refused", paths } : { verdict: "clean" };
}

export function namesPullRequest(gh: GhExec, pr: string): string {
  const branch = gh(["pr", "view", pr, "--json", "headRefName", "--jq", ".headRefName"]).trim();
  return `judging ${pr} on ${branch}`;
}

function main(): void {
  const eventAction = process.env.EVENT_ACTION || "";
  if (!judgesPullRequest(eventAction)) {
    console.log(`a \`${eventAction}\` event opens no pull request, so there is no claim to judge.`);
    return;
  }

  console.log(namesPullRequest(execGh, process.env.PR || ""));

  const judgement = judgeChangedFiles(commaList(process.env.CHANGED_FILES || ""));
  if (judgement.verdict === "undeclared") {
    console.error("::error::changed-files input is missing or empty; refusing");
    process.exitCode = 1;
    return;
  }
  if (judgement.verdict === "refused") {
    for (const path of judgement.paths) console.error(`::error::${path} touches the immutable set`);
    process.exitCode = 1;
    return;
  }
  console.log("no changed file touches the immutable set");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`::error::could not judge the claim: ${reason(err)}`);
    process.exitCode = 1;
  }
}
