import { DISPATCH_REQUESTS_PATH_ENV } from "./dispatch-request";
import { IMMUTABLE_SET, IMPLEMENTATION_PR_DISPATCH_ACTION } from "./immutable-set";
import { CLAIM_TIMEOUT_MINUTES } from "./implementation-landing";
import { BY_HAND_LABEL, NEEDS_HUMAN_LABEL, PRD_LABEL, SHAPE_REFUSED_LABEL, SLICEABLE_LABEL, TO_BUILD_LABEL } from "./labels";
import { RATIFICATION_DUE_DISPATCH_ACTION, RATIFIER_MERGED_DISPATCH_ACTION } from "./ratification-dispatch";
import {
  ACCEPTANCE_WANTED_DISPATCH_ACTION,
  GRAPH_CHANGED_DISPATCH_ACTION,
  MECHANIC_WANTED_DISPATCH_ACTION,
  TICKET_READY_DISPATCH_ACTION,
} from "./ready-set";
import { SPEC_AUTHOR_DISPATCH_EVENT_TYPE } from "./spec-author-dispatch";

/**
 * @fixture Reached only from the suite and the lane map, by design: this is the estate's
 * description, not code any lane runs.
 */

export const LANE_OWNED = {
  sessionCaptured: "session-captured",
  prdSliceable: "prd-sliceable",
  sliceable: SLICEABLE_LABEL,
  prd: PRD_LABEL,
  toBuild: TO_BUILD_LABEL,
  closeStateReason: "completed",
  immutabilityJob: "Immutability",
  gateJob: "Verify",
  gateStep: "Gauntlet",
  knowledgeBaseDir: "knowledge-base",
  shapeRefused: SHAPE_REFUSED_LABEL,
} as const;

export const DEAD_RUN_WIRES = {
  fixerNeeded: "fixer-needed",
} as const;

export const REVIEW_WANTED = "review-wanted";

export const RUN_ENDED = "run-ended";

export const MAIN_MOVED = "main-moved";

export const ENDING_LANES = [
  "Acceptance",
  "Audit",
  "Back-stamp",
  "Bypass counter",
  "Decline on revert",
  "Fixer",
  "Implement",
  "Integrate",
  "Lost-dispatch counter",
  "Mechanic",
  "Missing-trailer counter",
  "Ratify",
  "Ratify on PRD close",
  "Ratify release",
  "Review",
  "Run watchdog",
  "Shape",
  "Shape — accept",
  "Spec",
  "To-Tickets",
  "Verify",
] as const;

const ticketRunName = (lane: string) => `${lane} #\${{ github.event.client_payload.issue }}`;

export const SHAPE_LABELS_APPLIED = [LANE_OWNED.shapeRefused, NEEDS_HUMAN_LABEL];

export const MACHINE_REPOSITORY = "collod873/claude-workflow";

export const TARGET_WORKSPACE = "${{ github.workspace }}/target";

export const CHECKPOINTS_ACTION = "./.github/actions/checkpoints";
export const ACCEPTANCE_BUNDLE_ACTION = "./.github/actions/acceptance-bundle";
export const TARGET_DEPS_ACTION = "./.github/actions/target-deps";

export const DISPATCH_SEND = "gh api --method POST 'repos/{owner}/{repo}/dispatches'";

const onAction = (action: string) => `github.event.action == '${action}'`;
const onLabel = (label: string) => `github.event.label.name == '${label}'`;
const tsx = (entrypoint: string) => `npx tsx .Workflow/agent-workflows/${entrypoint}`;
const ring = (wire: string) => [`event_type=${wire}`, "client_payload[run_id]=$GITHUB_RUN_ID"];

const RESOLVED_RUN_ID = "${{ github.event.client_payload.run_id || github.event.inputs.run_id }}";

export type Scope = "read" | "write";
export type Permissions = Readonly<Partial<Record<"contents" | "issues" | "pull-requests" | "actions", Scope>>>;

export type Doors = Readonly<Record<string, unknown>>;

