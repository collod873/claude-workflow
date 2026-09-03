import { describe, expect, it } from "vitest";
import { createFakeGit } from "../shared/git.fake";
import {
  adrNumber,
  amendedAdrNumbers,
  deriveBackStamps,
  statusLine,
  trailerGraph,
  withStatusLine,
  type DocFile,
} from "./back-stamp";
import { backStampWalk, INDEX_RELATIVE_PATH, type WalkDeps } from "./back-stamp-walk";

function adr(number: number, title: string, body: string, amends?: string): DocFile {
  const padded = String(number).padStart(4, "0");
  const trailer = amends ? `\n\n${amends}` : "";
  return {
    path: `docs/adr/${padded}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`,
    content: `---\nstatus: constraint\ndate: 2026-08-26${trailer}\nreversal: stated in the fixture\n---\n\n# ${title}\n\n${body}\n`,
  };
}

const PREDECESSOR_32 = adr(32, "An acceptance test is immutable", "The acceptance job checks out trunk's copy.");
const PREDECESSOR_33 = adr(33, "A spec edit re-fires acceptance", "Every slice whose test names it.");
const PREDECESSOR_26 = adr(26, "The build order lives as issues", "Moves become issues with blocked-by edges.");
const UNRELATED = adr(1, "GitHub is the spec and issue tracker", "The state machine lives there.");

const SUCCESSOR_53 = adr(
  53,
  "The acceptance lane pushes to main",
  "Lane 04 commits its tests directly to main.",
  "\namends: ADR-0032, ADR-0033",
);
const SUCCESSOR_54 = adr(
  54,
  "An implementation PR's checks fire by dispatch",
  "Lane 05's implementer opens its pull request.",
  "\namends: ADR-0032",
);
const SUCCESSOR_66 = adr(
  66,
  "A number lives in an ADR or a counter row",
  "Every number this design carries is a counter or a sizing measurement.",
  "\namends: ADR-0026",
);

const FIXTURE: DocFile[] = [
  PREDECESSOR_32,
  PREDECESSOR_33,
  PREDECESSOR_26,
  UNRELATED,
  SUCCESSOR_53,
  SUCCESSOR_54,
  SUCCESSOR_66,
];

describe("the judgement, run over a fixture trailer graph", () => {
  it("derives one back-stamp write per predecessor an amends: declaration names, and nothing else", () => {
    const writes = deriveBackStamps(FIXTURE);

    expect(writes.map((write) => write.path).sort()).toEqual([PREDECESSOR_26.path, PREDECESSOR_32.path, PREDECESSOR_33.path].sort());
  });

  it("combines two successors of the same predecessor into one stamp, ADR numbers ascending", () => {
    const writes = deriveBackStamps(FIXTURE);
    const stamp32 = writes.find((write) => write.path === PREDECESSOR_32.path);

    expect(stamp32?.content).toContain("superseded_by: ADR-0053, ADR-0054");
  });

  it("stamps a predecessor with a single successor", () => {
    const writes = deriveBackStamps(FIXTURE);

    expect(writes.find((write) => write.path === PREDECESSOR_33.path)?.content).toContain(
      "superseded_by: ADR-0053",
    );
    expect(writes.find((write) => write.path === PREDECESSOR_26.path)?.content).toContain(
      "superseded_by: ADR-0066",
    );
  });

  it("does not touch a successor's own file, or an ADR named by no trailer at all", () => {
    const writes = deriveBackStamps(FIXTURE);
    const touched = new Set(writes.map((write) => write.path));

    for (const successor of [SUCCESSOR_53, SUCCESSOR_54, SUCCESSOR_66, UNRELATED]) {
      expect(touched.has(successor.path), `${successor.path} should not have been stamped`).toBe(false);
    }
  });

  it("preserves the predecessor's own body beneath the inserted trailer", () => {
    const writes = deriveBackStamps(FIXTURE);
    const stamp32 = writes.find((write) => write.path === PREDECESSOR_32.path);

    expect(stamp32?.content).toContain("The acceptance job checks out trunk's copy.");
  });

  it("a second run over the now-stamped tree derives nothing left to write", () => {
    const first = deriveBackStamps(FIXTURE);
    const stampedByPath = new Map(first.map((write) => [write.path, write.content]));
    const restamped: DocFile[] = FIXTURE.map((file) => ({
      path: file.path,
      content: stampedByPath.get(file.path) ?? file.content,
    }));

    expect(deriveBackStamps(restamped)).toEqual([]);
  });
});

