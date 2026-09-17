import { basename } from "node:path";
import { frontmatterBlock } from "./adr-frontmatter";

export interface TextFile {
  path: string;
  content: string;
}

export interface DriftFinding {
  path: string;
  line?: number;
  says: string;
}

interface Adr {
  number: number;
  path: string;
  status: string;
  supersedes: number[];
  supersededBy: number[];
}

const ADR_PATH_RE = /^docs\/adr\/(\d{4})-[^/]+\.md$/;
const ADR_CITATION_RE = /(?<![\w/])ADR-(\d{4})\b|(?<![\w-])adr\/(\d{4})-/g;
const NEVER_LIVE_RE = /^docs\/(adr|research)\/|package-lock\.json$|\.evidence\.json$|\.fixtures\/[^/]+\.json$|-payloads\.ts$|\.test\.ts$|\.fixture\.ts$|(^|\/)test_[^/]*\.py$|(^|\/)conftest\.py$/;
const AGENT_WORKFLOWS_PREFIX = ".Workflow/agent-workflows/";
const REVERSAL_PREFIX = "reversal:";

const adrName = (number: number) => `ADR-${String(number).padStart(4, "0")}`;

function frontmatterValue(content: string, key: string): string | undefined {
  const line = frontmatterBlock(content)
    ?.split("\n")
    .find((each) => each.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim();
}

function numbersIn(value: string | undefined): number[] {
  return [...(value ?? "").matchAll(/ADR-(\d{4})/g)].map((match) => Number(match[1]));
}

function adrsOf(files: TextFile[]): Map<number, Adr> {
  const adrs = new Map<number, Adr>();
  for (const file of files) {
    const named = ADR_PATH_RE.exec(file.path);
    if (!named) continue;
    adrs.set(Number(named[1]), {
      number: Number(named[1]),
      path: file.path,
      status: frontmatterValue(file.content, "status") ?? "",
      supersedes: numbersIn(frontmatterValue(file.content, "supersedes")),
      supersededBy: numbersIn(frontmatterValue(file.content, "superseded_by")),
    });
  }
  return adrs;
}

function successorsOf(adrs: Map<number, Adr>): Map<number, number[]> {
  const successors = new Map<number, number[]>();
  for (const adr of adrs.values()) {
    for (const predecessor of adr.supersedes) {
      if (predecessor === adr.number) continue;
      successors.set(predecessor, [...(successors.get(predecessor) ?? []), adr.number]);
    }
  }
  return successors;
}

function liveHeads(number: number, successors: Map<number, number[]>, seen = new Set<number>()): number[] {
  const next = (successors.get(number) ?? []).filter((each) => !seen.has(each));
  if (next.length === 0) return [number];
  seen.add(number);
  return [...new Set(next.flatMap((each) => liveHeads(each, successors, seen)))].sort((a, b) => a - b);
}

function isRetired(adr: Adr, successors: Map<number, number[]>): boolean {
  return adr.status === "superseded" || successors.has(adr.number);
}

export function isLiveProse(path: string): boolean {
  return !NEVER_LIVE_RE.test(path);
}

export function retiredCitations(files: TextFile[]): DriftFinding[] {
  const adrs = adrsOf(files);
  const successors = successorsOf(adrs);
  const findings: DriftFinding[] = [];

  for (const file of files.filter((each) => isLiveProse(each.path))) {
    file.content.split("\n").forEach((text, index) => {
      const cited = new Set([...text.matchAll(ADR_CITATION_RE)].map((match) => Number(match[1] ?? match[2])));
      for (const number of cited) {
        const adr = adrs.get(number);
        if (!adr || !isRetired(adr, successors)) continue;
        const heads = liveHeads(number, successors).filter((head) => head !== number);
        const live = heads.length > 0 ? `the ruling now lives in ${heads.map(adrName).join(", ")}` : "no successor declares it";
        findings.push({ path: file.path, line: index + 1, says: `cites ${adrName(number)}, which is retired; ${live}` });
      }
    });
  }
  return findings;
}

export function staleStamps(files: TextFile[]): DriftFinding[] {
  const adrs = adrsOf(files);
  const findings: DriftFinding[] = [];
  for (const adr of adrs.values()) {
    for (const successor of adr.supersededBy) {
      if (adrs.get(successor)?.supersedes.includes(adr.number)) continue;
      findings.push({ path: adr.path, says: `superseded_by names ${adrName(successor)}, which declares no supersedes: ${adrName(adr.number)}` });
    }
    if (adr.status === "superseded" && adr.supersededBy.length === 0) {
      findings.push({ path: adr.path, says: "status is superseded, but no successor declares supersedes: for it" });
    }
  }
  return findings;
}

function spellings(gone: string, uniqueBasenames: Set<string>): string[] {
  const forms = [gone];
  if (gone.startsWith(AGENT_WORKFLOWS_PREFIX)) forms.push(gone.slice(AGENT_WORKFLOWS_PREFIX.length));
  const name = basename(gone);
  if (name.includes(".") && uniqueBasenames.has(name)) forms.push(name);
  return forms;
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function deletedPathMentions(files: TextFile[], gonePaths: string[]): DriftFinding[] {
  if (gonePaths.length === 0) return [];

  const counts = new Map<string, number>();
  for (const path of [...files.map((file) => file.path), ...gonePaths]) {
    counts.set(basename(path), (counts.get(basename(path)) ?? 0) + 1);
  }
  const uniqueBasenames = new Set([...counts].filter(([, count]) => count === 1).map(([name]) => name));

  const retired = new Set([...adrsOf(files).values()].filter((adr) => adr.status !== "constraint").map((adr) => adr.path));
  const readers = files.filter((file) => (isLiveProse(file.path) || ADR_PATH_RE.test(file.path)) && !retired.has(file.path));

  const patterns = gonePaths.map((gone) => ({
    gone,
    re: new RegExp(spellings(gone, uniqueBasenames).map((form) => `(?<![\\w-]|[\\w-]/)${escaped(form)}(?![\\w-]|\\.\\w)`).join("|")),
  }));

  const findings: DriftFinding[] = [];
  for (const file of readers) {
    const adr = ADR_PATH_RE.test(file.path);
    file.content.split("\n").forEach((text, index) => {
      if (adr && !text.startsWith(REVERSAL_PREFIX)) return;
      for (const { gone, re } of patterns) {
        if (re.test(text)) findings.push({ path: file.path, line: index + 1, says: `names ${gone}, which this change deleted` });
      }
    });
  }
  return findings;
}

export function renderDrift(findings: DriftFinding[]): string {
  const lines = findings.map((finding) => `  ${finding.path}${finding.line ? `:${finding.line}` : ""}  ${finding.says}`);
  return [
    `prose drift: ${findings.length} line${findings.length === 1 ? "" : "s"} name something that no longer holds.`,
    "Rewrite or delete each sentence against what is live now; repointing a restated rule to a new number leaves it just as wrong.",
    ...lines,
  ].join("\n");
}
