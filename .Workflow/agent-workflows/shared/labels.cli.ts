import { pathToFileURL } from "node:url";
import { execGh, type GhExec } from "./gh.ts";
import { catalogueDrift, syncLabels } from "./label-sync.ts";
import { escalateToOwner } from "./needs-human.ts";
import { errorMessage } from "./reason.ts";

export const FINISHED_CLEAN = "success";

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at === -1 ? undefined : args[at + 1];
}

export function failVerb(gh: GhExec, issue: number, status: string): string {
  if (status === FINISHED_CLEAN) return `#${issue}: the job ended green; the lane label stays for the next lane`;
  escalateToOwner(gh, issue, undefined);
  return `#${issue}: the job ended ${status || "without a status"}; swapped its lane label for needs-human`;
}

export function syncVerb(gh: GhExec, repository: string, check: boolean): { text: string; ok: boolean } {
  if (check) {
    const drift = catalogueDrift(gh, repository);
    if (drift.length === 0) return { text: `${repository}: every catalogue label is current`, ok: true };
    const lines = drift.map((change) => `  ${change.exists ? "wrong" : "missing"}: ${change.label.name}`);
    return { text: [`${repository}: ${drift.length} catalogue label(s) drift`, ...lines].join("\n"), ok: false };
  }
  const written = syncLabels(gh, repository);
  return {
    text: written.length === 0 ? `${repository}: every catalogue label was current` : `${repository}: wrote ${written.join(", ")}`,
    ok: true,
  };
}

function main(): void {
  const [verb, ...args] = process.argv.slice(2);
  try {
    if (verb === "fail") {
      const issue = Number(args.find((arg) => /^\d+$/.test(arg)));
      if (!Number.isSafeInteger(issue) || issue <= 0) {
        console.log("labels fail: no issue number, nothing to hand over");
        return;
      }
      console.log(failVerb(execGh, issue, flagValue(args, "--status") ?? process.env.JOB_STATUS ?? ""));
      return;
    }
    if (verb === "sync") {
      const repository = flagValue(args, "-R") ?? process.env.GH_REPO;
      if (!repository) throw new Error("sync needs -R owner/repo or GH_REPO");
      const outcome = syncVerb(execGh, repository, args.includes("--check"));
      console.log(outcome.text);
      if (!outcome.ok) process.exitCode = 1;
      return;
    }
    throw new Error(`unknown verb ${JSON.stringify(verb ?? "")}; use fail <issue> --status <job.status> or sync [--check] [-R owner/repo]`);
  } catch (error) {
    console.error(`labels: ${errorMessage(error)}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