export interface Gate {
  is?: string;
  actions?: readonly string[];
  has?: readonly string[];
  lacks?: readonly string[];
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
  runName?: string;
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

const INSTALLS_TARGET: StepFact = {
  name: "Install target dependencies",
  uses: TARGET_DEPS_ACTION,
  with: { "working-directory": "target" },
};

const ACTS_ON_PULL_REQUEST: Permissions = { contents: "write", "pull-requests": "write", issues: "write", actions: "read" };

function deadRunCaller(name: string, wire: string): CallerFacts {
  return {
    name,
    on: { repository_dispatch: [wire], workflow_dispatch: true },
    permissions: ACTS_ON_PULL_REQUEST,
    with: { run_id: RESOLVED_RUN_ID },
  };
}
const CONFIGURES_COMMITTER: StepFact = { name: "Configure a committer", run: ["git config user.email"] };
const HANDS_OVER_ON_RED = (noun: string, variable: string): StepFact => ({
  name: `Hand the ${noun} to the owner if this run died`,
  if: "always()",
  env: { JOB_STATUS: "${{ job.status }}" },
  run: [tsx("shared/labels.cli.ts"), `fail "$${variable}" --status "$JOB_STATUS"`],
});
const WAKES_RECONCILER: StepFact = {
  name: "Wake the reconciler, whatever ended this run",
  if: "always()",
  after: "Hand the ticket to the owner if this run died",
  run: [DISPATCH_SEND, ...ring(RUN_ENDED)],
};
const WAKES_RECONCILER_JOB: JobFacts = {
  needs: ["refire", "author", "land"],
  gate: { is: "always()" },
  permissions: { contents: "write" },
  checkout: "none",
  timeout: 5,
  steps: [{ name: WAKES_RECONCILER.name, run: WAKES_RECONCILER.run, env: { GH_REPO: "${{ github.repository }}" } }],
};
const READS_THE_EVENT: Readonly<Record<string, string>> = {
  EVENT_NAME: "${{ github.event_name }}",
  EVENT_SENDER: "${{ github.event.sender.login }}",
  EVENT_ISSUE_LABELS: "${{ join(github.event.issue.labels.*.name, ',') }}",
};

const READS_THE_DISPATCH_DOOR = { ...READS_THE_EVENT, EVENT_ACTION: "${{ github.event.action }}" };

const READS_THE_LABEL_DOOR = { ...READS_THE_EVENT, EVENT_LABEL: "${{ github.event.label.name }}" };

const READS_THE_COMMENT_DOOR = {
  ...READS_THE_LABEL_DOOR,
  EVENT_ISSUE_PULL_REQUEST: "${{ github.event.issue.pull_request.url }}",
  EVENT_COMMENT_USER_TYPE: "${{ github.event.comment.user.type }}",
  EVENT_COMMENT_ASSOCIATION: "${{ github.event.comment.author_association }}",
};
const READS_THE_RUN_ENDING: Readonly<Record<string, string>> = {
  EVENT_ACTION: "${{ github.event.action }}",
  IMMUTABILITY_RESULT: "${{ needs.immutability.result }}",
  VERIFY_RESULT: "${{ needs.verify.result }}",
  PR: "${{ github.event.client_payload.pr }}",
};
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
        ungated: true,
        runs: tsx("shape/shape.ts"),
        checkout: "pair",
        env: {
          IDEA_NUMBER: true,
          CHANGE_REQUEST: "${{ github.event.comment.body }}",
          CLAUDE_CODE_OAUTH_TOKEN: true,
          ...READS_THE_COMMENT_DOOR,
        },
        steps: [
          { name: "Mark the idea running", absent: true },
          { name: "Ensure the lane's labels exist", absent: true },
          ...CHECKPOINTS("shape", "Shape", "Shape"),
          HANDS_OVER_ON_RED("idea", "IDEA_NUMBER"),
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
        ungated: true,
        runs: tsx("shape/run-accept.ts"),
        checkout: "pair",
        env: { IDEA_NUMBER: true, VERB: "${{ github.event.label.name }}", EVENT_SENDER: READS_THE_EVENT.EVENT_SENDER },
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
        ungated: true,
        runs: tsx("spec/spec.ts"),
        checkout: "pair",
        env: {
          ISSUE_NUMBER: "${{ github.event.issue.number || github.event.client_payload.issue }}",
          SPEC_TRIGGER: `\${{ (${onLabel(LANE_OWNED.prd)} && 'critique') || 'to-spec' }}`,
          CLAUDE_CODE_OAUTH_TOKEN: true,
          ...READS_THE_LABEL_DOOR,
        },
        steps: [
          { name: "Mark the source running", absent: true },
          { name: "Export the dispatch handoff path", run: [`${DISPATCH_REQUESTS_PATH_ENV}=$RUNNER_TEMP/dispatch-requests.jsonl`] },
          HANDS_OVER_ON_RED("source", "ISSUE_NUMBER"),
        ],
      },
      dispatch: {
        needs: ["spec"],
        gate: { is: "always()" },
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
        ungated: true,
        runs: `${tsx("to-tickets/to-tickets.ts")} --stage seam-sweep`,
        checkout: "pair",
        env: { PRD_NUMBER: "${{ github.event.client_payload.issue }}", CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          { name: "Ensure slice-failed label exists", absent: true },
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
          { name: "Lift slice-failed, the PRD is split now", follows: "Audit and publish", run: ['gh issue edit "$PRD_NUMBER" --remove-label slice-failed'] },
          {
            name: "Report failure",
            if: "always()",
            runLacks: ["refused-raw-response"],
          },
          HANDS_OVER_ON_RED("PRD", "PRD_NUMBER"),
          { name: "Upload the refused raw response", absent: true },
        ],
      },
      dispatch: {
        needs: ["to-tickets"],
        gate: { is: "always()" },
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
      runName: "Acceptance #${{ github.event.client_payload.issue || github.event.issue.number }}",
      on: { issues: ["edited"], repository_dispatch: [ACCEPTANCE_WANTED_DISPATCH_ACTION] },
      permissions: { contents: "write", issues: "write", actions: "read" },
    },
    permissions: { contents: "read", issues: "write" },
    concurrency: "acceptance-${{ github.event.issue.number || github.event.client_payload.issue }}",
    jobs: {
      refire: {
        ungated: true,
        runs: `${tsx("acceptance/acceptance.ts")} --refire`,
        checkout: "pair",
        env: { ACCEPTANCE_LANDING: "commit", ...READS_THE_DISPATCH_DOOR },
        steps: [INSTALLS_TARGET, { id: "bundle", uses: ACCEPTANCE_BUNDLE_ACTION }],
      },
      author: {
        ungated: true,
        runs: `${tsx("acceptance/acceptance.ts")} "$TICKET_NUMBER"`,
        checkout: "pair",
        env: { ACCEPTANCE_LANDING: "commit", ...READS_THE_DISPATCH_DOOR },
        steps: [
          INSTALLS_TARGET,
          { name: "Author acceptance tests for the published slice", runLacks: ["--refire"] },
          { id: "bundle", uses: ACCEPTANCE_BUNDLE_ACTION },
          HANDS_OVER_ON_RED("ticket", "TICKET_NUMBER"),
        ],
      },
      land: {
        needs: ["refire", "author"],
        gate: { is: "always()" },
        permissions: { contents: "write", issues: "write", actions: "read" },
        runs: tsx("acceptance/land.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: {
          REFIRE_RESULT: "${{ needs.refire.result }}",
          REFIRE_AUTHORED: "${{ needs.refire.outputs.authored }}",
          AUTHOR_RESULT: "${{ needs.author.result }}",
          AUTHOR_AUTHORED: "${{ needs.author.outputs.authored }}",
          EVENT_ACTION: "${{ github.event.action }}",
          READY: "${{ github.event.client_payload.ready }}",
          REFIRED: "${{ github.event.client_payload.refire }}",
        },
        steps: [INSTALLS_TARGET, { name: "Land whatever the authoring jobs authored", run: [tsx("acceptance/land.ts")] }],
      },
      "wake-reconciler": WAKES_RECONCILER_JOB,
    },
  },

  implement: {
    caller: {
      name: "Implement",
      runName: ticketRunName("Implement"),
      on: { repository_dispatch: [TICKET_READY_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    },
    permissions: { contents: "write", "pull-requests": "write", issues: "write" },
    concurrency: "implement-${{ github.event.client_payload.issue }}",
    jobs: {
      implement: {
        ungated: true,
        timeout: CLAIM_TIMEOUT_MINUTES,
        runs: tsx("implement/implement.ts"),
        checkout: "pair",
        env: { TICKET_NUMBER: "${{ github.event.client_payload.issue }}", CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          INSTALLS_TARGET,
          {
            name: "Implement the ticket",
            env: { RUNG: "${{ github.event.client_payload.rung }}" },
            run: ['echo "implementing #$TICKET_NUMBER"'],
          },
          { name: "Tell Recover this run failed", absent: true },
          HANDS_OVER_ON_RED("ticket", "TICKET_NUMBER"),
          WAKES_RECONCILER,
        ],
      },
    },
    source: { lacks: ["implementation-pr-opened", "implement-failed", "upload-artifact"] },
  },

  mechanic: {
    caller: {
      name: "Mechanic",
      runName: ticketRunName("Mechanic"),
      on: { repository_dispatch: [MECHANIC_WANTED_DISPATCH_ACTION] },
      permissions: ACTS_ON_PULL_REQUEST,
    },
    permissions: ACTS_ON_PULL_REQUEST,
    concurrency: "implement-${{ github.event.client_payload.issue }}",
    jobs: {
      mechanic: {
        ungated: true,
        timeout: CLAIM_TIMEOUT_MINUTES,
        runs: `${tsx("mechanic/mechanic.ts")} "$TICKET_NUMBER"`,
        checkout: "pair",
        env: { TICKET_NUMBER: "${{ github.event.client_payload.issue }}", CLAUDE_CODE_OAUTH_TOKEN: true },
        steps: [
          INSTALLS_TARGET,
          { name: "Repair the ticket's cause", run: ['echo "mechanic on #$TICKET_NUMBER"'] },
          HANDS_OVER_ON_RED("ticket", "TICKET_NUMBER"),
          WAKES_RECONCILER,
        ],
      },
    },
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
    concurrency: "verify-${{ github.event.client_payload.pr || github.sha }}",
    jobs: {
      immutability: {
        name: LANE_OWNED.immutabilityJob,
        ungated: true,
        runs: tsx("integrate/immutability.ts"),
        checkout: "machine",
        permissions: null,
        secrets: false,
        env: { EVENT_ACTION: "${{ github.event.action }}", CHANGED_FILES: true, PR: true },
        steps: [{ name: "Refuse a change to the immutable set", run: [tsx("integrate/immutability.ts")] }],
      },
      verify: {
        name: LANE_OWNED.gateJob,
        needs: ["immutability"],
        gate: { is: "always()" },
        permissions: null,
        runs: tsx("integrate/gate.ts"),
        checkout: "pair",
        env: { IMMUTABILITY_RESULT: "${{ needs.immutability.result }}" },
        steps: [{ name: LANE_OWNED.gateStep, run: [tsx("integrate/gate.ts")] }],
      },
      "signal-fixer": {
        needs: ["immutability", "verify"],
        gate: { is: "always()" },
        permissions: { contents: "write" },
        runs: tsx("integrate/signal.ts"),
        checkout: "machine",
        env: { SIGNAL: "fixer", ...READS_THE_RUN_ENDING },
        steps: [{ name: "Tell the Fixer this run went red", run: [tsx("integrate/signal.ts")] }],
      },
      "signal-review": {
        needs: ["immutability", "verify"],
        gate: { is: "always()" },
        permissions: { contents: "write", "pull-requests": "read" },
        runs: tsx("integrate/signal.ts"),
        checkout: "machine",
        timeout: 5,
        env: { SIGNAL: "review", ...READS_THE_RUN_ENDING },
        steps: [
          {
            name: "Tell Review this run went green, naming the commits it judged",
            run: [tsx("integrate/signal.ts")],
          },
        ],
      },
    },
    source: { lacks: ["implementation-pr-opened", "continue-on-error"] },
  },

  integrate: {
    caller: {
      name: "Integrate",
      on: { repository_dispatch: [IMPLEMENTATION_PR_DISPATCH_ACTION] },
      permissions: { contents: "write", issues: "write", "pull-requests": "write", actions: "write" },
      with: NAMES_VERIFY_CALLER,
    },
    inputs: VERIFY_FILE_INPUT,
    permissions: { contents: "write", issues: "write", "pull-requests": "write", actions: "write" },
    concurrency: "integrate",
    jobs: {
      integrate: {
        ungated: true,
        runs: `${tsx("integrate/integrate.ts")} "$PR" "$HEAD_SHA"`,
        checkout: { pair: true, fetchDepth: 0 },
        env: { HEAD_SHA: "${{ github.sha }}", VERIFY_WORKFLOW: "${{ inputs.verify_workflow }}", SIGNAL_ASSIGNEE: true },
        steps: [INSTALLS_TARGET],
      },
    },
    source: { lacks: ["implementation-pr-opened"] },
  },

  fixer: {
    caller: deadRunCaller("Fixer", DEAD_RUN_WIRES.fixerNeeded),
    inputs: { run_id: { required: false, default: "" } },
    permissions: ACTS_ON_PULL_REQUEST,
    concurrency: "fixer-${{ inputs.run_id || github.run_id }}",
    jobs: {
      fixer: {
        ungated: true,
        runs: `${tsx("fixer/fixer.ts")} react`,
        checkout: { pair: true, fetchDepth: 0 },
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
      on: { repository_dispatch: [REVIEW_WANTED] },
      permissions: { contents: "read", issues: "write" },
      with: { head_sha: "${{ github.event.client_payload.head_sha }}", base_sha: "${{ github.event.client_payload.base_sha }}" },
    },
    inputs: { head_sha: { required: true }, base_sha: { required: true } },
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

  "dispatch-reconcile": {
    caller: {
      name: "Dispatch reconcile",
      on: {
        repository_dispatch: [LANE_OWNED.sessionCaptured, GRAPH_CHANGED_DISPATCH_ACTION, RUN_ENDED],
        issues: ["labeled", "unlabeled"],
        workflow_run: { workflows: [...ENDING_LANES], types: ["completed"] },
        push: { branches: ["main"] },
        workflow_dispatch: true,
      },
      permissions: { contents: "write", issues: "write", actions: "read", "pull-requests": "read" },
      with: NAMES_VERIFY_CALLER,
    },
    inputs: VERIFY_FILE_INPUT,
    permissions: { contents: "write", issues: "write", actions: "read", "pull-requests": "read" },
    concurrency: "dispatch-reconcile",
    jobs: {
      reconcile: {
        gate: { is: "always()" },
        runs: tsx("dispatch/reconcile.ts"),
        checkout: "pair",
        env: {
          EVENT_ACTION: [
            "${{ (github.event_name == 'repository_dispatch' && github.event.action)",
            `|| (github.event_name == 'workflow_run' && '${RUN_ENDED}')`,
            `|| (github.event_name == 'push' && '${MAIN_MOVED}')`,
            `|| (github.event_name == 'issues' && github.event.action == 'unlabeled' && '${GRAPH_CHANGED_DISPATCH_ACTION}')`,
            `|| '${LANE_OWNED.sessionCaptured}' }}`,
          ].join(" "),
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
        ungated: true,
        runs: tsx("observations/run-audit.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: { HEAD_SHA: true, EVENT_ACTION: true, CLAUDE_CODE_OAUTH_TOKEN: true, KNOWLEDGE_BASE_DEPLOY_KEY: true },
        steps: [{ name: "Checkout Knowledge-Base", with: { repository: "collod873/Knowledge-Base", path: `target/${LANE_OWNED.knowledgeBaseDir}` } }],
      },
    },
    source: { lacks: [NEEDS_HUMAN_LABEL] },
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
        ungated: true,
        runs: tsx("ratify/run-ratify.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: { HEAD_SHA: true, PRD_CLOSED: true, EVENT_ACTION: true, PR_BASE: true, CLAUDE_CODE_OAUTH_TOKEN: true },
      },
    },
    source: { lacks: [NEEDS_HUMAN_LABEL] },
  },

  "ratify-on-prd-close": {
    caller: { name: "Ratify on PRD close", on: { issues: ["closed"] }, permissions: { contents: "write", issues: "read" } },
    permissions: { contents: "write", issues: "read" },
    concurrency: "ratify-on-prd-close-${{ github.event.issue.number }}",
    jobs: {
      "ratify-on-prd-close": {
        ungated: true,
        runs: tsx("ratify/prd-close.ts"),
        checkout: { pair: true, workspace: false },
        env: { ISSUE_NUMBER: true, STATE_REASON: true, LABELS: true },
      },
    },
  },

  "ratify-release": {
    caller: {
      name: "Ratify release",
      on: { repository_dispatch: [RATIFIER_MERGED_DISPATCH_ACTION] },
      permissions: { contents: "write", "pull-requests": "read" },
    },
    permissions: { contents: "write", "pull-requests": "read" },
    jobs: {
      "ratify-release": {
        ungated: true,
        runs: tsx("observations/run-ratification.ts"),
        checkout: { pair: true, fetchDepth: 0 },
        env: { PR: "${{ github.event.client_payload.pr }}" },
      },
    },
    source: { lacks: [NEEDS_HUMAN_LABEL] },
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
    source: { lacks: [NEEDS_HUMAN_LABEL] },
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
        ungated: true,
        runs: tsx("watchdog/run-watchdog.ts"),
        checkout: { pair: true, workspace: false },
        env: { EVENT_ACTION: true, SIGNAL_ASSIGNEE: true },
      },
    },
    source: { lacks: [NEEDS_HUMAN_LABEL, "schedule:"] },
  },

  "bypass-counter": {
    caller: {
      name: "Bypass counter",
      on: VERIFY_COMPLETED,
      permissions: { contents: "read", actions: "read", issues: "write" },
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
    source: { lacks: [NEEDS_HUMAN_LABEL, "schedule:"] },
  },

  "lost-dispatch-counter": {
    caller: {
      name: "Lost-dispatch counter",
      on: { issues: ["labeled"] },
      permissions: { contents: "read", actions: "read", issues: "write" },
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
    source: { lacks: [NEEDS_HUMAN_LABEL, "schedule:"] },
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
    source: { lacks: [NEEDS_HUMAN_LABEL] },
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
        ungated: true,
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
