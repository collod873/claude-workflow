import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import type { GhExec } from "../shared/gh";
import { countMissingTrailers, readAdrCorpus, readResearchCorpus } from "./missing-trailer-counter";
import {
  findMissingTrailers,
  FINDING_MARKER,
  hasAmendsTrailer,
  hasResolvesPointer,
  hasSupersessionVerb,
  isMissingAmendsTrailer,
  isMissingResolvesField,
  lowerNumberedAdrLinks,
  signalBody,
  signalTitle,
  type AdrDoc,
  type ResearchNote,
} from "./missing-trailer";

/**
 * This repo's own corpus, captured (`adr-corpus.evidence.json`) rather than
 * synthesised — #124's last acceptance criteria ask for the judgement half
 * run against the corpus that motivated it, not a fixture written to agree
 * with it (the mistake #107 turned on, `dead-lanes.test.ts` upheld the same
 * way).
 */
const EVIDENCE: { adrs: AdrDoc[]; notes: ResearchNote[] } = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "adr-corpus.evidence.json"), "utf8"),
);

function adr(overrides: Partial<AdrDoc> = {}): AdrDoc {
  return { number: 10, filename: "0010-slug.md", title: "A ruling", body: "Recorded 2026-08-26.\n\nSome text.\n", ...overrides };
}

function note(overrides: Partial<ResearchNote> = {}): ResearchNote {
  return { filename: "topic-2026-08.md", title: "A finding", body: "**Resolves:** [x](https://example/1)\n\n## Section\n", ...overrides };
}

describe("the rule, run over the corpus that motivated it", () => {
  it("has a corpus to run over, so a green suite is not an empty sweep", () => {
    // A floor, not a census. What this test is for is in its own name — the sweeps below must not
    // be green for having swept nothing — and a floor says that and stops.
    //
    // An exact count said it too, right up until the accept lane began filing ADRs on a runner. An
    // equality is a number somebody has to bump, and the somebody was the owner, by hand, in the
    // same commit as each ADR; that worked for as long as every ADR had a human in the loop. The
    // first accept to file two of them turned this red *for having worked*, and did it inside the
    // `pre-push` gate, so the lane's push was refused by a count of how big the corpus used to be.
    //
    // Loosening it gives nothing up. Whether the fixture still *matches* the corpus is not this
    // test's job — `bin/gauntlet push` regenerates and compares byte-for-byte, and names the
    // document that moved when it doesn't.
    expect(EVIDENCE.adrs.length).toBeGreaterThan(50);
    expect(EVIDENCE.notes.length).toBeGreaterThan(5);
  });

  it("flags exactly 9 ADRs as carrying an Amends: trailer", () => {
    const trailered = EVIDENCE.adrs.filter((doc) => hasAmendsTrailer(doc.body));
    expect(trailered.map((doc) => doc.filename).sort()).toEqual([
      "0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md",
      "0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md",
      "0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md",
      "0043-write-on-surprise-does-not-ship-the-transcript-auditor-alrea.md",
      "0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md",
      "0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md",
      "0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md",
      "0071-branch-protection-is-declined-so-move-10-retires-and-its-cou.md",
      "0072-a-research-note-with-no-antecedent-issue-declares-that-in-a.md",
    ]);
  });

  it("flags exactly 27 ADRs as verb-and-link candidates with no trailer", () => {
    const candidates = EVIDENCE.adrs.filter(isMissingAmendsTrailer);
    expect(candidates.length).toBe(27);
  });

  it("flags no research notes as missing a Resolves: field — every note on disk now carries a pointer", () => {
    const missing = EVIDENCE.notes.filter(isMissingResolvesField);
    expect(missing.map((n) => n.filename).sort()).toEqual([]);
  });

  it("never flags a trailered ADR as also a candidate", () => {
    for (const doc of EVIDENCE.adrs) {
      if (hasAmendsTrailer(doc.body)) expect(isMissingAmendsTrailer(doc)).toBe(false);
    }
  });

  it("collapses the whole corpus into one issue's worth of findings, not two counters' worth", () => {
    const findings = findMissingTrailers(EVIDENCE.adrs, EVIDENCE.notes);
    expect(findings.filter((f) => f.kind === "adr")).toHaveLength(27);
    expect(findings.filter((f) => f.kind === "research-note")).toHaveLength(0);
  });
});

