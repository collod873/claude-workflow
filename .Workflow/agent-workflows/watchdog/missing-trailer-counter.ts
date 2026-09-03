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

const ADR_FILENAME_RE = /^(\d{4})-.*\.md$/;

function titleOf(body: string): string {
  return (body.split("\n")[0] ?? "").replace(/^#\s*/, "").trim();
}

export function readAdrCorpus(adrDir: string): AdrDoc[] {
  return readdirSync(adrDir)
    .filter((name) => ADR_FILENAME_RE.test(name))
    .map((filename) => {
      const match = filename.match(ADR_FILENAME_RE)!;
      const body = readFileSync(join(adrDir, filename), "utf8");
      return { number: Number(match[1]), filename, title: titleOf(body), body };
    });
}

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

function readStandingIssue(gh: GhExec): z.infer<typeof IssueSummary> | undefined {
  const raw = gh(["issue", "list", "--state", "open", "--limit", "100", "--json", "number,body,state"]);
  const issues = IssueSummary.array().parse(JSON.parse(raw));
  return issues.find((issue) => (issue.body ?? "").includes(FINDING_MARKER));
}

export interface CounterOptions {
  gh: GhExec;
  adrDir: string;
  researchDir: string;
  assignee?: string;
  log?: (line: string) => void;
}

export type CounterAction = "clean" | "opened" | "commented" | "silent" | "closed";

export interface CounterOutcome {
  action: CounterAction;
  findings: TrailerFinding[];
  issue?: number;
}

function saidOn(gh: GhExec, issue: number): string {
  const raw = gh(["issue", "view", String(issue), "--json", "body,comments"]);
  const parsed = JSON.parse(raw) as { body?: string; comments?: { body?: string }[] };
  return [parsed.body ?? "", ...(parsed.comments ?? []).map((c) => c.body ?? "")].join("\n");
}

export function countMissingTrailers(options: CounterOptions): CounterOutcome {
  const { gh, adrDir, researchDir, assignee } = options;
  const log = options.log ?? ((line: string) => console.log(line));

  const adrs = readAdrCorpus(adrDir);
  const notes = readResearchCorpus(researchDir);
  const findings = findMissingTrailers(adrs, notes);
  const standing = readStandingIssue(gh);

  if (findings.length === 0) {
    if (standing) {
      gh(["issue", "comment", String(standing.number),
          "--body", "Recovered: every supersession carries an `amends:` declaration and every " +
                    "research note carries a pointer. Closing — this counter recomputes the whole " +
                    "corpus each run, so it will reopen if the count returns."]);
      gh(["issue", "close", String(standing.number)]);
      log(`closed #${standing.number}: the count reached zero`);
      return { action: "closed", findings: [], issue: standing.number };
    }
    log("clean: every supersession is trailered and every research note is pointered");
    return { action: "clean", findings: [] };
  }

  if (standing) {
    const said = saidOn(gh, standing.number);
    const fresh = findings.filter((finding) => !said.includes(finding.filename));
    if (fresh.length === 0) {
      log(`silent on #${standing.number}: all ${findings.length} finding(s) already named`);
      return { action: "silent", findings, issue: standing.number };
    }
    gh(["issue", "comment", String(standing.number), "--body", signalBody(fresh)]);
    log(`commented on #${standing.number}: ${fresh.length} new finding(s)`);
    return { action: "commented", findings: fresh, issue: standing.number };
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
    const repoRoot = process.env.TARGET_WORKSPACE ?? process.env.GITHUB_WORKSPACE ?? process.cwd();
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
