import { isOwner, commaList } from "../shared/event-door";
import { PRD_LABEL } from "../shared/labels";
import { ACCEPTANCE_WANTED_DISPATCH_ACTION } from "../shared/ready-set";

export { PRD_LABEL };

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
    issueLabels: commaList(values.labels),
    senderIsOwner: isOwner(values.sender, values.owner),
  };
}

export function refiresAffectedSlices(edit: IssueEdit): boolean {
  return edit.eventName === "issues" && edit.senderIsOwner && edit.issueLabels.includes(PRD_LABEL);
}

export function authorsPublishedSlice(eventAction: string): boolean {
  return eventAction === ACCEPTANCE_WANTED_DISPATCH_ACTION;
}
