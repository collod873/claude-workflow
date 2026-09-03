import { describe, expect, it } from "vitest";
import { closeTicket as runCloseTicket, issueViewRoute, trackerAnswering } from "./close-ticket.fixture";
import { IMMUTABLE_SET } from "./immutable-set";
import { slice } from "./plan.fixture";
import { reason } from "./reason";
import { renderBody, validateClaimsAreMutable, validateCriteriaShape, validatePathsAreRooted } from "./render-body";
import { scratchDir } from "./scratch.fixture";
import { commandsPythonRecovers } from "./ticket-shape.fixture";

function closeTicket(body: string): {
  status: number | null;
  stderr: string;
  stdout: string;
  calls: string[][];
} {
  const gh = trackerAnswering([issueViewRoute(body)]);
  const run = runCloseTicket(["42", "aaaa..bbbb", scratchDir("close-ticket-checkout")], gh.path);
  return { ...run, calls: gh.calls() };
}

const called = (calls: string[][], verb: string) => calls.some((call) => call[0] === "issue" && call[1] === verb);

describe("a published body, read by the script that closes it", () => {
  it("hands the Python reader a command for every criterion it renders", () => {
    const body = renderBody(
      slice({
        title: "Thread the sheet's decisions through gateSpec",
        acceptanceCriteria: [
          "`gateSpec` passes the sheet's decisions to `gateCount` — check: `npx vitest --run spec/spec.test.ts`",
          "A held round names every unfiled mark — check: `npx vitest --run spec/render.test.ts`",
        ],
      }),
      189,
    );

    expect(commandsPythonRecovers(body)).toEqual([
      "npx vitest --run spec/spec.test.ts",
      "npx vitest --run spec/render.test.ts",
    ]);
  });

  it("refuses the shape lane 03 actually emitted, before anything is published", () => {
    const plan = [
      slice({
        title: "Lift readTicket into shared/ticket-shape.ts",
        acceptanceCriteria: [
          "check: grep -q 'export function parentPrdNumber' shared/ticket-shape.ts",
        ],
      }),
    ];

    expect(() => validateCriteriaShape(plan)).toThrow(/names no `check:` marker/);
  });

  it.each([
    ["an unquoted command", "readTicket is exported — check: grep -q readTicket shared/x.ts"],
    ["two backtick spans after the label", "It works — check: `make test` and `npm run lint`"],
    ["prose after the command", "It works — check: `make test` in the checkout"],
    ["no marker at all", "readTicket is exported from shared/ticket-shape.ts"],
    ["a wrapped criterion", "readTicket is exported —\ncheck: `make test`"],
  ])("refuses %s", (_label, criterion) => {
    expect(() => renderBody(slice({ title: "A slice", acceptanceCriteria: [criterion] }), 1))
      .toThrow(/acceptance criterion/);
  });

  it.each([
    ["gh api against the tracker (#201's fourth criterion)", "Lane 04 has authored once — check: `gh api repos/collod873/claude-workflow/contents/docs >/dev/null 2>&1`"],
    ["gh issue view", "The spec says so — check: `gh issue view 42 --json body`"],
    ["gh pr", "The PR merges — check: `gh pr view 7 --json mergeable`"],
    ["gh run list", "The lane ran — check: `gh run list --limit 1`"],
    ["curl", "The endpoint answers — check: `curl -sf https://example.com/health`"],
    ["wget", "The artifact was fetched — check: `wget -q -O- https://example.com`"],
  ])("refuses a check that reads the tracker instead of the tree: %s", (_label, criterion) => {
    expect(() => renderBody(slice({ title: "A slice", acceptanceCriteria: [criterion] }), 1))
      .toThrow(/checks the tracker instead of the tree/);
  });

  it("does not refuse a check that reaches an absolute path outside the repo (#220's own criteria)", () => {
    const criterion =
      "The drain skill resolves the repository's own `bin/close-ticket` in preference to the skill's copy — check: `grep -q 'bin/close-ticket' /home/collin/.agents/skills/drain/SKILL.md`";

    expect(() =>
      renderBody(slice({ title: "A slice", acceptanceCriteria: [criterion] }), 1),
    ).not.toThrow();
  });

  it("names every offending slice in one refusal, not just the first", () => {
    const plan = [
      slice({ title: "First", acceptanceCriteria: ["It works."] }),
      slice({ title: "Second", acceptanceCriteria: ["It works — check: `make test`"] }),
      slice({ title: "Third", acceptanceCriteria: ["check: make test"] }),
    ];

    expect(() => validateCriteriaShape(plan)).toThrow(/First[\s\S]*Third/);
  });
});

