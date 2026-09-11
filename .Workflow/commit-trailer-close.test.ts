import { expect, test } from "vitest";
import { closeGateThreatModel, guardCommitTrailerClose } from "./commit-trailer-close";

const CLOSING_KEYWORDS = ["Closes", "Fixes", "Resolves"];

test.fails(
  "#402.1: a closing keyword in a commit message cannot silently close a ticket that never got a ## Closing record",
  () => {
    for (const keyword of CLOSING_KEYWORDS) {
      const verdict = guardCommitTrailerClose(
        `fix: land the thing\n\n${keyword} #176`,
        [],
      );

      expect(verdict.outcome).not.toBe("allow");
      expect(verdict.issues).toContain(176);

      if (verdict.outcome === "reverse") {
        expect(verdict.reopened).toContain(176);
        expect(
          verdict.comments.some(
            (comment) => comment.issue === 176 && comment.body.trim().length > 0,
          ),
        ).toBe(true);
      }
    }
  },
);

test.fails(
  "#402.2: the refusal names the recovery: re-run bin/close-ticket <issue> <base>..<head> <checkout>",
  () => {
    const verdict = guardCommitTrailerClose(
      "fix: land the thing\n\nResolves #176",
      [],
    );

    expect(verdict.outcome).not.toBe("allow");

    const refusal = [verdict.reason, ...verdict.comments.map((comment) => comment.body)].join("\n");
    expect(refusal).toContain("bin/close-ticket");
  },
);

test.fails(
  "#402.4: an ADR records that the commit-trailer path exists and how it is closed",
  () => {
    const model = closeGateThreatModel();

    expect(model.adr).toMatch(/docs\/adr\/\d{4}-[^/]*\.md$/);

    const trailerVector = model.vectors.find((vector) =>
      /trailer|closes|fixes|resolves/i.test(vector.vector),
    );

    expect(trailerVector).toBeDefined();
    expect(trailerVector?.mitigation.trim().length).toBeGreaterThan(0);
  },
);
