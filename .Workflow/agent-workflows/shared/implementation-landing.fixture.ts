import type { ImplementerAnswer, ImplementerReply } from "./implementation-landing";

/**
 * @fixture Builds an `ImplementerReply`/`ImplementerAnswer` for the suites; a lane's own come from an
 * implementer run.
 */

export function implementerReply(over: Partial<ImplementerReply> = {}): ImplementerReply {
  return { summary: "Built the thing.", outOfBriefReads: [], declaredEdits: [], ...over };
}

export function implementerAnswer(over: Partial<ImplementerAnswer> = {}): ImplementerAnswer {
  return { ...implementerReply(), files: [], deleted: [], ...over };
}