describe("adrNumber", () => {
  it("reads the four-digit prefix out of a docs/adr/ path", () => {
    expect(adrNumber("docs/adr/0032-an-acceptance-test.md")).toBe(32);
    expect(adrNumber("docs/adr/0066-a-number-lives.md")).toBe(66);
  });

  it("is undefined for a file with no numeric prefix, so README.md is never a predecessor", () => {
    expect(adrNumber("docs/adr/README.md")).toBeUndefined();
    expect(adrNumber("docs/research/some-note.md")).toBeUndefined();
  });
});

describe("amendedAdrNumbers", () => {
  it("reads bin/new-adr --amends's plain trailer form", () => {
    expect(amendedAdrNumbers("---\nstatus: note\ndate: 2026-08-26\namends: ADR-0008\nreversal: x\n---\n\n# Title\n\nBody.\n")).toEqual([8]);
  });

  it("reads a hand-written markdown-link trailer, including a second target wrapped onto the next line", () => {
    expect(amendedAdrNumbers(SUCCESSOR_53.content)).toEqual([32, 33]);
  });

  it("reads a trailer that trails prose after the link, on the same paragraph", () => {
    expect(amendedAdrNumbers(SUCCESSOR_66.content)).toEqual([26]);
  });

  it("is empty when the file carries no amends: declaration at all", () => {
    expect(amendedAdrNumbers(PREDECESSOR_32.content)).toEqual([]);
  });

  it("stops at the trailer's own paragraph, so an unrelated ADR-NNNN mentioned later in the body is not read as amended", () => {
    const content = "---\nstatus: note\ndate: 2026-08-26\namends: ADR-0008\nreversal: x\n---\n\n# Title\n\nSee also ADR-0099 for context.\n";
    expect(amendedAdrNumbers(content)).toEqual([8]);
  });
});

describe("trailerGraph", () => {
  it("ignores a trailer naming its own file, since an ADR cannot supersede itself", () => {
    const selfReferencing = adr(9, "Self-referencing", "body", "\namends: ADR-0009");
    expect(trailerGraph([selfReferencing]).get(9)).toBeUndefined();
  });

  it("is empty over a corpus with no amends: declaration anywhere", () => {
    expect(trailerGraph([PREDECESSOR_32, PREDECESSOR_33, UNRELATED]).size).toBe(0);
  });
});

describe("statusLine", () => {
  it("names one successor", () => {
    expect(statusLine([53])).toBe("superseded_by: ADR-0053");
  });

  it("names several successors, comma-separated", () => {
    expect(statusLine([53, 54])).toBe("superseded_by: ADR-0053, ADR-0054");
  });
});

describe("withStatusLine", () => {
  const CONTENT = "---\nstatus: constraint\ndate: 2026-08-26\nreversal: x\n---\n\n# A title\n\nThe body starts here.\n";

  it("writes superseded_by into the frontmatter, right after date", () => {
    const updated = withStatusLine(CONTENT, [53]);

    expect(updated).toBe(
      "---\nstatus: superseded\ndate: 2026-08-26\nsuperseded_by: ADR-0053\nreversal: x\n---\n\n# A title\n\nThe body starts here.\n",
    );
  });

  it("returns the same reference, unchanged, when the exact line is already there", () => {
    const already = withStatusLine(CONTENT, [53]);
    expect(withStatusLine(already, [53])).toBe(already);
  });

  it("replaces a stale stamp in place rather than adding a second line", () => {
    const stamped = withStatusLine(CONTENT, [53]);
    const widened = withStatusLine(stamped, [53, 54]);

    expect(widened).toContain("superseded_by: ADR-0053, ADR-0054");
    expect(widened.match(/^superseded_by: /gm)).toHaveLength(1);
  });
});

const CORPUS: Record<string, string> = Object.fromEntries(FIXTURE.map((file) => [file.path, file.content]));

