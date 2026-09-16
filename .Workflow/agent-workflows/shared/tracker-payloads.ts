export interface Adr0106Payloads {
  workflowRun: {
    id: number;
    conclusion: string | null;
    html_url: string;
    head_branch: string | null;
    created_at: string;
    event: string;
  };
  job: {
    steps: Array<{ name: string; conclusion: string | null }>;
  };
}

export function adr0106Payloads(): Adr0106Payloads {
  throw new Error("#608: not built");
}
