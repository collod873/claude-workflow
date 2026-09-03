import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import type { GhExec } from "../shared/gh";
import evidence from "./adr-corpus.evidence.json";
import { countMissingTrailers, readAdrCorpus, readResearchCorpus } from "./missing-trailer-counter";
import { answerTrackerOrThrow } from "./signal-tracker.fixture";
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

const EVIDENCE: { adrs: AdrDoc[]; notes: ResearchNote[] } = evidence;

function corpusDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "missing-trailer-"));
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), body);
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function adr(overrides: Partial<AdrDoc> = {}): AdrDoc {
  return { number: 10, filename: "0010-slug.md", title: "A ruling", body: "Recorded 2026-08-26.\n\nSome text.\n", ...overrides };
}

function note(overrides: Partial<ResearchNote> = {}): ResearchNote {
  return { filename: "topic-2026-08.md", title: "A finding", body: "**Resolves:** [x](https://example/1)\n\n## Section\n", ...overrides };
}

describe("the rule, run over the corpus that motivated it", () => {
  it("has a corpus to run over, so a green suite is not an empty sweep", () => {
    expect(EVIDENCE.adrs.length).toBeGreaterThan(50);
    expect(EVIDENCE.notes.length).toBeGreaterThan(5);
  });

  it("flags every ADR that carries an amends: declaration, and nothing else", () => {
    const trailered = EVIDENCE.adrs.filter((doc) => hasAmendsTrailer(doc.body));

    for (const doc of trailered) expect(doc.body).toMatch(/^amends:\s*ADR-\d{4}/m);
    expect(trailered.map((doc) => doc.filename).sort()).toEqual(expect.arrayContaining([
      "0029-marks-route-an-item-the-five-decision-cap-is-what-refuses-it.md",
      "0032-an-acceptance-test-is-immutable-because-ci-runs-trunk-s-copy.md",
      "0039-the-governor-does-not-ship-concurrency-is-bounded-by-ready-d.md",
      "0043-write-on-surprise-does-not-ship-the-transcript-auditor-alrea.md",
      "0053-the-acceptance-lane-pushes-to-main-so-the-immutability-rule.md",
      "0054-an-implementation-pr-s-checks-fire-by-repository-dispatch-so.md",
      "0066-a-number-lives-in-an-adr-or-in-a-counter-row-never-in-the-op.md",
      "0071-branch-protection-is-declined-so-move-10-retires-and-its-cou.md",
      "0072-a-research-note-with-no-antecedent-issue-declares-that-in-a.md",
    ]));
  });

  it("flags every verb-and-link ADR with no trailer, and nothing that fails any of those three", () => {
    const candidates = EVIDENCE.adrs.filter(isMissingAmendsTrailer);

    for (const doc of candidates) {
      expect(hasSupersessionVerb(doc.body)).toBe(true);
      expect(lowerNumberedAdrLinks(doc.body, doc.number).length).toBeGreaterThan(0);
      expect(hasAmendsTrailer(doc.body)).toBe(false);
    }

    const shouldFlag = EVIDENCE.adrs.filter(
      (doc) =>
        hasSupersessionVerb(doc.body) &&
        lowerNumberedAdrLinks(doc.body, doc.number).length > 0 &&
        !hasAmendsTrailer(doc.body),
    );
    expect(candidates.map((doc) => doc.filename).sort()).toEqual(
      shouldFlag.map((doc) => doc.filename).sort(),
    );

    const synthetic = {
      number: 99,
      filename: "0099-a-synthetic-ruling.md",
      title: "A synthetic ruling",
      body: "This retires [ADR-0045](0045-a-superseded-adr-is-named-by-a-trailer.md) outright.\n",
    };
    expect(isMissingAmendsTrailer(synthetic)).toBe(true);
    expect(isMissingAmendsTrailer({ ...synthetic, body: `---\namends: ADR-0045\n---\n${synthetic.body}` }))
      .toBe(false);
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

    expect(findings.filter((f) => f.kind === "adr")).toHaveLength(
      EVIDENCE.adrs.filter(isMissingAmendsTrailer).length,
    );
    expect(findings.filter((f) => f.kind === "research-note")).toHaveLength(
      EVIDENCE.notes.filter(isMissingResolvesField).length,
    );
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
    expect(hasAmendsTrailer("status: note\ndate: 2026-08-26\namends: ADR-0004\n")).toBe(true);
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
    const body = "Recorded 2026-08-26.\n\nThis extends [ADR-0005](0005-a-decision.md), and both stand.\n";
    expect(isMissingAmendsTrailer(adr({ number: 28, body }))).toBe(false);
  });

  it("is false once the trailer exists, even with the verb and the link present", () => {
    const body = "status: note\ndate: 2026-08-26\namends: ADR-0005\n\nThis retired it.\n";
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

  it("takes the Unprompted: declaration a note with no antecedent issue carries", () => {
    expect(hasResolvesPointer("**Unprompted:** no issue preceded this note\n\n## Section\n")).toBe(true);
    expect(hasResolvesPointer("Unprompted: no issue preceded this note\n\n## Section\n")).toBe(true);
  });

  it("leaves a note whose preamble carries no pointer at all", () => {
    expect(hasResolvesPointer("**Status:** measured\n\n## Section\n")).toBe(false);
  });

  it("leaves a pointer that only appears quoted deep in the body, past the preamble", () => {
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

describe("readAdrCorpus and readResearchCorpus, against a tree shaped like docs/", () => {
  it("reads only numbered ADR files, excluding README.md and the bare template", () => {
    const adrDir = corpusDir({
      "README.md": "# About these\n",
      "0000-template.md": "# ---\n",
      "0001-a-decision.md": "# A decision\n\nRecorded.\n",
      "0002-another.md": "# Another\n\nRecorded.\n",
      "draft-not-yet-landed.md": "# A draft\n",
    });

    const adrs = readAdrCorpus(adrDir);

    expect(adrs.map((doc) => doc.filename).sort()).toEqual(["0000-template.md", "0001-a-decision.md", "0002-another.md"]);
    expect(adrs.find((doc) => doc.number === 1)?.title).toBe("A decision");
  });

  it("reads only Markdown research notes, excluding the assets/ directory and drafts", () => {
    const researchDir = corpusDir({
      "topic-2026-08.md": "# A finding\n\n**Resolves:** [x](https://example/1)\n",
      "draft-topic.md": "# Not yet part of the record\n",
      "notes.txt": "not markdown",
    });
    mkdirSync(join(researchDir, "assets"));
    writeFileSync(join(researchDir, "assets", "diagram.md"), "# inside assets\n");

    const notes = readResearchCorpus(researchDir);

    expect(notes.map((note) => note.filename)).toEqual(["topic-2026-08.md"]);
    expect(notes[0].title).toBe("A finding");
  });
});

function standingIssueWith(options: {
  issues?: Array<{ number: number; body: string; state: string }>;
  said?: string;
} = {}): {
  gh: GhExec;
  calls: string[][];
} {
  const calls: string[][] = [];
  const gh: GhExec = (args) => {
    calls.push(args);
    if (args[0] === "issue" && args[1] === "comment") return "";
    if (args[0] === "issue" && args[1] === "close") return "";
    if (args[0] === "issue" && args[1] === "view")
      return JSON.stringify({ body: options.said ?? "", comments: [] });
    return answerTrackerOrThrow(args, options.issues ?? []);
  };
  return { gh, calls };
}

describe("countMissingTrailers", () => {
  function runOver(adrs: Record<string, string>, options: Parameters<typeof standingIssueWith>[0] = {}) {
    const adrDir = corpusDir(adrs);
    const researchDir = corpusDir({ "topic-2026-08.md": CLEAN_NOTE });
    const fake = standingIssueWith(options);
    const outcome = countMissingTrailers({ gh: fake.gh, adrDir, researchDir });
    return { outcome, fake };
  }

  const STANDING = {
    issues: [{ number: 7, body: `earlier\n${FINDING_MARKER}`, state: "OPEN" }],
  };

  const CANDIDATE_ADR = "Recorded 2026-08-26.\n\nThis retired [ADR-0001](0001-a-decision.md).\n";
  const CLEAN_NOTE = "**Resolves:** [x](https://example/1)\n\n## Section\n";
  const MISSING_NOTE = "**Status:** measured\n\n## Section\n";

  it("writes nothing at all when the corpus carries no candidate", () => {
    const { outcome, fake } = runOver({ "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n" });

    expect(outcome).toEqual({ action: "clean", findings: [] });
    expect(fake.calls.filter((argv) => argv[1] !== "list")).toEqual([]);
  });

  it("opens an issue naming every candidate when no standing issue exists", () => {
    const adrDir = corpusDir({
      "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n",
      "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}`,
    });
    const researchDir = corpusDir({ "topic-2026-08.md": MISSING_NOTE });
    const fake = standingIssueWith();

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
    const { outcome, fake } = runOver({ "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}` }, STANDING);

    expect(outcome).toEqual({ action: "commented", issue: 7, findings: outcome.findings });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "create")).toBe(false);
    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    expect(comment[2]).toBe("7");
  });

  it("closes the standing issue when the count reaches zero", () => {
    const { outcome, fake } = runOver({ "0001-a-decision.md": "# A decision\n\nRecorded 2026-08-20.\n" }, STANDING);

    expect(outcome).toEqual({ action: "closed", issue: 7, findings: [] });
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "close")).toBe(true);
    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    expect(comment[comment.indexOf("--body") + 1]).toContain("Recovered");
  });

  it("says nothing when every finding is already named on the standing issue", () => {
    const { outcome, fake } = runOver({ "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}` }, { ...STANDING, said: "0010-a-later-decision.md was already reported here" });

    expect(outcome.action).toBe("silent");
    expect(fake.calls.some((argv) => argv[0] === "issue" && argv[1] === "comment")).toBe(false);
  });

  it("comments on only the findings it has not already named", () => {
    const { outcome, fake } = runOver({
      "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}`,
      "0011-another.md": `# Another\n\n${CANDIDATE_ADR}`,
    }, { ...STANDING, said: "0010-a-later-decision.md was already reported here" });

    expect(outcome.action).toBe("commented");
    const comment = fake.calls.find((argv) => argv[0] === "issue" && argv[1] === "comment")!;
    const body = comment[comment.indexOf("--body") + 1];
    expect(body).toContain("0011-another.md");
    expect(body).not.toContain("0010-a-later-decision.md");
  });

  it("makes every GitHub write through the injected gh, and only the injected gh", () => {
    const adrDir = corpusDir({ "0010-a-later-decision.md": `# A later decision\n\n${CANDIDATE_ADR}` });
    const researchDir = corpusDir({ "topic-2026-08.md": CLEAN_NOTE });
    const fake = standingIssueWith();

    countMissingTrailers({ gh: fake.gh, adrDir, researchDir });

    expect(fake.calls.length).toBeGreaterThan(0);
    expect(fake.calls.every((argv) => argv[0] === "issue")).toBe(true);
  });
});
