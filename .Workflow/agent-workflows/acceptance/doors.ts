import { ACCEPTANCE_WANTED_DISPATCH_ACTION } from "../shared/ready-set";

export const PRD_LABEL = "prd";

export interface IssueEdit {
  eventName: string;
  issueLabels: readonly string[];
  senderIsOwner: boolean;
}

export interface IssueEditValues {
  eventName: string;
  labels: string;
  sender: string;
  owner: string;
}

export function issueEditFrom(values: IssueEditValues): IssueEdit {
  return {
    eventName: values.eventName,
    issueLabels: values.labels
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== ""),
    senderIsOwner: values.sender !== "" && values.sender === values.owner,
  };
}

export function refiresAffectedSlices(edit: IssueEdit): boolean {
  return edit.eventName === "issues" && edit.senderIsOwner && edit.issueLabels.includes(PRD_LABEL);
}

export function authorsPublishedSlice(eventAction: string): boolean {
  return eventAction === ACCEPTANCE_WANTED_DISPATCH_ACTION;
}
