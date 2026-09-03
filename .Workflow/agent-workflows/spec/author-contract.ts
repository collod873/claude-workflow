import type { MarkedDecision } from "./open-questions";

export const SPEC_AUTHOR_ALLOWED_TOOLS = ["Read", "Grep", "Glob"];

export interface DecidedContext {
  ownerWords: string;
  decisions: string;
  rulings: string;
  boundaries: string;
  openGuesses: string;
}

export interface SpecAuthorOutput {
  title: string;
  body: string;
  openQuestions: string[];
  decisions: MarkedDecision[];
}
