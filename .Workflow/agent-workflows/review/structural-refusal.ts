import { PATH_LINE_RE } from "../shared/ticket-shape";

export interface Finding {
  message: string;
}

const PATH_LINE_RE_G = new RegExp(PATH_LINE_RE.source, "g");

function citesLocationInDiff(finding: Finding, diff: string): boolean {
  const citations = finding.message.match(PATH_LINE_RE_G) ?? [];
  return citations.some((citation) => diff.includes(citation));
}

export function isStructurallyRefused(finding: Finding, diff: string): boolean {
  return !citesLocationInDiff(finding, diff);
}