describe("close-ticket, on a body it cannot verify", () => {
  it("reports an unparseable check as a failure, not as an absent one", () => {
    const body = renderBody(
      slice({ title: "Published before #215", acceptanceCriteria: ["It works — check: `make test`"] }),
      1,
    ).replace("— check: `make test`", "check: grep -q parentPrdNumber shared/ticket-shape.ts");

    const run = closeTicket(body);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/cannot run/);
    expect(run.stdout).toBe("");
    expect(called(run.calls, "comment")).toBe(false);
    expect(called(run.calls, "close")).toBe(false);
  });

  it("does not close a ticket whose every criterion came back unverified", () => {
    const body = [
      "## Acceptance criteria",
      "- [ ] The thing is wired up",
      "- [ ] The other thing is wired up",
      "",
      "## Files claimed",
      "- shared/x.ts",
    ].join("\n");

    const run = closeTicket(body);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/every criterion unverified/);
    expect(called(run.calls, "close")).toBe(false);
  });

  it("still closes on a criterion whose command it can run", () => {
    const body = renderBody(
      slice({ title: "A real one", acceptanceCriteria: ["It works — check: `true`"] }),
      1,
    );

    const run = closeTicket(body);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("1 of 1 criteria verified");
    expect(called(run.calls, "close")).toBe(true);
  });
});

describe("validateClaimsAreMutable", () => {
  it.each([
    ["the config the acceptance allowlist lives in", "vitest.config.ts"],
    ["a workflow the implementation would run under", ".github/workflows/verify.yml"],
  ])("refuses a slice claiming %s", (_label, path) => {
    const plan = [slice({ title: "Checkpoint core", filesClaimed: [path] })];

    expect(() => validateClaimsAreMutable(plan)).toThrow(/no pull request may touch/);
  });

  it("names every offending slice, so one re-fire fixes the whole plan", () => {
    const plan = [
      slice({ title: "First", filesClaimed: ["vitest.config.ts"] }),
      slice({ title: "Second", filesClaimed: [".Workflow/agent-workflows/shared/stage.ts"] }),
      slice({ title: "Third", filesClaimed: [".github/workflows/spec.yml"] }),
    ];

    expect(() => validateClaimsAreMutable(plan)).toThrow(/First[\s\S]*Third/);
  });

  it("passes a plan whose claims are all ordinary source", () => {
    const plan = [
      slice({
        title: "Checkpoint core",
        filesClaimed: [
          ".Workflow/agent-workflows/shared/stage.ts",
          ".Workflow/agent-workflows/shared/handoff-path.ts",
        ],
      }),
    ];

    expect(() => validateClaimsAreMutable(plan)).not.toThrow();
  });

  it("reads the same set the Immutability job reads, rather than a second copy", () => {
    for (const entry of IMMUTABLE_SET) {
      const claimed = entry.endsWith("/") ? `${entry}something.ts` : entry;
      expect(() => validateClaimsAreMutable([slice({ title: "S", filesClaimed: [claimed] })])).toThrow();
    }
  });
});

