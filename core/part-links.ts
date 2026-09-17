import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parts, type Part } from "./parts.ts";

export const FAILURE_LINK = /^https:\/\/github\.com\/(collod873\/[\w.-]+)\/(issues|pull|actions\/runs)\/(\d+)$/;
const COMMIT_LINK = /^https:\/\/github\.com\/collod873\/[\w.-]+\/commit\/[0-9a-f]{7,40}$/;
const ENDPOINT: Record<string, string> = { issues: "issues", pull: "pulls", "actions/runs": "actions/runs" };

const run = promisify(execFile);

async function problemWith(gh: string, link: string): Promise<string | undefined> {
  const [, repo, kind, number] = FAILURE_LINK.exec(link) ?? [];
  try {
    const { stdout } = await run(gh, ["api", `repos/${repo}/${ENDPOINT[kind]}/${number}`]);
    if (kind !== "actions/runs") return undefined;
    const { status, conclusion } = JSON.parse(stdout) as { status: string; conclusion: string | null };
    return conclusion === "failure" ? undefined : `a run that did not fail (${conclusion ?? status})`;
  } catch (error) {
    const said = String((error as { stderr?: string }).stderr ?? error).trim().split("\n")[0];
    return /HTTP 404/.test(said) ? "which does not exist" : `which gh could not read: ${said}`;
  }
}

export async function refusedLinks(registry: Part[], gh = "gh"): Promise<string[]> {
  const links = [...new Set(registry.map((part) => part.stops).filter((link) => FAILURE_LINK.test(link)))];
  const problems = new Map(await Promise.all(links.map(async (link) => [link, await problemWith(gh, link)] as const)));
  return registry.flatMap((part) => {
    if (COMMIT_LINK.test(part.stops)) return [`${part.name} links a commit, which records a change and never a failure: ${part.stops}`];
    if (!FAILURE_LINK.test(part.stops)) return [`${part.name} links no issue, PR or run: ${part.stops}`];
    const problem = problems.get(part.stops);
    return problem === undefined ? [] : [`${part.name} links ${part.stops}, ${problem}`];
  });
}

if (import.meta.main) {
  const refused = await refusedLinks(parts);
  for (const refusal of refused) console.log(refusal);
  process.exit(refused.length > 0 ? 1 : 0);
}