function fakeDeps(
  files: Record<string, string>,
  indexRegenerated = true,
): WalkDeps & { writes: Record<string, string>; calls: string[][] } {
  const writes: Record<string, string> = {};
  const { git, calls } = createFakeGit(() => "");

  return {
    repoRoot: ".",
    readDir: (dir) => {
      if (dir !== "docs/adr") throw new Error(`fake readDir: unexpected dir ${dir}`);
      return Object.keys(files).map((path) => path.split("/").pop()!);
    },
    readFile: (path) => {
      const content = files[path];
      if (content === undefined) throw new Error(`fake readFile: no such file ${path}`);
      return content;
    },
    writeFile: (path, content) => {
      writes[path] = content;
    },
    regenerateIndex: () => {
      calls.push(["regenerate-index"]);
      return indexRegenerated;
    },
    git,
    log: () => {},
    writes,
    calls,
  };
}

function verb(argv: string[]): string {
  return argv[0] === "-C" ? argv[2] : argv[0];
}

describe("backStampWalk", () => {
  it("writes the derived back-stamps and commits them add-commit-fetch-rebase-push to main", () => {
    const deps = fakeDeps(CORPUS);

    const outcome = backStampWalk(deps);

    expect(outcome.action).toBe("committed");
    expect(outcome.stamped.sort()).toEqual(
      [PREDECESSOR_26.path, PREDECESSOR_32.path, PREDECESSOR_33.path].sort(),
    );
    expect(deps.writes[PREDECESSOR_32.path]).toContain("superseded_by: ADR-0053, ADR-0054");

    expect(deps.calls.map(verb)).toEqual([
      "regenerate-index",
      "add",
      "commit",
      "fetch",
      "rebase",
      "push",
    ]);
    const add = deps.calls.find((argv) => verb(argv) === "add")!;
    expect(add.slice(3).sort()).toEqual([...outcome.stamped, INDEX_RELATIVE_PATH].sort());
    expect(deps.calls.find((argv) => verb(argv) === "push")).toEqual(["-C", deps.repoRoot, "push", "origin", "HEAD:main"]);
  });

  it("regenerates docs/adr/INDEX.md before staging it, because a stamp rewrites the status: the index publishes", () => {
    const deps = fakeDeps(CORPUS);

    backStampWalk(deps);

    const order = deps.calls.map(verb);
    expect(order.indexOf("regenerate-index")).toBeLessThan(order.indexOf("add"));
    expect(deps.calls.find((argv) => verb(argv) === "add")).toContain(INDEX_RELATIVE_PATH);
  });

  it("stages no index where there was none to regenerate, and still commits the stamps", () => {
    const deps = fakeDeps(CORPUS, false);

    expect(backStampWalk(deps).action).toBe("committed");

    const add = deps.calls.find((argv) => verb(argv) === "add")!;
    expect(add).not.toContain(INDEX_RELATIVE_PATH);
  });

  it("regenerates nothing on a clean walk, so a run with no stamp to make stages no fixture churn", () => {
    const deps = fakeDeps({ [PREDECESSOR_32.path]: PREDECESSOR_32.content, [UNRELATED.path]: UNRELATED.content });

    expect(backStampWalk(deps).action).toBe("clean");
    expect(deps.calls).toEqual([]);
  });

  it("a second run over the tree it just wrote makes zero further GitExec commit calls", () => {
    const first = fakeDeps(CORPUS);
    expect(backStampWalk(first).action).toBe("committed");

    const stamped = { ...CORPUS, ...first.writes };
    const second = fakeDeps(stamped);

    expect(backStampWalk(second)).toEqual({ action: "clean", stamped: [] });
    expect(second.calls.filter((argv) => verb(argv) === "commit")).toEqual([]);
    expect(second.calls).toEqual([]); 
  });

  it("commits nothing over a corpus with no amends: declaration anywhere", () => {
    const deps = fakeDeps({ [PREDECESSOR_32.path]: PREDECESSOR_32.content, [UNRELATED.path]: UNRELATED.content });

    expect(backStampWalk(deps)).toEqual({ action: "clean", stamped: [] });
    expect(deps.calls).toEqual([]);
  });

  it("treats a docs/adr/ that cannot be read as an empty corpus rather than throwing", () => {
    const deps: WalkDeps = {
      repoRoot: ".",
      readDir: () => {
        throw new Error("ENOENT");
      },
      readFile: () => {
        throw new Error("should not be called");
      },
      writeFile: () => {
        throw new Error("should not be called");
      },
      regenerateIndex: () => {
        throw new Error("should not be called");
      },
      git: () => {
        throw new Error("should not be called");
      },
      log: () => {},
    };

    expect(backStampWalk(deps)).toEqual({ action: "clean", stamped: [] });
  });
});