const PRD_271 = {
  272: slice({
    title: "Checkpoint core in runStage, proven end-to-end through to-tickets' resume",
    whatToBuild:
      "Extract `handoffPath`/`DEFAULT_HANDOFF_PATH` into `shared/handoff-path.ts`; add checkpoint " +
      "key/write/skip (prompt+SHA hash, `<stage>.json` under `checkpoints/`, `output.parse` " +
      "revalidation, fail-open) to `runStage`, relocating `preservingRaw`/`rawResponsePath` there; " +
      "wire to-tickets.ts's 3 stages onto it; isolate checkpoint writes per test file.",
    acceptanceCriteria: [
      "A retry after audit-and-publish failed spawns a model only for it — check: `npx vitest --run .Workflow/agent-workflows/to-tickets/resume.test.ts`",
      "A stage with a key-matching checkpoint calls no StageExec and returns it re-validated through the stage's output.parse — check: `npx vitest --run .Workflow/agent-workflows/shared/stage.test.ts`",
      "readPriorHandoff reads the upstream stage's checkpoint file, not the shared handoff — check: `npx vitest --run .Workflow/agent-workflows/to-tickets/to-tickets.test.ts`",
      "A successful stage no longer writes its output to handoffPath() — check: `npx vitest --run .Workflow/agent-workflows/to-tickets/to-tickets.test.ts`",
      "The full pre-existing suite passes with checkpoint writes isolated per test file — check: `npx vitest --run .Workflow .claude`",
    ],
    filesClaimed: [
      ".Workflow/agent-workflows/shared/handoff-path.ts",
      ".Workflow/agent-workflows/shared/stage.ts",
      ".Workflow/agent-workflows/shared/stage.test.ts",
      ".Workflow/agent-workflows/shared/isolate-checkpoints.setup.ts",
      ".Workflow/agent-workflows/to-tickets/to-tickets.ts",
      ".Workflow/agent-workflows/to-tickets/to-tickets.test.ts",
      ".Workflow/agent-workflows/to-tickets/resume.test.ts",
      ".gitignore",
    ],
  }),
  274: slice({
    title: "Name every remaining runStage call site",
    whatToBuild:
      "Add a literal `stage: \"<name>\"` to StageOptions at every remaining runStage call: spec.ts, " +
      "sweep.ts, critic.ts, reconcile.ts, amend.ts, review.ts (both calls), refuter.ts, implement.ts, " +
      "fixer.ts, acceptance.ts. No other change — each stays exactly what it does today.",
    acceptanceCriteria: [
      "Every one of the ten call sites' StageOptions literal includes a stage key — check: `npx vitest --run .Workflow/agent-workflows/shared/lane-stage-names.test.ts`",
      "The full existing suite still passes — check: `npx vitest --run .Workflow .claude`",
    ],
    filesClaimed: [
      ".Workflow/agent-workflows/spec/spec.ts",
      ".Workflow/agent-workflows/spec/sweep.ts",
      ".Workflow/agent-workflows/spec/critic.ts",
      ".Workflow/agent-workflows/spec/reconcile.ts",
      ".Workflow/agent-workflows/spec/amend.ts",
      ".Workflow/agent-workflows/review/review.ts",
      ".Workflow/agent-workflows/review/refuter.ts",
      ".Workflow/agent-workflows/implement/implement.ts",
      ".Workflow/agent-workflows/fixer/fixer.ts",
      ".Workflow/agent-workflows/acceptance/acceptance.ts",
      ".Workflow/agent-workflows/shared/lane-stage-names.test.ts",
    ],
  }),
  275: slice({
    title: "Carry checkpoints across runs as an artifact",
    whatToBuild:
      "Add `.github/actions/checkpoints/action.yml` (restore/upload phases; restore resolves the " +
      "latest `checkpoints-<lane>-<issue>` artifact via `gh api .../actions/artifacts`, logging what " +
      "it restored). Wire restore and `if: always()` upload steps into to-tickets.yml and shape.yml; " +
      "delete the raw-response upload steps; repoint failure comments at the artifact.",
    acceptanceCriteria: [
      "Both workflows restore before their first stage step and upload with if: always() after their last — check: `npx vitest --run .Workflow/agent-workflows/shared/checkpoint-wiring.test.ts`",
      "The restore phase queries actions/artifacts rather than a plain download-artifact — check: `grep -q 'actions/artifacts' .github/actions/checkpoints/action.yml`",
      "Both 'Upload the refused raw response' if: failure() steps are removed from to-tickets.yml and shape.yml — check: `npx vitest --run .Workflow/agent-workflows/shared/checkpoint-wiring.test.ts`",
    ],
    filesClaimed: [
      ".github/actions/checkpoints/action.yml",
      ".github/workflows/to-tickets.yml",
      ".github/workflows/shape.yml",
      ".Workflow/agent-workflows/shared/checkpoint-wiring.test.ts",
    ],
  }),
  276: slice({
    title: "Make StageOptions.stage required",
    whatToBuild:
      "Now that every runStage call site names its stage, drop the `?` on `StageOptions.stage` in " +
      "shared/stage.ts, making it required, and remove any code path that tolerated a missing name. " +
      "No caller changes: every real one already passes it.",
    acceptanceCriteria: [
      "The whole repo still typechecks once every call site is required to name its stage — check: `npx tsc --pretty false`",
      "stage is declared non-optional on StageOptions — check: `grep -q 'stage: string;' .Workflow/agent-workflows/shared/stage.ts`",
      "The full suite still passes — check: `npx vitest --run .Workflow .claude`",
    ],
    filesClaimed: [
      ".Workflow/agent-workflows/shared/stage.ts",
      ".Workflow/agent-workflows/shared/stage.test.ts",
    ],
  }),
};

