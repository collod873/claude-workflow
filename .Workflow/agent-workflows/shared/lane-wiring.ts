import { DISPATCH_REQUESTS_PATH_ENV } from "./dispatch-request";
import { IMMUTABLE_SET, IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import { CLAIM_TIMEOUT_MINUTES } from "./implementation-landing";
import { NEEDS_HUMAN_LABEL } from "./needs-human";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "./ratification-dispatch";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION, GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "./ready-set";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "./spec-author-dispatch";

/**
 * How the estate is wired, as data: one row per lane, declaring what its reusable workflow and its
 * `*-caller.yml` stub say — the caller's doors, the action its job gates on, the entrypoint it
 * runs, the checkout shape, the token it holds, its `workflow_call` inputs, its concurrency group,
 * the environment it sets, and the odd clauses a lane is known for. `lane-wiring.test.ts` reads
 * every row back against the YAML.
 *
 * Until #360 these facts lived in twenty-odd files, one per lane, each spelling the same
 * assertions in its own words — and a wire name changed on one side passed both sides' tests,
 * because each read only its own (#145, #107). A table is read whole: a reader learns the estate
 * from one page, and a fact the YAML no longer supports fails against the row that claims it.
 *
 * The wire constants come from the modules that declare them, never retyped. `shared/` may not
 * import a lane (docs/agents/module-boundaries.md, rule 2), so the names a lane owns are spelled
 * once in `LANE_OWNED` below, and the test — which may cross that boundary — holds each to the
 * lane's own export.
 *
 * @fixture Reached only from the suite, by design — this is the estate's description, not code any
 * lane runs.
 */

/* -------------------------------------------------------------------------------------------- */
/* Vocabulary                                                                                     */
/* -------------------------------------------------------------------------------------------- */

/**
 * Wire names whose declaring constant lives inside a lane. Spelled once here for the reason the
 * module doc gives; `lane-wiring.test.ts`'s "agrees with the lane that owns it" block is what keeps
 * each equal to its source.
 */
export const LANE_OWNED = {
  /** The capture hook's dispatch, ridden by audit, the run watchdog, the reconciler and walk-home. */
  sessionCaptured: "session-captured",
  /** Lane 02's zero-open-questions dispatch, which starts lane 03 (`spec/open-questions.ts`). */
  prdSliceable: "prd-sliceable",
  /** The label lane 02 leaves as the durable trace of that dispatch (ADR-0062). */
  sliceable: "sliceable",
  /** What marks an issue as a PRD (`spec/publish.ts`, `ratify/prd-close.ts`). */
  prd: "prd",
  /** Lane 06's second door: the owner labelling a hand-written ticket (`dispatch/reconcile.ts`). */
  toBuild: "to-build",
  /** The only close that claims a PRD was delivered (`ratify/prd-close.ts`). */
  closeStateReason: "completed",
  /** The title a ratifier pull request opens with (`ratify/land.ts`). */
  ratifierPrTitle: "Ratified: standards from this batch",
  /** Lane 06's two job display names, which `integrate.ts` looks up by string. */
  immutabilityJob: "Immutability",
  gateJob: "Verify",
  /** The gate step's name in `verify.yml` — the one step the bypass counter counts (`watchdog/bypass.ts`). */
  gateStep: "Gauntlet",
  /** Where `run-audit.ts` expects the corpus checkout, under the target. */
  knowledgeBaseDir: "knowledge-base",
  /** Lane 01's stage-1 refusal label (`shape/shape.ts`). */
  shapeRefused: "shape-refused",
} as const;

/**
 * Wires with no TypeScript constant at all — sent by a workflow step and heard by a caller stub,
 * YAML to YAML. This is their one spelling in code.
 */
export const DEAD_RUN_WIRES = {
  /** `verify.yml`'s signal job → `fixer-caller.yml` (#285, ADR-0114's shape one lane later). */
  fixerNeeded: "fixer-needed",
  /** `implement.yml`'s failure step → `recover-caller.yml` (ADR-0114). */
  implementFailed: "implement-failed",
} as const;

/** Lane 00's issue form applies this at creation; it is the whole of lane 01's trigger. */
export const IDEA_LABEL = "idea";

/** The owner's three verbs on a shaped idea — labels, because a label is something a gate can fire on. */
export const SHAPE_VERBS = ["approved", "parked", "killed"] as const;

/** The labels `shape.ts` applies (`LABELS_APPLIED`), which the workflow must create before the lane can report a refusal. */
export const SHAPE_LABELS_APPLIED = [LANE_OWNED.shapeRefused, NEEDS_HUMAN_LABEL];

/** ADR-0073's sender gate on every human-forgeable door of a lane that spends model. */
export const OWNER_GATE = "github.event.sender.login == github.repository_owner";

/** The machine every reusable lane checks out at its workspace root (ADR-0055, ADR-0132). */
export const MACHINE_REPOSITORY = "collod873/claude-workflow";

/** The `TARGET_WORKSPACE` every entrypoint that reads a tree is handed. */
export const TARGET_WORKSPACE = "${{ github.workspace }}/target";

export const CHECKPOINTS_ACTION = "./.github/actions/checkpoints";
export const ACCEPTANCE_BUNDLE_ACTION = "./.github/actions/acceptance-bundle";

/** `gh`'s own placeholder path for a dispatch send, as a plain literal (see `workflow-permissions.test.ts`). */
export const DISPATCH_SEND = "gh api --method POST 'repos/{owner}/{repo}/dispatches'";

const onAction = (action: string) => `github.event.action == '${action}'`;
const onLabel = (label: string) => `github.event.label.name == '${label}'`;
const tsx = (entrypoint: string) => `npx tsx .Workflow/agent-workflows/${entrypoint}`;
const ring = (wire: string) => [`event_type=${wire}`, "client_payload[run_id]=$GITHUB_RUN_ID"];

/** The `||` chain every workflow_run-plus-dispatch caller resolves its run id through. */
const RESOLVED_RUN_ID = "${{ github.event.workflow_run.id || github.event.client_payload.run_id || github.event.inputs.run_id }}";

/* -------------------------------------------------------------------------------------------- */
/* Row shape                                                                                     */
/* -------------------------------------------------------------------------------------------- */

export type Scope = "read" | "write";
export type Permissions = Readonly<Partial<Record<"contents" | "issues" | "pull-requests" | "actions", Scope>>>;

/**
 * A workflow's `on:` block as `doors()` normalises it: an event's `types` list, a `push` filter as
 * written, a `workflow_run` as `{ workflows, types }`, or `true` for a `workflow_dispatch` (whose
 * `inputs:` are a form, not a condition on whether the door fires).
 */
export type Doors = Readonly<Record<string, unknown>>;

/** What a job's `if:` says. Each field is independent; `is` pins the whole condition. */
export interface Gate {
  /** The whole `if:`, exactly. */
  is?: string;
  /** Every `github.event.action == '…'` clause, and no other action clause. */
  actions?: readonly string[];
  has?: readonly string[];
  lacks?: readonly string[];
  /** Top-level `||` branches, split on `) ||`. */
  doors?: number;
  /** Every branch carries `OWNER_GATE` exactly when it names the `issues` event (ADR-0073). */
  ownerGatesIssues?: true;
}

/**
 * Which checkouts a job makes. `pair` is ADR-0055's shape (`checkout-pair.fixture.ts`);
 * `workspace: false` marks a pair whose entrypoint reads neither tree and so takes no
 * `TARGET_WORKSPACE`.
 */
export type Checkout =
  | "none"
  | "plain"
  | "machine"
  | "pair"
  | { pair: true; targets?: number; fetchDepth?: number; workspace?: false };

/** One step, found by whichever of `name`/`id`/`uses`/`with.phase` are given, then held to the rest. */
export interface StepFact {
  name?: string;
  id?: string;
  uses?: string;
  with?: Readonly<Record<string, unknown>>;
  if?: string;
  run?: readonly string[];
  runLacks?: readonly string[];
  env?: Readonly<Record<string, string>>;
  workingDirectory?: string;
  /** Position in the job, `0` for the first step. */
  index?: number;
  /** The step immediately before this one. */
  follows?: string;
  /** Steps this one must sit somewhere before / after. */
  before?: string;
  after?: string;
  /** No step matches the finder at all. */
  absent?: true;
}

export interface JobFacts {
  /** The job's display `name:`. */
  name?: string;
  gate?: Gate;
  /** The job carries no `if:` — the caller's own job already decided. */
  ungated?: true;
  needs?: readonly string[];
  /** A substring of some step's `run:` — the entrypoint, as `tsx()` spells it. */
  runs?: string;
  checkout?: Checkout;
  /** The job's own `permissions:` block, exactly; `null` for a job that inherits the workflow's. */
  permissions?: Permissions | null;
  /** Job-level `env:` names that must be set; a string pins the value. */
  env?: Readonly<Record<string, string | true>>;
  timeout?: number;
  /** The job's YAML names no `secrets.*` at all. */
  secrets?: false;
  steps?: readonly StepFact[];
}

export interface CallerFacts {
  /** The plain display name — the half a `workflow_run` trigger and a dead-lane signal name. */
  name: string;
  on: Doors;
  permissions: Permissions;
  gate?: Gate;
  with?: Readonly<Record<string, string>>;
}

/**
 * One lane, keyed in `LANE_WIRING` by its id: the reusable half is `<id>.yml` and the caller stub
 * `<id>-caller.yml` — derived, never spelled, since a literal naming a call-only file is exactly
 * what `lane-identity.test.ts` refuses to let a module carry.
 */
export interface LaneWiring {
  /** Absent for a standalone lane, whose own `on:` is `on` below. */
  caller?: CallerFacts;
  on?: Doors;
  /** `workflow_call` inputs beyond `runner`/`machine_ref`, which `lane-invariants` sweeps. */
  inputs?: Readonly<Record<string, { required: boolean; default?: string }>>;
  /** The workflow-level `permissions:` block, exactly. */
  permissions: Permissions;
  /** The `concurrency.group`, exactly; every group here queues (`cancel-in-progress: false`). */
  concurrency?: string;
  jobs: Readonly<Record<string, JobFacts>>;
  source?: { has?: readonly string[]; lacks?: readonly string[] };
}

/* -------------------------------------------------------------------------------------------- */
/* The estate                                                                                    */
/* -------------------------------------------------------------------------------------------- */

const CHECKPOINTS = (lane: string, first: string, last: string): StepFact[] => [
  { uses: CHECKPOINTS_ACTION, with: { phase: "restore", lane }, before: first },
  { uses: CHECKPOINTS_ACTION, with: { phase: "upload", lane }, if: "always()", after: last },
];

const INSTALLS_TARGET: StepFact = { name: "Install target dependencies", workingDirectory: "target", run: ["npm ci"] };

/** The grant a lane that lands on a pull request's branch and labels its ticket holds. */
const ACTS_ON_PULL_REQUEST: Permissions = { contents: "write", "pull-requests": "write", issues: "write", actions: "read" };

/**
 * The caller a lane reacting to a dead upstream run carries (the fixer, Recover): `workflow_run`
 * on the upstream's completion, the upstream's own dispatch for the days `workflow_run` does not
 * arrive (ADR-0114), and a hand door — all resolving one run id through the same `||` chain.
 */
function deadRunCaller(name: string, upstream: string, wire: string, extraGate: string[] = []): CallerFacts {
  return {
    name,
    on: { workflow_run: { workflows: [upstream], types: ["completed"] }, repository_dispatch: [wire], workflow_dispatch: true },
    permissions: ACTS_ON_PULL_REQUEST,
    gate: {
      actions: [wire],
      has: [
        "github.event_name == 'workflow_dispatch'",
        "github.event.workflow_run.conclusion == 'failure'",
        "github.event.workflow_run.conclusion == 'cancelled'",
        ...extraGate,
      ],
    },
    with: { run_id: RESOLVED_RUN_ID },
  };
}
const CONFIGURES_COMMITTER: StepFact = { name: "Configure a committer", run: ["git config user.email"] };
const VERIFY_COMPLETED = { workflow_run: { workflows: ["Verify"], types: ["completed"] } };
const VERIFY_FILE_INPUT = { verify_workflow: { required: true } };
const NAMES_VERIFY_CALLER = { verify_workflow: "verify-caller.yml" };

export const LANE_WIRING: Readonly<Record<string, LaneWiring>> = {
  // Lane 01: shapes an idea into a decision sheet. Fires on the `idea` label and on the owner's
  // change-request comment; both doors gated because both spend the owner's subscription.
  shape: {
    caller: { name: "Shape", on: { issues: ["labeled"], issue_comment: ["created"] }, permissions: { contents: "read", issues: "write" } },
    permissions: { contents: "read", issues: "write" },
    concurrency: "shape-${{ github.event.issue.number }}",
    jobs: {
      shape: {
        gate: {
          doors: 2,
          ownerGatesIssues: true,
          has: [
            "github.event_name == 'issues'",
            onLabel(IDEA_LABEL),
            "github.event_name == 'issue_comment'",
            "!github.event.issue.pull_request",
            `contains(github.event.issue.labels.*.name, '${IDEA_LABEL}')`,
            "github.event.comment.user.type != 'Bot'",
            "contains(fromJSON('[\"OWNER\", \"MEMBER\", \"COLLABORATOR\"]')",
            "github.event.comment.author_association",
          ],
        },
        runs: tsx("shape/shape.ts"),
        checkout: "pair",
        env: { IDEA_NUMBER: true, CHANGE_REQUEST: "${{ github.event.comment.body }}", CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          ...CHECKPOINTS("shape", "Shape", "Shape"),
          {
            name: "Ensure the lane's labels exist",
            run: [...SHAPE_LABELS_APPLIED, ...SHAPE_VERBS, "go-long", "go-short"].map((label) => `gh label create ${label}`),
          },
          { name: "Upload the refused raw response", absent: true },
        ],
      },
    },
    source: { lacks: ["refused-raw-response", "actions/upload-artifact@v4"] },
  },

  // Lane 01's other half: the owner's verb on a shaped idea. No model; files the sheet's ADRs and
  // pushes straight to the target's main. `go-long`/`go-short` modify an accept, never start one.
  "shape-accept": {
    caller: { name: "Shape — accept", on: { issues: ["labeled"] }, permissions: { contents: "write", issues: "write" } },
    permissions: { contents: "write", issues: "write" },
    concurrency: "shape-accept-${{ github.event.issue.number }}",
    jobs: {
      accept: {
        gate: { has: SHAPE_VERBS.map(onLabel), lacks: ["'go-long'", "'go-short'"] },
        runs: tsx("shape/run-accept.ts"),
        checkout: "pair",
        env: { IDEA_NUMBER: true, VERB: "${{ github.event.label.name }}" },
        steps: [CONFIGURES_COMMITTER],
      },
    },
    source: { lacks: ["'go-long'", "'go-short'"] },
  },

  // Lane 02: authors and critiques a spec. Three doors — the accept's `sheet-accepted` dispatch,
  // the hand label `to-spec`, and `prd` on a spec not yet `sliceable` (critic only, ADR-0085) —
  // and a second job holding `contents: write` sends what the gate asked for (ADR-0091).
  spec: {
    caller: {
      name: "Spec",
      on: { issues: ["labeled"], repository_dispatch: [SPEC_AUTHOR_DISPATCH_EVENT_TYPE] },
      permissions: { contents: "write", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "spec-${{ github.event.issue.number || github.event.client_payload.issue }}",
    jobs: {
      spec: {
        gate: {
          doors: 3,
          ownerGatesIssues: true,
          has: [
            "github.event_name == 'repository_dispatch'",
            onLabel("to-spec"),
            onLabel(LANE_OWNED.prd),
            `!contains(github.event.issue.labels.*.name, '${LANE_OWNED.sliceable}')`,
          ],
          lacks: ["issue_comment", "github.event.comment", "author_association"],
        },
        runs: tsx("spec/spec.ts"),
        checkout: "pair",
        env: {
          ISSUE_NUMBER: "${{ github.event.issue.number || github.event.client_payload.issue }}",
          SPEC_TRIGGER: `\${{ (${onLabel(LANE_OWNED.prd)} && 'critique') || 'to-spec' }}`,
          CLAUDE_CODE_OAUTH_TOKEN: true,
        },
        steps: [{ name: "Export the dispatch handoff path", run: [`${DISPATCH_REQUESTS_PATH_ENV}=$RUNNER_TEMP/dispatch-requests.jsonl`] }],
      },
      dispatch: {
        needs: ["spec"],
        gate: { is: "needs.spec.outputs.dispatch-requests != ''" },
        permissions: { contents: "write" },
        checkout: "none",
        env: { GH_REPO: true, DISPATCH_REQUESTS: true },
        steps: [{ name: "Send the dispatch", run: [DISPATCH_SEND] }],
      },
    },
  },

  // Lane 03: slices a PRD into tickets. Fires on lane 02's dispatch, never on a label; refuses a
  // PRD that already has sub-issues or is itself one before spending anything; the `ticket-ready`
  // wave goes out from the write-holding job (ADR-0091).
  "to-tickets": {
    caller: { name: "To-Tickets", on: { repository_dispatch: [LANE_OWNED.prdSliceable] }, permissions: { contents: "write", issues: "write" } },
    permissions: { contents: "read", issues: "write" },
    concurrency: "to-tickets-${{ github.event.client_payload.issue }}",
    jobs: {
      "to-tickets": {
        gate: { is: onAction(LANE_OWNED.prdSliceable), lacks: [onLabel(LANE_OWNED.prd)] },
        runs: `${tsx("to-tickets/to-tickets.ts")} --stage seam-sweep`,
        checkout: "pair",
        env: { PRD_NUMBER: "${{ github.event.client_payload.issue }}", CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          {
            name: "Refuse — PRD already has sub-issues",
            id: "refuse-sub-issues",
            run: [
              'sub_count=$(gh api "repos/${GH_REPO}/issues/${PRD_NUMBER}/sub_issues" --jq \'length\')',
              'gh issue edit "$PRD_NUMBER" --add-label slice-failed',
              'echo "refused=true" >> "$GITHUB_OUTPUT"',
            ],
          },
          {
            name: "Refuse — PRD is itself a sub-issue",
            id: "refuse-nested-prd",
            follows: "Refuse — PRD already has sub-issues",
            run: ["issue(number: $num) { parent { number } }", 'gh issue edit "$PRD_NUMBER" --add-label slice-failed', 'echo "refused=true" >> "$GITHUB_OUTPUT"'],
          },
          ...CHECKPOINTS("to-tickets", "Seam sweep", "Audit and publish"),
          { name: "Slice", run: ["--stage slice"], env: { TARGET_WORKSPACE } },
          { name: "Audit and publish", run: ["--stage audit-and-publish"], env: { TARGET_WORKSPACE } },
          {
            name: "Report failure",
            if: "failure() && steps.refuse-sub-issues.outputs.refused != 'true' && steps.refuse-nested-prd.outputs.refused != 'true'",
            runLacks: ["refused-raw-response"],
          },
          { name: "Upload the refused raw response", absent: true },
        ],
      },
      dispatch: {
        needs: ["to-tickets"],
        gate: { is: "needs.to-tickets.outputs.dispatch-requests != ''" },
        permissions: { contents: "write" },
        checkout: "none",
        steps: [{ name: "Send one dispatch per ready slice", run: [DISPATCH_SEND] }],
      },
    },
    source: { lacks: ["refused-raw-response", "actions/upload-artifact@v4"] },
  },

  // Lane 04: authors a slice's acceptance tests — first time on lane 03's `acceptance-wanted`,
  // again on a spec edit — and a third job lands them on main and tells lane 05 (ADR-0091, #201).
  acceptance: {
    caller: {
      name: "Acceptance",
      on: { issues: ["edited"], repository_dispatch: [ACCEPTANCE_WANTED_DISPATCH_ACTION] },
      permissions: { contents: "write", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "acceptance-${{ github.event.issue.number || github.event.client_payload.issue }}",
    jobs: {
      refire: {
        gate: { has: [`contains(github.event.issue.labels.*.name, '${LANE_OWNED.prd}')`, OWNER_GATE] },
        runs: `${tsx("acceptance/acceptance.ts")} --refire`,
        checkout: "pair",
        env: { ACCEPTANCE_LANDING: "commit" },
        steps: [{ id: "bundle", uses: ACCEPTANCE_BUNDLE_ACTION }],
      },
      author: {
        gate: { is: onAction(ACCEPTANCE_WANTED_DISPATCH_ACTION) },
        runs: `${tsx("acceptance/acceptance.ts")} "$TICKET_NUMBER"`,
        checkout: "pair",
        env: { ACCEPTANCE_LANDING: "commit" },
        steps: [
          { name: "Author acceptance tests for the published slice", runLacks: ["--refire"] },
          { id: "bundle", uses: ACCEPTANCE_BUNDLE_ACTION },
        ],
      },
      land: {
        needs: ["refire", "author"],
        gate: { has: ["needs.refire.outputs.authored == 'true'", "needs.author.outputs.authored == 'true'"] },
        permissions: { contents: "write", issues: "write" },
        runs: tsx("acceptance/land-gate.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        steps: [
          INSTALLS_TARGET,
          {
            name: "Tell lane 05 this slice is ready",
            if: `${onAction(ACCEPTANCE_WANTED_DISPATCH_ACTION)} && github.event.client_payload.ready == '1'`,
            run: [DISPATCH_SEND, `event_type=${TICKET_READY_DISPATCH_ACTION}`],
          },
        ],
      },
    },
  },

  // Lane 05: builds one ticket per `ticket-ready`. No sender gate — a dispatch is already a token.
  // Keyed per ticket so a wave runs as wide as lane 03 cut it (ADR-0108); rings Recover itself on
  // any death, cancellation included (#342).
  implement: {
    caller: {
      name: "Implement",
      on: { repository_dispatch: [TICKET_READY_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    },
    permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    concurrency: "implement-${{ github.event.client_payload.issue }}",
    jobs: {
      implement: {
        gate: { is: onAction(TICKET_READY_DISPATCH_ACTION), lacks: ["sender", "author_association"] },
        timeout: CLAIM_TIMEOUT_MINUTES,
        runs: tsx("implement/implement.ts"),
        checkout: "pair",
        env: { TICKET_NUMBER: "${{ github.event.client_payload.issue }}", CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          INSTALLS_TARGET,
          { name: "Implement the ticket", run: ['echo "implementing #$TICKET_NUMBER"'] },
          { name: "Tell Recover this run failed", if: "failure() || cancelled()", run: ring(DEAD_RUN_WIRES.implementFailed) },
        ],
      },
    },
    source: { lacks: ["implementation-pr-opened"] },
  },

  // Lane 06: the gauntlet on Actions. The caller fires on a push to main and on an implementer's
  // dispatch, never `pull_request` (ADR-0054). `Immutability` refuses a diff crossing the immutable
  // set; a red run rings the fixer from a job of its own holding the one `contents: write`.
  verify: {
    caller: {
      name: "Verify",
      on: {
        push: { branches: ["main"], "paths-ignore": ["**.md", "docs/**", "LICENSE"] },
        repository_dispatch: [IMPLEMENTATION_PR_DISPATCH_ACTION],
      },
      permissions: { contents: "write", "pull-requests": "read" },
    },
    permissions: { contents: "read", "pull-requests": "read" },
    jobs: {
      immutability: {
        name: LANE_OWNED.immutabilityJob,
        gate: { is: onAction(IMPLEMENTATION_PR_DISPATCH_ACTION) },
        checkout: "none",
        permissions: null,
        secrets: false,
        env: { IMMUTABLE_SET: IMMUTABLE_SET.join(","), CHANGED_FILES: true, PR: true },
        steps: [
          { name: "Name the pull request this run is judging", run: ['echo "judging $PR on $BRANCH"'] },
          { name: "Refuse a change to the immutable set" },
        ],
      },
      verify: {
        name: LANE_OWNED.gateJob,
        needs: ["immutability"],
        gate: { is: "always() && needs.immutability.result != 'failure'" },
        permissions: null,
        runs: "npm run check",
        checkout: "pair",
        steps: [{ name: LANE_OWNED.gateStep, run: ["npm run check"] }],
      },
      "signal-fixer": {
        needs: ["immutability", "verify"],
        gate: {
          has: [
            "always()",
            onAction(IMPLEMENTATION_PR_DISPATCH_ACTION),
            "needs.immutability.result == 'failure'",
            "needs.verify.result == 'failure'",
            "needs.immutability.result == 'cancelled'",
            "needs.verify.result == 'cancelled'",
          ],
        },
        permissions: { contents: "write" },
        checkout: "none",
        steps: [{ name: "Tell the Fixer this run went red", run: ring(DEAD_RUN_WIRES.fixerNeeded), env: { GH_REPO: "${{ github.repository }}" } }],
      },
    },
    source: { lacks: ["implementation-pr-opened", "continue-on-error"] },
  },

  // Lane 08: the merge actor, no model. One fixed group — "exactly one merge at a time" is a claim
  // about every pull request, not one per branch. Reads lane 06's verdict off the caller's file.
  integrate: {
    caller: {
      name: "Integrate",
      on: { repository_dispatch: [IMPLEMENTATION_PR_DISPATCH_ACTION] },
      permissions: { contents: "write", issues: "write", "pull-requests": "write", actions: "read" },
      with: NAMES_VERIFY_CALLER,
    },
    inputs: VERIFY_FILE_INPUT,
    permissions: { contents: "write", issues: "write", "pull-requests": "write", actions: "read" },
    concurrency: "integrate",
    jobs: {
      integrate: {
        gate: { is: onAction(IMPLEMENTATION_PR_DISPATCH_ACTION) },
        runs: `${tsx("integrate/integrate.ts")} "$PR" "$HEAD_SHA"`,
        checkout: { pair: true, fetchDepth: 0 },
        env: { HEAD_SHA: "${{ github.sha }}", VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}", SIGNAL_ASSIGNEE: true },
        steps: [INSTALLS_TARGET],
      },
    },
    source: { lacks: ["implementation-pr-opened"] },
  },

  // Lane 07's other half: reacts to a red Verify on an implementer's pull request. Three doors on
  // the caller — `workflow_run`, verify.yml's own `fixer-needed`, and a hand door — and a marker
  // comment written before anything is spent makes whichever arrives second a no-op.
  fixer: {
    // `event != 'push'`: a red push run is trunk being broken, with no pull request to fix.
    caller: deadRunCaller("Fixer", "Verify", DEAD_RUN_WIRES.fixerNeeded, ["github.event.workflow_run.event != 'push'"]),
    inputs: { run_id: { required: false, default: "" } },
    permissions: ACTS_ON_PULL_REQUEST,
    concurrency: "fixer-${{ inputs.run_id || github.run_id }}",
    jobs: {
      fixer: {
        ungated: true,
        runs: `${tsx("fixer/fixer.ts")} "$ISSUE"`,
        checkout: { pair: true, targets: 2 },
        env: { RUN_ID: "${{ inputs.run_id }}", SIGNAL_ASSIGNEE: true, CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          {
            id: "target",
            index: 0,
            run: [
              'gh run view "$RUN_ID" --json status',
              '[ "$STATUS" = "completed" ]',
              "after five minutes",
              'MARKER="<!-- fixer-run:$RUN_ID -->"',
              'gh pr view "$PR" --json comments',
              'gh pr comment "$PR" --body',
            ],
          },
          { name: "Checkout target", with: { ref: "${{ steps.target.outputs.branch }}" } },
          INSTALLS_TARGET,
        ],
      },
    },
  },

  // Lane 07: the correctness reviewer, on a green Verify that an implementer's dispatch started —
  // never the push run, whose diff against trunk is empty.
  review: {
    caller: {
      name: "Review",
      on: VERIFY_COMPLETED,
      permissions: { contents: "read", issues: "write" },
      gate: { has: ["github.event.workflow_run.conclusion == 'success'", "github.event.workflow_run.event != 'push'"] },
      with: { head_sha: "${{ github.event.workflow_run.head_sha }}" },
    },
    inputs: { head_sha: { required: true } },
    permissions: { contents: "read", issues: "write" },
    concurrency: "review-${{ inputs.head_sha }}",
    jobs: {
      review: {
        ungated: true,
        runs: tsx("review/review.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: { SIGNAL_ASSIGNEE: true, CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [{ name: "Checkout target", with: { ref: "${{ inputs.head_sha }}" } }],
      },
    },
  },

  // Recover: finishes a dead Implement run's tail over the answer it already produced, or
  // re-dispatches the ticket. No model. Same three doors as the fixer, keyed on the failed run.
  recover: {
    caller: deadRunCaller("Recover", "Implement", DEAD_RUN_WIRES.implementFailed),
    inputs: { run_id: { required: false, default: "" } },
    permissions: ACTS_ON_PULL_REQUEST,
    concurrency: "recover-${{ inputs.run_id || github.run_id }}",
    jobs: {
      recover: {
        ungated: true,
        runs: tsx("recover/recover.ts"),
        checkout: "pair",
        env: { RUN_ID: "${{ inputs.run_id }}" },
        steps: [INSTALLS_TARGET, { name: "Recover or re-dispatch", env: { HUSKY: "0" } }],
      },
    },
    source: { lacks: ["npm install -g @anthropic-ai/claude-code", "secrets.CLAUDE_CODE_OAUTH_TOKEN"] },
  },

  // Lane 09: recomputes the ready set from durable state and dispatches `ticket-ready` for what
  // nothing started (#179). `session-captured` is the floor, `graph-changed` a latency hint, and
  // the owner's `to-build` label enters the recompute rather than firing its own dispatch.
  "dispatch-reconcile": {
    caller: {
      name: "Dispatch reconcile",
      on: {
        repository_dispatch: [LANE_OWNED.sessionCaptured, GRAPH_CHANGED_DISPATCH_ACTION],
        issues: ["labeled"],
        workflow_dispatch: true,
      },
      permissions: { contents: "write", issues: "write" },
      with: NAMES_VERIFY_CALLER,
    },
    inputs: VERIFY_FILE_INPUT,
    permissions: { contents: "write", issues: "write" },
    concurrency: "dispatch-reconcile",
    jobs: {
      reconcile: {
        gate: {
          actions: [LANE_OWNED.sessionCaptured, GRAPH_CHANGED_DISPATCH_ACTION],
          has: ["github.event_name == 'workflow_dispatch'", "github.event_name == 'issues'", onLabel(LANE_OWNED.toBuild), OWNER_GATE],
        },
        runs: tsx("dispatch/reconcile.ts"),
        checkout: "pair",
        env: {
          EVENT_ACTION: "${{ (github.event_name == 'repository_dispatch' && github.event.action) || '" + LANE_OWNED.sessionCaptured + "' }}",
          VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}",
        },
      },
    },
    source: { lacks: ["@anthropic-ai/claude-code", "CLAUDE_CODE_OAUTH_TOKEN"] },
  },

  // The observations pipeline's connector: runs both lenses over a captured session's range, with
  // the private Knowledge-Base corpus checked out under the target where `run-audit.ts` reads it.
  audit: {
    caller: { name: "Audit", on: { repository_dispatch: [LANE_OWNED.sessionCaptured] }, permissions: { contents: "write", "pull-requests": "write" } },
    permissions: { contents: "write", "pull-requests": "write" },
    concurrency: "audit",
    jobs: {
      audit: {
        gate: { is: onAction(LANE_OWNED.sessionCaptured) },
        runs: tsx("observations/run-audit.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: { HEAD_SHA: true, EVENT_ACTION: true, CLAUDE_CODE_OAUTH_TOKEN: true, KNOWLEDGE_BASE_DEPLOY_KEY: true },
        steps: [{ name: "Checkout Knowledge-Base", with: { repository: "collod873/Knowledge-Base", path: `target/${LANE_OWNED.knowledgeBaseDir}` } }],
      },
    },
  },

  // The ratifier lane (#296): one full-tool stage per finding, landed as one pull request through
  // the same door every implementation pull request uses. Rung by the audit and by a PRD close.
  ratify: {
    caller: {
      name: "Ratify",
      on: { repository_dispatch: [RATIFICATION_DUE_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    },
    permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    concurrency: "ratify",
    jobs: {
      ratify: {
        gate: { is: onAction(RATIFICATION_DUE_DISPATCH_ACTION) },
        runs: tsx("ratify/run-ratify.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: { HEAD_SHA: true, PRD_CLOSED: true, EVENT_ACTION: true, PR_BASE: true, CLAUDE_CODE_OAUTH_TOKEN: true },
      },
    },
  },

  // A PRD closing as delivered rings the ratifier (ADR-0017's second trigger). A gate and a
  // dispatch, nothing else — no model, no git write, no committer.
  "ratify-on-prd-close": {
    caller: { name: "Ratify on PRD close", on: { issues: ["closed"] }, permissions: { contents: "write", issues: "read" } },
    permissions: { contents: "write", issues: "read" },
    concurrency: "ratify-on-prd-close-${{ github.event.issue.number }}",
    jobs: {
      "ratify-on-prd-close": {
        gate: {
          is: `github.event.issue.state_reason == '${LANE_OWNED.closeStateReason}' && contains(github.event.issue.labels.*.name, '${LANE_OWNED.prd}')`,
        },
        runs: tsx("ratify/prd-close.ts"),
        checkout: { pair: true, workspace: false },
        env: { ISSUE_NUMBER: true, STATE_REASON: true, LABELS: true },
      },
    },
  },

  // Ratified = merged: when a ratifier pull request lands, record each standard it carried as a
  // `ratified` note on the merge commit. The title is the only thing that tells one apart.
  "ratify-release": {
    caller: { name: "Ratify release", on: { pull_request: ["closed"] }, permissions: { contents: "write" } },
    permissions: { contents: "write" },
    jobs: {
      "ratify-release": {
        gate: { is: `github.event.pull_request.title == '${LANE_OWNED.ratifierPrTitle}'` },
        runs: tsx("observations/run-ratification.ts"),
        checkout: "pair",
        env: { PR_NUMBER: true, PR_MERGED: true, PR_BODY: true, MERGE_COMMIT_SHA: true },
      },
    },
  },

  // The owner's one lever (#296): a standard reverted out of the tree is remembered as declined.
  // Fires only on the two files a standard can enter or leave through.
  "decline-on-revert": {
    caller: {
      name: "Decline on revert",
      on: { push: { branches: ["main"], paths: ["CODING_STANDARDS.md", "eslint.config.js"] } },
      permissions: { contents: "write" },
    },
    permissions: { contents: "write" },
    concurrency: "decline-on-revert",
    jobs: {
      decline: { ungated: true, runs: tsx("ratify/run-revert-detector.ts"), checkout: { pair: true, fetchDepth: 0 } },
    },
  },

  // #41: a run that executed zero jobs reaches a human. Sweeps on session end because `workflow_run`
  // is blind to a file GitHub could not parse — the exact failure this exists for (ADR-0049).
  "run-watchdog": {
    caller: {
      name: "Run watchdog",
      on: { repository_dispatch: [LANE_OWNED.sessionCaptured] },
      permissions: { contents: "read", actions: "read", issues: "write" },
    },
    permissions: { contents: "read", actions: "read", issues: "write" },
    concurrency: "run-watchdog",
    jobs: {
      watch: {
        gate: { is: onAction(LANE_OWNED.sessionCaptured) },
        runs: tsx("watchdog/run-watchdog.ts"),
        checkout: { pair: true, workspace: false },
        env: { EVENT_ACTION: true, SIGNAL_ASSIGNEE: true },
      },
    },
    source: { lacks: ["schedule:"] },
  },

  // A bypass of the free gates becomes one countable event: rides Verify completing on main and
  // counts the caller's own file, since the reusable half carries no runs of its own (ADR-0132).
  "bypass-counter": {
    caller: {
      name: "Bypass counter",
      on: VERIFY_COMPLETED,
      permissions: { contents: "read", actions: "read", issues: "write" },
      gate: { is: "github.event.workflow_run.head_branch == 'main'" },
      with: NAMES_VERIFY_CALLER,
    },
    inputs: VERIFY_FILE_INPUT,
    permissions: { contents: "read", actions: "read", issues: "write" },
    concurrency: "bypass-counter",
    jobs: {
      count: {
        ungated: true,
        runs: tsx("watchdog/bypass-counter.ts"),
        checkout: "machine",
        env: { SIGNAL_ASSIGNEE: true, VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}" },
      },
    },
    source: { lacks: ["schedule:"] },
  },

  // A dispatch that never arrived leaves no run to sweep; the `sliceable` label is its only trace
  // (ADR-0062). The label gate sits on the caller, since `workflow_call` cannot filter by value.
  "lost-dispatch-counter": {
    caller: {
      name: "Lost-dispatch counter",
      on: { issues: ["labeled"] },
      permissions: { contents: "read", actions: "read", issues: "write" },
      gate: { is: onLabel(LANE_OWNED.sliceable) },
      with: { slicing_workflow: "to-tickets-caller.yml" },
    },
    inputs: { slicing_workflow: { required: true } },
    permissions: { contents: "read", actions: "read", issues: "write" },
    concurrency: "lost-dispatch-counter",
    jobs: {
      count: {
        ungated: true,
        runs: tsx("watchdog/lost-dispatch-counter.ts"),
        checkout: { pair: true, workspace: false },
        env: { LABEL_NAME: true, PRD_NUMBER: true, SLICING_WORKFLOW: "${{ inputs.slicing_workflow }}" },
      },
    },
    source: { lacks: ["schedule:"] },
  },

  // #124: an `Amends:` trailer is survivable only because a missing one is detected. Sweeps the
  // ADR and research corpus on the commit that touches either.
  "missing-trailer-counter": {
    caller: {
      name: "Missing-trailer counter",
      on: { push: { branches: ["main"], paths: ["docs/adr/**", "docs/research/**"] } },
      permissions: { contents: "read", issues: "write" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "missing-trailer-counter",
    jobs: {
      count: { ungated: true, runs: tsx("watchdog/missing-trailer-counter.ts"), checkout: "pair", env: { SIGNAL_ASSIGNEE: true } },
    },
  },

  // #125: a superseded ADR gains its `Status:` line from the successor's `Amends:` trailer. The
  // trigger is the add-event, never a clock or the session-end dispatch (ADR-0046).
  "back-stamp": {
    caller: {
      name: "Back-stamp",
      on: { push: { branches: ["main"], paths: ["docs/adr/**", "docs/research/**"] } },
      permissions: { contents: "write" },
    },
    permissions: { contents: "write" },
    concurrency: "back-stamp",
    jobs: {
      stamp: { ungated: true, runs: tsx("watchdog/back-stamp-walk.ts"), checkout: "pair", steps: [CONFIGURES_COMMITTER] },
    },
    source: { lacks: ["schedule:"] },
  },

  // Enrolment (ADR-0133): writes the stub set into every repository carrying the topic. The one
  // lane with no caller, since no enrolled repository enrols anyone; spends `ENROL_PAT`, the one
  // outward credential, on two triggers no pull request can fire (ADR-0053).
  enrol: {
    on: { push: { branches: ["main"], paths: [".github/workflows/*-caller.yml"] }, workflow_dispatch: true },
    permissions: { contents: "read" },
    concurrency: "enrol",
    jobs: {
      enrol: {
        ungated: true,
        runs: tsx("enrol/enrol.ts"),
        checkout: "plain",
        steps: [{ name: "Write the stub set into every enrolled repository", env: { GH_TOKEN: "${{ secrets.ENROL_PAT }}" } }],
      },
    },
    source: { has: ["secrets.ENROL_PAT"] },
  },

  // Walk home (ADR-0135/0136): a red run in an enrolled repository is either the machine's defect
  // or the caller's, and the failing path says which. The other caller-less lane, for the same
  // reason as enrol, and on the same credential.
  "walk-home": {
    on: { repository_dispatch: [LANE_OWNED.sessionCaptured] },
    permissions: { contents: "read", issues: "write" },
    concurrency: "walk-home",
    jobs: {
      walk: {
        gate: { is: onAction(LANE_OWNED.sessionCaptured) },
        runs: tsx("watchdog/walk-home.ts"),
        checkout: "plain",
        env: { EVENT_ACTION: true, GH_TOKEN: "${{ secrets.ENROL_PAT }}" },
      },
    },
    source: { has: ["secrets.ENROL_PAT"], lacks: ["schedule:"] },
  },
};

/**
 * A workflow's `on:` block in the shape a row's `Doors` declares — see the type for the rules.
 * Exported so the test compares a file's doors to a row's, not a row's to a hand-normalised copy.
 */
export function doors(on: Record<string, unknown> | undefined): Doors {
  return Object.fromEntries(
    Object.entries(on ?? {}).map(([event, condition]) => {
      if (event === "workflow_dispatch") return [event, true];
      if (event === "push" || event === "workflow_call") return [event, condition];
      const typed = condition as { types?: string[]; workflows?: string[] } | null;
      if (event === "workflow_run") return [event, { workflows: typed?.workflows, types: typed?.types }];
      return [event, typed?.types];
    }),
  );
}
