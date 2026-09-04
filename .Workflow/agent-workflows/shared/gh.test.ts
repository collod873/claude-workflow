import { describe, expect, it } from "vitest";
import { issueComments, ticketComments, type GhExec } from "./gh";

function ghReturning(comments: unknown[]): GhExec {
  return () => JSON.stringify({ comments });
}

describe("ticketComments", () => {
  it("reads each comment's author, createdAt and body", () => {
    const gh = ghReturning([
      { author: { login: "collod873" }, createdAt: "2026-08-01T00:00:00Z", body: "Ship it with the retry." },
    ]);

    expect(ticketComments(gh, 167)).toEqual([
      { author: "collod873", createdAt: "2026-08-01T00:00:00Z", body: "Ship it with the retry." },
    ]);
  });

  it("falls back to 'unknown' for a comment with no author", () => {
    const gh = ghReturning([{ createdAt: "2026-08-01T00:00:00Z", body: "No login on this one." }]);

    expect(ticketComments(gh, 167)).toEqual([
      { author: "unknown", createdAt: "2026-08-01T00:00:00Z", body: "No login on this one." },
    ]);
  });

  it("returns nothing for a ticket with no comments", () => {
    const gh: GhExec = () => JSON.stringify({});

    expect(ticketComments(gh, 167)).toEqual([]);
  });
});

describe("issueComments", () => {
  it("maps ticketComments down to bodies only, off the same gh call", () => {
    const gh = ghReturning([
      { author: { login: "a" }, createdAt: "t1", body: "First." },
      { author: { login: "b" }, createdAt: "t2", body: "Second." },
    ]);

    expect(issueComments(gh, 167)).toEqual(["First.", "Second."]);
  });
});