describe("hasSupersessionVerb", () => {
  it("takes the canonical vocabulary in any of its inflections", () => {
    for (const word of ["retired", "retires", "amends", "amended", "struck", "striking", "restated", "replaces", "replaced"]) {
      expect(hasSupersessionVerb(`This ADR ${word} an earlier one.`)).toBe(true);
    }
  });

  it("leaves extends alone — the word an ADR that merely extends another uses", () => {
    expect(hasSupersessionVerb("This ADR extends an earlier one, and both stand.")).toBe(false);
  });

  it("leaves ordinary prose with no supersession vocabulary alone", () => {
    expect(hasSupersessionVerb("Nothing here changes an earlier ruling.")).toBe(false);
  });
});

describe("lowerNumberedAdrLinks", () => {
  it("takes a real markdown link to a lower-numbered ADR file", () => {
    const body = "See [ADR-0005](0005-a-decision.md) for background.";
    expect(lowerNumberedAdrLinks(body, 10)).toEqual([5]);
  });

  it("leaves a bare ADR-NNNN mention with no link", () => {
    const body = "See ADR-0005 for background.";
    expect(lowerNumberedAdrLinks(body, 10)).toEqual([]);
  });

  it("leaves a link to a higher-numbered ADR", () => {
    const body = "See [ADR-0020](0020-a-decision.md) for what comes next.";
    expect(lowerNumberedAdrLinks(body, 10)).toEqual([]);
  });
});

describe("hasAmendsTrailer", () => {
  it("takes the trailer at the start of a line", () => {
    expect(hasAmendsTrailer("Recorded 2026-08-26.\n\nAmends: [ADR-0004](0004-slug.md).\n")).toBe(true);
  });

  it("leaves the word used mid-sentence", () => {
    expect(hasAmendsTrailer("This amends nothing on its own.")).toBe(false);
  });
});

describe("isMissingAmendsTrailer", () => {
  it("is the whole rule: verb, a lower link, and no trailer", () => {
    const body = "Recorded 2026-08-26.\n\nThis retired [ADR-0005](0005-a-decision.md).\n";
    expect(isMissingAmendsTrailer(adr({ number: 10, body }))).toBe(true);
  });

  it("is never true for an ADR whose only lower-numbered link is introduced by extends", () => {
    // ADR-0028's real shape: extends ADR-0005, and both stand — not supersession.
    const body = "Recorded 2026-08-26.\n\nThis extends [ADR-0005](0005-a-decision.md), and both stand.\n";
    expect(isMissingAmendsTrailer(adr({ number: 28, body }))).toBe(false);
  });

  it("is false once the trailer exists, even with the verb and the link present", () => {
    const body = "Recorded 2026-08-26.\n\nAmends: [ADR-0005](0005-a-decision.md).\n\nThis retired it.\n";
    expect(isMissingAmendsTrailer(adr({ number: 10, body }))).toBe(false);
  });

  it("is false with the verb present but no lower-numbered link at all", () => {
    const body = "Recorded 2026-08-26.\n\nThe old wiki is retired.\n";
    expect(isMissingAmendsTrailer(adr({ number: 10, body }))).toBe(false);
  });
});

