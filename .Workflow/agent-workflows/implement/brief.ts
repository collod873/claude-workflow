import { readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { walkSuiteRoots } from "../shared/affected-tests";
import type { TicketComment } from "../shared/gh";
import { PATH_LINE_RE } from "../shared/ticket-shape";

export interface FileSnapshot {
  path: string;
  content?: string;
  omitted?: "over-budget";
}

export interface FailingTestFile {
  path: string;
  content: string;
}

export interface BriefInputs {
  ticketBody: string;
  seamManifestLines: string[];
  moduleContext: string;
  standards: string;
  comments: TicketComment[];
  failingTests: FailingTestFile[];
  claimed: FileSnapshot[];
  cited: FileSnapshot[];
  nearby: string[];
}

export const INLINE_BUDGET_BYTES = 150_000;
export const INLINE_FILE_CAP_BYTES = 40_000;
export const COMMENTS_BUDGET_BYTES = 30_000;

function renderSnapshots(entries: FileSnapshot[]): string {
  if (entries.length === 0) return "(none)";
  return entries.map((entry) => `### ${entry.path}\n\n${entry.content ?? "(does not exist yet)"}`).join("\n\n");
}

function renderNearby(nearby: string[], claimed: FileSnapshot[], cited: FileSnapshot[]): string {
  const overBudget = [...claimed, ...cited]
    .filter((entry) => entry.omitted === "over-budget")
    .map((entry) => `- ${entry.path} (not inlined: over budget)`);
  const lines = [...nearby.map((path) => `- ${path}`), ...overBudget];
  return lines.length > 0 ? lines.join("\n") : "(none)";
}

function renderComment(comment: TicketComment): string {
  return `### ${comment.author} · ${comment.createdAt}\n\n${comment.body}`;
}

function renderComments(comments: TicketComment[]): string {
  if (comments.length === 0) return "(none)";

  let remaining = comments;
  let rendered = remaining.map(renderComment).join("\n\n");
  let dropped = 0;
  while (Buffer.byteLength(rendered, "utf8") > COMMENTS_BUDGET_BYTES && remaining.length > 1) {
    remaining = remaining.slice(1);
    dropped += 1;
    rendered = remaining.map(renderComment).join("\n\n");
  }

  return dropped === 0
    ? rendered
    : `${dropped} older comment${dropped === 1 ? "" : "s"} dropped to fit the brief.\n\n${rendered}`;
}

export function assembleBrief(inputs: BriefInputs): string {
  const seams = inputs.seamManifestLines.length > 0 ? inputs.seamManifestLines.join("\n") : "(none)";
  const tests =
    inputs.failingTests.length > 0
      ? inputs.failingTests.map((file) => `### ${file.path}\n\n${file.content}`).join("\n\n")
      : "(none)";

  return [
    "## Ticket",
    inputs.ticketBody,
    "## Ticket comments, oldest first",
    renderComments(inputs.comments),
    "## Seam manifest lines consumed",
    seams,
    "## Module CONTEXT.md",
    inputs.moduleContext,
    "## Coding standards",
    inputs.standards,
    "## Acceptance test(s) to turn on",
    tests,
    "## Files claimed, as they stand",
    renderSnapshots(inputs.claimed),
    "## Cited by the ticket",
    renderSnapshots(inputs.cited),
    "## Nearby, by path",
    renderNearby(inputs.nearby, inputs.claimed, inputs.cited),
  ].join("\n\n");
}

export interface BriefContextDeps {
  ticketBody: string;
  filesClaimed: string[];
  readFile: (path: string) => string;
  fileExists: (path: string) => boolean;
  sourceFiles: () => string[];
  adrFiles: () => string[];
  failingTestPaths: string[];
}

const ADR_MENTION_RE = /\bADR-(\d{4})\b/g;

const BACKTICK_PATH_RE = /`([^`\s]*\/[^`\s]*)`/g;

function citedAdrPaths(ticketBody: string, adrFiles: string[]): string[] {
  const codes: string[] = [];
  const seenCodes = new Set<string>();
  for (const match of ticketBody.matchAll(ADR_MENTION_RE)) {
    if (seenCodes.has(match[1])) continue;
    seenCodes.add(match[1]);
    codes.push(match[1]);
  }

  const paths: string[] = [];
  for (const code of codes) {
    const found = adrFiles.find((path) => basename(path).startsWith(`${code}-`));
    if (found) paths.push(found);
  }
  return paths;
}

interface CitedTextToken {
  index: number;
  path: string;
}

function citedTextPaths(ticketBody: string, fileExists: (path: string) => boolean): string[] {
  const tokens: CitedTextToken[] = [];
  for (const match of ticketBody.matchAll(new RegExp(PATH_LINE_RE, "g"))) {
    tokens.push({ index: match.index ?? 0, path: match[0].replace(/:\d+$/, "") });
  }
  for (const match of ticketBody.matchAll(BACKTICK_PATH_RE)) {
    tokens.push({ index: match.index ?? 0, path: match[1] });
  }
  tokens.sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  const paths: string[] = [];
  for (const token of tokens) {
    if (seen.has(token.path)) continue;
    seen.add(token.path);
    if (fileExists(token.path)) paths.push(token.path);
  }
  return paths;
}

function snapshotWithBudget(path: string, readFile: (path: string) => string, budget: { remaining: number }): FileSnapshot {
  const content = readFile(path);
  const size = Buffer.byteLength(content, "utf8");
  if (size > INLINE_FILE_CAP_BYTES || size > budget.remaining) {
    return { path, omitted: "over-budget" };
  }
  budget.remaining -= size;
  return { path, content };
}

function claimedBasename(path: string): string {
  return basename(path).split(".")[0];
}

export function gatherBriefContext(deps: BriefContextDeps): Pick<BriefInputs, "claimed" | "cited" | "nearby"> {
  const budget = { remaining: INLINE_BUDGET_BYTES };

  const claimed: FileSnapshot[] = deps.filesClaimed.map((path) => {
    if (!deps.fileExists(path)) return { path };
    return snapshotWithBudget(path, deps.readFile, budget);
  });

  const claimedPathSet = new Set(deps.filesClaimed);
  const adrPaths = citedAdrPaths(deps.ticketBody, deps.adrFiles()).filter((path) => !claimedPathSet.has(path));
  const textPaths = citedTextPaths(deps.ticketBody, deps.fileExists).filter(
    (path) => !claimedPathSet.has(path) && !adrPaths.includes(path),
  );
  const cited: FileSnapshot[] = [...adrPaths, ...textPaths].map((path) => snapshotWithBudget(path, deps.readFile, budget));

  const citedPathSet = new Set([...adrPaths, ...textPaths]);
  const failingTestPathSet = new Set(deps.failingTestPaths);
  const claimedBasenames = deps.filesClaimed.map(claimedBasename).filter((name) => name.length > 0);

  const candidates = deps
    .sourceFiles()
    .filter((path) => !claimedPathSet.has(path) && !citedPathSet.has(path) && !failingTestPathSet.has(path));

  const matches = candidates.filter((path) => {
    const content = deps.readFile(path);
    return claimedBasenames.some((name) => content.includes(name));
  });

  const testPaths = matches.filter((path) => path.includes(".test.")).sort();
  const otherPaths = matches.filter((path) => !path.includes(".test.")).sort();
  const nearby = [...testPaths, ...otherPaths].slice(0, 40);

  return { claimed, cited, nearby };
}

const SOURCE_EXTENSION_RE = /\.(?:ts|mts|mjs|js)$/;

export function walkSourceFiles(root: string): string[] {
  return walkSuiteRoots(root, (name) => SOURCE_EXTENSION_RE.test(name)).map((full) =>
    relative(root, full).split(sep).join("/"),
  );
}

export function listAdrFiles(root: string): string[] {
  const dir = join(root, "docs", "adr");
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries
    .filter((name) => name.endsWith(".md"))
    .map((name) => `docs/adr/${name}`)
    .sort();
}
