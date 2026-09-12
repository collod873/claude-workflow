import { isOwner, commaList } from "../shared/event-door";
import { IDEA_LABEL } from "../shared/labels";
import { VERBS, type Verb } from "./accept";

export { IDEA_LABEL };

export const SHAPE_COMMENT_ASSOCIATIONS = ["OWNER", "MEMBER", "COLLABORATOR"];

export const BOT_USER_TYPE = "Bot";

export interface ShapeDoor {
  eventName: string;
  label: string;
  senderIsOwner: boolean;
  issueIsPullRequest: boolean;
  issueLabels: readonly string[];
  commentUserType: string;
  commentAuthorAssociation: string;
}

export interface ShapeDoorValues {
  eventName: string;
  label: string;
  sender: string;
  owner: string;
  pullRequestUrl: string;
  labels: string;
  commentUserType: string;
  commentAuthorAssociation: string;
}

export function shapeDoorFrom(values: ShapeDoorValues): ShapeDoor {
  return {
    eventName: values.eventName,
    label: values.label,
    senderIsOwner: isOwner(values.sender, values.owner),
    issueIsPullRequest: values.pullRequestUrl !== "",
    issueLabels: commaList(values.labels),
    commentUserType: values.commentUserType,
    commentAuthorAssociation: values.commentAuthorAssociation,
  };
}

export function shapesIdea(door: ShapeDoor): boolean {
  if (door.eventName === "issues") return door.label === IDEA_LABEL && door.senderIsOwner;
  if (door.eventName !== "issue_comment") return false;
  return (
    !door.issueIsPullRequest &&
    door.issueLabels.includes(IDEA_LABEL) &&
    door.commentUserType !== BOT_USER_TYPE &&
    SHAPE_COMMENT_ASSOCIATIONS.includes(door.commentAuthorAssociation)
  );
}

export function isVerb(value: string | undefined): value is Verb {
  return value !== undefined && (VERBS as readonly string[]).includes(value);
}

export function acceptsShapedIdea(values: { label: string; sender: string; owner: string }): boolean {
  return isOwner(values.sender, values.owner) && isVerb(values.label);
}