describe("hasResolvesPointer", () => {
  it("takes each of the three drifting spellings ADR-0045 found in use", () => {
    expect(hasResolvesPointer("**Resolves:** [x](https://example/1)\n\n## Section\n")).toBe(true);
    expect(hasResolvesPointer("**Researches:** [x](https://example/1)\n\n## Section\n")).toBe(true);
    expect(hasResolvesPointer("Research for [x](https://example/1)\n\n## Section\n")).toBe(true);
  });

  // ADR-0072. The two notes #132 could not clear answer no issue because none was ever filed, and
  // the counter has to read that as an answer — a line nobody can ever tick is what trains a reader
  // to skip the list.
  it("takes the Unprompted: declaration a note with no antecedent issue carries", () => {
    expect(hasResolvesPointer("**Unprompted:** no issue preceded this note\n\n## Section\n")).toBe(true);
    expect(hasResolvesPointer("Unprompted: no issue preceded this note\n\n## Section\n")).toBe(true);
  });

  it("leaves a note whose preamble carries no pointer at all", () => {
    expect(hasResolvesPointer("**Status:** measured\n\n## Section\n")).toBe(false);
  });

  it("leaves a pointer that only appears quoted deep in the body, past the preamble", () => {
    // session-prompts-2026-08.md's real shape: no field of its own, but a quote three sections in
    // that mentions "a real `Resolves:` field" as prose about the convention, not the note's own.
    const body = ["**Status:** measured", "", "## Section", "", "> ...writes a real `Resolves:` field..."].join("\n");
    expect(hasResolvesPointer(body)).toBe(false);
  });
});

describe("isMissingResolvesField", () => {
  it("is false once any recognised pointer is present", () => {
    expect(isMissingResolvesField(note())).toBe(false);
  });

  it("is true with no pointer in the preamble", () => {
    expect(isMissingResolvesField(note({ body: "**Status:** measured\n\n## Section\n" }))).toBe(true);
  });
});

describe("the signal", () => {
  const findings = findMissingTrailers(
    [adr({ number: 10, filename: "0010-slug.md", title: "A ruling", body: "Recorded 2026-08-26.\n\nThis retired [ADR-0005](0005-a-decision.md).\n" })],
    [note({ filename: "topic-2026-08.md", title: "A finding", body: "**Status:** measured\n\n## Section\n" })],
  );

  it("names every finding and carries the marker", () => {
    const body = signalBody(findings);
    expect(body).toContain("0010-slug.md");
    expect(body).toContain("topic-2026-08.md");
    expect(body).toContain(FINDING_MARKER);
  });

  it("counts each kind in its title", () => {
    expect(signalTitle(findings)).toBe("Missing supersession trailer: 1 ADR, 1 research note");
  });
});

describe("readAdrCorpus and readResearchCorpus, against a real tree", () => {
  const adrDir = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/adr");
  const researchDir = join(dirname(fileURLToPath(import.meta.url)), "../../../docs/research");

  it("reads only numbered ADR files, excluding README.md", () => {
    const adrs = readAdrCorpus(adrDir);
    expect(adrs.length).toBeGreaterThan(0);
    expect(adrs.some((doc) => doc.filename === "README.md")).toBe(false);
    for (const doc of adrs) expect(doc.filename).toMatch(/^\d{4}-.*\.md$/);
  });

  it("reads only Markdown research notes, excluding the assets/ directory", () => {
    const notes = readResearchCorpus(researchDir);
    expect(notes.length).toBeGreaterThan(0);
    expect(notes.some((note) => note.filename === "assets")).toBe(false);
    for (const note of notes) expect(note.filename).toMatch(/\.md$/);
  });
});

/**
 * A `gh` stand-in that answers the three calls `countMissingTrailers` makes
 * — the open-issue listing, the write (create or comment) — recording every
 * argv, the same shape `run-watchdog.test.ts` uses: a responder, not a
 * model of GitHub, so a test can assert "wrote nothing else" from `calls`
 * staying exactly what it expects rather than from assuming it.
 */
