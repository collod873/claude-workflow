import { PATH_LINE_RE } from "../shared/ticket-shape";

export interface Finding {
  message: string;
}

export type GreenGateCheck = string;

const PATH_LINE_RE_G = new RegExp(PATH_LINE_RE.source, "g");

function citesLocationInDiff(finding: Finding, diff: string): boolean {
  const citations = finding.message.match(PATH_LINE_RE_G) ?? [];
  return citations.some((citation) => diff.includes(citation));
}

function restatesAGreenCheck(finding: Finding, greenGateChecks: GreenGateCheck[]): boolean {
  return greenGateChecks.some((check) => finding.message.includes(check));
}

export function isStructurallyRefused(
  finding: Finding,
  diff: string,
  greenGateChecks: GreenGateCheck[],
): boolean {
  return !citesLocationInDiff(finding, diff) || restatesAGreenCheck(finding, greenGateChecks);
}
