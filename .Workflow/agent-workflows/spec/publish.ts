import { z } from "zod";
import type { GhExec } from "../shared/gh";
import { PRD_LABEL } from "../shared/labels";
import type { Tracker } from "../shared/tracker";
import { trackerGh } from "../shared/tracker-gh";
import type { SpecAuthorOutput } from "./author-contract";
import { validateSpecBody, type SpecBodyValidator } from "./validate-spec";

const NO_ASSIGNEE = "";

function toTracker(gh: GhExec | Tracker): Tracker {
  return typeof gh === "function" ? trackerGh(gh) : gh;
}

export { PRD_LABEL };

export const SpecSource = z.object({
  kind: z.enum(["sheet", "map", "widened"]),
  issue: z.number(),
});

export type SpecSource = z.infer<typeof SpecSource>;

const SOURCE_MARKER = "<!-- spec-source:v1";
const SOURCE_OPEN = `${SOURCE_MARKER} `;
const SOURCE_CLOSE = " -->";

export function sourceMarker(source: SpecSource): string {
  return `${SOURCE_OPEN}${JSON.stringify(source).replaceAll(">", "\\u003e")}${SOURCE_CLOSE}`;
}

export function readSourceMarker(body: string): SpecSource | undefined {
  const at = locateSourceMarker(body);
  if (at === undefined) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.slice(at.open + SOURCE_OPEN.length, at.close));
  } catch {
    return undefined;
  }

  const result = SpecSource.safeParse(parsed);
  return result.success ? result.data : undefined;
}

function locateSourceMarker(body: string): { open: number; close: number } | undefined {
  const open = body.lastIndexOf(SOURCE_OPEN);
  if (open === -1) return undefined;

  const close = body.indexOf(SOURCE_CLOSE, open + SOURCE_OPEN.length);
  return close === -1 ? undefined : { open, close };
}

export function withoutSourceMarker(body: string): string {
  if (readSourceMarker(body) === undefined) return body;

  const at = locateSourceMarker(body);
  if (at === undefined) return body;

  return `${body.slice(0, at.open)}${body.slice(at.close + SOURCE_CLOSE.length)}`.trim();
}

export function specTitle(title: string): string {
  const trimmed = title.trim();
  return /^PRD:/i.test(trimmed) ? trimmed : `PRD: ${trimmed}`;
}

export function specBody(body: string, source: SpecSource | undefined): string {
  return source === undefined ? body : `${sourceMarker(source)}\n\n${body}`;
}

export function publishSpec(
  gh: GhExec | Tracker,
  draft: SpecAuthorOutput,
  source: SpecSource | undefined,
  validate: SpecBodyValidator = validateSpecBody,
): number {
  const title = specTitle(draft.title);
  const body = specBody(draft.body, source);
  warnAbout(validate(body));
  return toTracker(gh).createIssue({ title, body, label: PRD_LABEL, assignee: NO_ASSIGNEE });
}

function warnAbout(warnings: string[]): void {
  for (const warning of warnings) console.error(`spec body warning: ${warning}`);
}

interface IssueBodyWriter {
  setIssueBody(number: number, title: string, body: string): void;
}

export function updateSpec(
  gh: GhExec | IssueBodyWriter,
  issueNumber: number,
  draft: PublishedSpec,
  source: SpecSource | undefined,
): void {
  const title = specTitle(draft.title);
  const body = specBody(draft.body, source);
  if (typeof gh === "function") {
    gh(["issue", "edit", String(issueNumber), "--title", title, "--body", body]);
    return;
  }
  gh.setIssueBody(issueNumber, title, body);
}

export interface PublishedSpec {
  title: string;
  body: string;
}

export function readPublishedSpec(gh: GhExec | Tracker, issueNumber: number): PublishedSpec {
  return toTracker(gh).issueTitleAndBody(issueNumber);
}
