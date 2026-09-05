import { DISPATCH_REQUESTS_PATH_ENV } from "./dispatch-request";
import { IMMUTABLE_SET, IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import { CLAIM_TIMEOUT_MINUTES } from "./implementation-landing";
import { NEEDS_HUMAN_LABEL } from "./needs-human";
import { RATIFICATION_DUE_DISPATCH_ACTION } from "./ratification-dispatch";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION, GRAPH_CHANGED_DISPATCH_ACTION, TICKET_READY_DISPATCH_ACTION } from "./ready-set";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "./spec-author-dispatch";

/**
 * @fixture Reached only from the suite, by design: this is the estate's description, not code any
 * lane runs.
 */

export const LANE_OWNED = {
  sessionCaptured: "session-captured",
  prdSliceable: "prd-sliceable",
  sliceable: "sliceable",
  prd: "prd",
  toBuild: "to-build",
  closeStateReason: "completed",
  ratifierPrTitle: "Ratified: standards from this batch",
  immutabilityJob: "Immutability",
  gateJob: "Verify",
  gateStep: "Gauntlet",
  knowledgeBaseDir: "knowledge-base",
  shapeRefused: "shape-refused",
} as const;

export const DEAD_RUN_WIRES = {
  fixerNeeded: "fixer-needed",
  implementFailed: "implement-failed",
} as const;

export const IDEA_LABEL = "idea";

export const SHAPE_VERBS = ["approved", "parked", "killed"] as const;

export const SHAPE_LABELS_APPLIED = [LANE_OWNED.shapeRefused, NEEDS_HUMAN_LABEL];

export const OWNER_GATE = "github.event.sender.login == github.repository_owner";

export const MACHINE_REPOSITORY = "collod873/claude-workflow";

export const TARGET_WORKSPACE = "${{ github.workspace }}/target";

export const CHECKPOINTS_ACTION = "./.github/actions/checkpoints";
export const ACCEPTANCE_BUNDLE_ACTION = "./.github/actions/acceptance-bundle";

export const DISPATCH_SEND = "gh api --method POST 'repos/{owner}/{repo}/dispatches'";

const onAction = (action: string) => `github.event.action == '${action}'`;
const onLabel = (label: string) => `github.event.label.name == '${label}'`;
const tsx = (entrypoint: string) => `npx tsx .Workflow/agent-workflows/${entrypoint}`;
const ring = (wire: string) => [`event_type=${wire}`, "client_payload[run_id]=$GITHUB_RUN_ID"];

const RESOLVED_RUN_ID = "${{ github.event.workflow_run.id || github.event.client_payload.run_id || github.event.inputs.run_id }}";

export type Scope = "read" | "write";
export type Permissions = Readonly<Partial<Record<"contents" | "issues" | "pull-requests" | "actions", Scope>>>;

export type Doors = Readonly<Record<string, unknown>>;

export interface Gate {
  is?: string;
  actions?: readonly string[];
  has?: readonly string[];
  lacks?: readonly string[];
  doors?: number;
  ownerGatesIssues?: true;
}

export type Checkout =
  | "none"
  | "plain"
  | "machine"
  | "pair"
  | { pair: true; targets?: number; fetchDepth?: number; workspace?: false };

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
  index?: number;
  follows?: string;
  before?: string;
  after?: string;
  absent?: true;
}

export interface JobFacts {
  name?: string;
  gate?: Gate;
  ungated?: true;
  needs?: readonly string[];
  runs?: string;
  checkout?: Checkout;
  permissions?: Permissions | null;
  env?: Readonly<Record<string, string | true>>;
  timeout?: number;
  secrets?: false;
  steps?: readonly StepFact[];
}

export interface CallerFacts {
  name: string;
  on: Doors;
  permissions: Permissions;
  gate?: Gate;
  with?: Readonly<Record<string, string>>;
}

export interface LaneWiring {
  caller?: CallerFacts;
  on?: Doors;
  inputs?: Readonly<Record<string, { required: boolean; default?: string }>>;
  permissions: Permissions;
  concurrency?: string;
  jobs: Readonly<Record<string, JobFacts>>;
  source?: { has?: readonly string[]; lacks?: readonly string[] };
}

const CHECKPOINTS = (lane: string, first: string, last: string): StepFact[] => [
  { uses: CHECKPOINTS_ACTION, with: { phase: "restore", lane }, before: first },
  { uses: CHECKPOINTS_ACTION, with: { phase: "upload", lane }, if: "always()", after: last },
];

const INSTALLS_TARGET: StepFact = { name: "Install target dependencies", workingDirectory: "target", run: ["npm ci"] };

const ACTS_ON_PULL_REQUEST: Permissions = { contents: "write", "pull-requests": "write", issues: "write", actions: "read" };

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
            name: "Refuse, PRD already has sub-issues",
            id: "refuse-sub-issues",
            run: [
              'sub_count=$(gh api "repos/${GH_REPO}/issues/${PRD_NUMBER}/sub_issues" --jq \'length\')',
              'gh issue edit "$PRD_NUMBER" --add-label slice-failed',
              'echo "refused=true" >> "$GITHUB_OUTPUT"',
            ],
          },
          {
            name: "Refuse, PRD is itself a sub-issue",
            id: "refuse-nested-prd",
            follows: "Refuse, PRD already has sub-issues",
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
        steps: [INSTALLS_TARGET, { id: "bundle", uses: ACCEPTANCE_BUNDLE_ACTION }],
      },
      author: {
        gate: { is: onAction(ACCEPTANCE_WANTED_DISPATCH_ACTION) },
        runs: `${tsx("acceptance/acceptance.ts")} "$TICKET_NUMBER"`,
        checkout: "pair",
        env: { ACCEPTANCE_LANDING: "commit" },
        steps: [
          INSTALLS_TARGET,
          { name: "Author acceptance tests for the published slice", runLacks: ["--refire"] },
          { id: "bundle", uses: ACCEPTANCE_BUNDLE_ACTION },
        ],
      },
      land: {
        needs: ["refire", "author"],
        gate: { has: ["needs.refire.outputs.authored == 'true'", "needs.author.outputs.authored == 'true'"] },
        permissions: { contents: "write", issues: "write" },
        runs: "npm run check",
        checkout: { pair: true, fetchDepth: 0 },
        steps: [
          INSTALLS_TARGET,
          { name: LANE_OWNED.gateStep, run: ["npm run check"] },
          {
            name: "Tell lane 05 this slice is ready",
            if: `${onAction(ACCEPTANCE_WANTED_DISPATCH_ACTION)} && github.event.client_payload.ready == '1'`,
            run: [DISPATCH_SEND, `event_type=${TICKET_READY_DISPATCH_ACTION}`],
          },
          {
            name: "Say on the ticket that landing failed, and wait for a human",
            if: `failure() && ${onAction(ACCEPTANCE_WANTED_DISPATCH_ACTION)}`,
            run: ["--add-label needs-human", "gh issue comment"],
          },
        ],
      },
    },
  },

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

  fixer: {
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
