import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { execGh, type GhExec } from "../shared/gh";
import { reason } from "../shared/reason";
import {
  FINDING_MARKER,
  findMissingTrailers,
  signalBody,
  signalTitle,
  type AdrDoc,
  type ResearchNote,
  type TrailerFinding,
} from "./missing-trailer";

/**
 * The missing-trailer counter's entrypoint (#124, ADR-0067,
 * `.github/workflows/missing-trailer-counter.yml`): reads `docs/adr/` and
 * `docs/research/` off the working tree, runs the judgement half
 * (`./missing-trailer.ts`) over them, and files — or comments on an
 * existing standing — issue naming every current candidate.
 *
 * **Rides a push that touches either directory**, not a dispatch: unlike
 * the run watchdog (ADR-0049), there is no name-matching problem here to
 * dodge, and GitHub's own `paths:` filter on `push` says exactly "a commit
 * touching either directory" without a second mechanism to keep in sync.
 *
 * **Recomputes, stores nothing.** Every run reads the corpus fresh and
 * derives the finding set from scratch — the same property `dead-lanes.ts`
 * and `run-watchdog.ts` share, and for the same reason: nothing here can go
 * stale because nothing here is remembered.
 *
 * **One standing issue, not one per finding** (ADR-0067's `Count: 1`): a
 * missing trailer is a defect in the record, not a trend, so every current
 * candidate is named in one issue rather than one issue each. A second run
 * that still finds candidates comments on the standing issue with the
 * current list; a run with no open standing issue opens one.
 */

const ADR_FILENAME_RE = /^(\d{4})-.*\.md$/;

/** The ruling, as its title reads — the first line of the file, minus the leading `# `. */
function titleOf(body: string): string {
  return (body.split("\n")[0] ?? "").replace(/^#\s*/, "").trim();
}

/** Every numbered ADR under `adrDir` — `docs/adr/README.md` and the bare template excluded by the filename shape itself. */
export function readAdrCorpus(adrDir: string): AdrDoc[] {
  return readdirSync(adrDir)
    .filter((name) => ADR_FILENAME_RE.test(name))
    .map((filename) => {
      const match = filename.match(ADR_FILENAME_RE)!;
      const body = readFileSync(join(adrDir, filename), "utf8");
      return { number: Number(match[1]), filename, title: titleOf(body), body };
    });
}

/**
 * Every research note under `researchDir` — `assets/` and any other non-Markdown entry excluded by
 * the `.md` filter, and `draft-` excluded because a draft is not yet part of the record
 * (ADR-0080). An ADR gets that exclusion for free above: a draft carries no number, and
 * `ADR_FILENAME_RE` wants four digits.
 */
export function readResearchCorpus(researchDir: string): ResearchNote[] {
  return readdirSync(researchDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .filter((entry) => !entry.name.startsWith("draft-"))
    .map((entry) => {
      const body = readFileSync(join(researchDir, entry.name), "utf8");
      return { filename: entry.name, title: titleOf(body), body };
    });
}

const IssueSummary = z.object({
  number: z.number(),
  body: z.string().nullable(),
  state: z.string(),
});

/** The open issue carrying `FINDING_MARKER`, if one is already standing. */
function readStandingIssue(gh: GhExec): z.infer<typeof IssueSummary> | undefined {
  const raw = gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,body,state"]);
  const issues = IssueSummary.array().parse(JSON.parse(raw));
  return issues.find((issue) => (issue.body ?? "").includes(FINDING_MARKER));
}

export interface CounterOptions {
  gh: GhExec;
  adrDir: string;
  researchDir: string;
  /** Who a newly opened issue is assigned to, so it notifies rather than sits in a list. Unassigned when omitted. */
  assignee?: string;
  log?: (line: string) => void;
}

export type CounterAction = "clean" | "opened" | "commented";

export interface CounterOutcome {
  action: CounterAction;
  findings: TrailerFinding[];
  issue?: number;
}

export function countMissingTrailers(options: CounterOptions): CounterOutcome {
  const { gh, adrDir, researchDir, assignee } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  const adrs = readAdrCorpus(adrDir);
  const notes = readResearchCorpus(researchDir);
  const findings = findMissingTrailers(adrs, notes);

  if (findings.length === 0) {
    log("clean: every supersession is trailered and every research note is pointered");
    return { action: "clean", findings: [] };
  }

  const standing = readStandingIssue(gh);
  if (standing) {
    gh(["issue", "comment", String(standing.number), "--body", signalBody(findings)]);
    log(`commented on #${standing.number}: ${findings.length} finding(s)`);
    return { action: "commented", findings, issue: standing.number };
  }

  const createArgs = ["issue", "create", "--title", signalTitle(findings), "--body", signalBody(findings)];
  if (assignee) createArgs.push("--assignee", assignee);
  const url = gh(createArgs).trim();
  const opened = Number(url.split("/").pop());
  log(`opened #${opened}: ${findings.length} finding(s)`);
  return { action: "opened", findings, issue: opened };
}

async function main(): Promise<void> {
  try {
    const repoRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const outcome = countMissingTrailers({
      gh: execGh,
      adrDir: join(repoRoot, "docs/adr"),
      researchDir: join(repoRoot, "docs/research"),
      assignee: process.env.SIGNAL_ASSIGNEE,
    });
    console.log(`${outcome.action}: ${outcome.findings.length} finding(s)`);
  } catch (err) {
    console.error(`missing-trailer-counter failed: ${reason(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
