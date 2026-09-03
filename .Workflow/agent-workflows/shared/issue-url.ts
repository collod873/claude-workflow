const ISSUE_URL_RE = /\/issues\/(\d+)\s*$/;

export function parseIssueNumber(createOutput: string, context?: string): number {
  const match = createOutput.trim().match(ISSUE_URL_RE);
  if (!match) {
    const subject = context === undefined ? "" : ` for ${JSON.stringify(context)}`;
    throw new Error(
      `could not parse an issue number from "gh issue create" output${subject}: ${JSON.stringify(createOutput)}`,
    );
  }
  return Number(match[1]);
}
