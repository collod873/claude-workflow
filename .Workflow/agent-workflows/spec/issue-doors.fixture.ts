import type { GhExec } from "../shared/gh";
import { acceptedMarker, sheetMarker, type AcceptedPayload } from "../shared/marker";
import type { Sheet } from "../shared/sheet-schema";
import { sheet } from "../shared/sheet.fixture";
import { createIssueGh, type FakeIssueGh } from "./gh.fake";
import { sourceMarker, type SpecSource } from "./publish";

/**
 * @fixture Reached only from the suites, by design. `spec.test.ts` and `publish.test.ts` each
 * carried a hand-rolled `gh` per door, and a fake defined twice drifts (#360).
 */

const ACCEPTED: AcceptedPayload = { adrPaths: [], coinedTerms: [], route: "short" };

export function acceptedSheetComments(decisions: Sheet["decisions"] = []): string[] {
  return [sheetMarker(sheet({ decisions })), acceptedMarker(ACCEPTED)];
}

export function acceptedSheetGh(ownerWords: string, decisions: Sheet["decisions"]): FakeIssueGh {
  const bodies = acceptedSheetComments(decisions);
  return createIssueGh((fields) =>
    fields === "body"
      ? JSON.stringify({ body: ownerWords })
      : fields === "comments"
        ? JSON.stringify({ comments: bodies.map((body) => ({ body })) })
        : undefined,
  );
}

export function sessionSpecGh(spec: { title: string; body: string }, comments: string[] = []): FakeIssueGh {
  return createIssueGh((fields) =>
    fields === "title,body"
      ? JSON.stringify(spec)
      : fields === "comments"
        ? JSON.stringify({ comments: comments.map((body) => ({ body })) })
        : undefined,
  );
}

export function publishingGh(specBody = ""): FakeIssueGh {
  return createIssueGh(() => specBody);
}

export function coldDoorGh(
  options: { comments?: string[]; slicedSpecs?: Array<{ number: number; source: SpecSource }> } = {},
): { gh: GhExec; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push([...args]);
    if (args[0] === "issue" && args[1] === "list") {
      const specs = (options.slicedSpecs ?? []).map((spec) => ({
        number: spec.number,
        body: sourceMarker(spec.source),
        labels: [{ name: "prd" }, { name: "sliceable" }],
      }));
      return JSON.stringify(specs);
    }
    if (args[0] === "issue" && args[1] === "view" && args[args.indexOf("--json") + 1] === "comments") {
      return JSON.stringify({ comments: (options.comments ?? []).map((body) => ({ body })) });
    }
    return "";
  };
  return { gh, calls };
}
