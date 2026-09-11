export type TrailerCloseOutcome = "allow" | "refuse" | "reverse";

export type TrailerCloseComment = {
  issue: number;
  body: string;
};

export type TrailerCloseVerdict = {
  outcome: TrailerCloseOutcome;
  issues: number[];
  reason: string;
  reopened: number[];
  comments: TrailerCloseComment[];
};

export function guardCommitTrailerClose(
  commitMessage: string,
  issuesWithClosingRecord: number[],
): TrailerCloseVerdict {
  throw new Error("#402: not built");
}

export type CloseGateThreatVector = {
  vector: string;
  mitigation: string;
};

export type CloseGateThreatModel = {
  adr: string;
  vectors: CloseGateThreatVector[];
};

export function closeGateThreatModel(): CloseGateThreatModel {
  throw new Error("#402: not built");
}