describe("validatePathsAreRooted, on PRD #271 as lane 03 actually published it", () => {
  it("refuses #272 on `checkpoints/`, the one token lane 04 and lane 05 rooted differently", () => {
    expect(() => validatePathsAreRooted([PRD_271[272]])).toThrow(/checkpoints\//);
  });

  it("refuses #272 on nothing else — every other path it names resolves from the body", () => {
    let refusal = "";
    try {
      validatePathsAreRooted([PRD_271[272]]);
    } catch (err) {
      refusal = reason(err);
    }

    expect(refusal).toMatch(/checkpoints\//);
    expect(refusal).not.toMatch(/handoff-path/);
    expect(refusal).not.toMatch(/to-tickets\.ts/);
  });

  it.each([274, 275, 276] as const)("passes #%i, which built and merged unchanged", (number) => {
    expect(() => validatePathsAreRooted([PRD_271[number]])).not.toThrow();
  });
});

describe("validatePathsAreRooted", () => {
  it("refuses a claim that names no top-level entry, since the prose is rooted against it", () => {
    const plan = [slice({ title: "Root", filesClaimed: ["shared/stage.ts"] })];

    expect(() => validatePathsAreRooted(plan)).toThrow(/no top-level entry/);
  });

  it("names every offending slice, so one re-fire fixes the whole plan", () => {
    const plan = [
      slice({ title: "First", whatToBuild: "Write it under `checkpoints/`." }),
      slice({ title: "Second", filesClaimed: [".Workflow/agent-workflows/shared/stage.ts"] }),
      slice({ title: "Third", whatToBuild: "Write it under `scratch/`." }),
    ];

    expect(() => validatePathsAreRooted(plan)).toThrow(/First[\s\S]*Third/);
  });

  it.each([
    ["a documented decision", "See docs/adr/0010-every-gate.md for why."],
    ["a bare filename that is a top-level entry", "Edit vitest.config.ts and package.json."],
    ["a property access that looks like an extension", "Revalidate through the stage's output.parse."],
    ["a command flag", "It typechecks — check: `npx tsc --pretty false`"],
    ["a label with a slash in it", "The reviewer files spec/gap rather than a finding."],
    ["a markdown link to an unrooted target", "See [ADR-0010](0010-every-gate-fires-at-the-earliest.md)."],
    ["a URL", "Recorded at https://github.com/collod873/claude-workflow/blob/main/x.md today."],
  ])("does not read %s as an unrooted path", (_label, prose) => {
    expect(() => validatePathsAreRooted([slice({ title: "S", whatToBuild: prose })])).not.toThrow();
  });

  it("refuses an unrooted path in a criterion, not only in What to build", () => {
    const plan = [
      slice({
        title: "Root",
        acceptanceCriteria: ["The setup file is declared — check: `grep -q setup config/vitest.setup.ts`"],
      }),
    ];

    expect(() => validatePathsAreRooted(plan)).toThrow(/vitest\.setup\.ts/);
  });
});