function fakeGh(options: { issues?: Array<{ number: number; body: string; state: string }> } = {}): {
  gh: GhExec;
  calls: string[][];
} {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "list") return JSON.stringify(options.issues ?? []);
    if (args[0] === "issue" && args[1] === "create") return "https://github.com/owner/repo/issues/42\n";
    if (args[0] === "issue" && args[1] === "comment") return "";
    throw new Error(`fake gh: unhandled argv: ${JSON.stringify(args)}`);
  };
  return { gh, calls };
}

describe("countMissingTrailers", () => {
  function corpusDir(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), "missing-trailer-"));
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    return dir;
  }

  const CANDIDATE_ADR = "Recorded 2026-08-26.\n\nThis retired [ADR-0001](0001-a-decision.md).\n";
  const CLEAN_NOTE = "**Resolves:** [x](https://example/1)\n\n## Section\n";
  const MISSING_NOTE = "**Status:** measured\n\n## Section\n";

  it("writes nothing at all when the corpus carries no candidate", () => {
    const adrDir = corpusDir({ "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n" });
    const researchDir = corpusDir({ "topic-2026-08.md": CLEAN_NOTE });
    const fake = fakeGh();

    const outcome = countMissingTrailers({ gh: fake.gh, adrDir, researchDir });

    expect(outcome).toEqual({ action: "clean", findings: [] });
    expect(fake.calls).toEqual([]);
  });

  it("opens an issue naming every candidate when no standing issue exists", () => {
    const adrDir = corpusDir({
      "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n",
      "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}`,
    });
    const researchDir = corpusDir({ "topic-2026-08.md": MISSING_NOTE });
    const fake = fakeGh();

    const outcome = countMissingTrailers({ gh: fake.gh, adrDir, researchDir, assignee: "collod873" });

    expect(outcome.action).toBe("opened");
    expect(outcome.issue).toBe(42);
    expect(outcome.findings).toHaveLength(2);
    const create = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "create")!;
    expect(create[create.indexOf("--body") + 1]).toContain("0010-a-later-decision.md");
    expect(create[create.indexOf("--body") + 1]).toContain("topic-2026-08.md");
    expect(create[create.indexOf("--assignee") + 1]).toBe("collod873");
  });

  it("comments on a standing issue rather than opening a second one", () => {
    const adrDir = corpusDir({ "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}` });
    const researchDir = corpusDir({ "topic-2026-08.md": CLEAN_NOTE });
    const fake = fakeGh({ issues: [{ number: 7, body: `earlier\n${FINDING_MARKER}`, state: "OPEN" }] });

    const outcome = countMissingTrailers({ gh: fake.gh, adrDir, researchDir });

    expect(outcome).toEqual({ action: "commented", issue: 7, findings: outcome.findings });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create")).toBe(false);
    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    expect(comment[2]).toBe("7");
  });

  it("makes every GitHub write through the injected gh, and only the injected gh", () => {
    const adrDir = corpusDir({ "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}` });
    const researchDir = corpusDir({ "topic-2026-08.md": CLEAN_NOTE });
    const fake = fakeGh();

    countMissingTrailers({ gh: fake.gh, adrDir, researchDir });

    // Every call this run made is one this fake recorded and answered — if the module had shelled
    // out to the real `gh` binary instead, one of these calls would have thrown or hung rather than
    // come back from the fake's own responder.
    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((argv) => argv[0] === "issue")).toBe(true);
  });
});

describe("the IO half never spawns a child process of its own", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "missing-trailer-counter.ts"), "utf8");

  it("imports execGh from the shared seam rather than shelling out itself", () => {
    // The only approved way this pipeline touches `gh` (`shared/gh.ts`'s `execGh`) is imported once,
    // for `main()`'s own real wiring — `countMissingTrailers` itself only ever calls the `gh`
    // parameter it was handed, which is what lets a test stand a fake in for it.
    expect(source).not.toMatch(/execFileSync|execSync|spawnSync|require\(["']child_process["']\)/);
    expect(source).toContain('import { execGh, type GhExec } from "../shared/gh"');
  });
});
