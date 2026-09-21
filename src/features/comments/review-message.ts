import { escapePromptXmlAttribute } from "../../utils/promptXml";

/**
 * Builds the review request sent to the AIs.
 *
 * The file is named explicitly because each chat tab carries its own Linked
 * content, and a tab bound to a durable Conversation has that locked. Without
 * the path, an AI reviews whatever file its own tab points at and reports
 * nothing to do for a comment added somewhere else.
 */
export function buildReviewMessage(prompt: string, filePath: string | null): string {
  const text = prompt.trim();
  if (!filePath) return text;
  return [
    text,
    "",
    `<review_target path="${escapePromptXmlAttribute(filePath)}" />`,
    "",
    "Review the comments in that file, whichever file this conversation is"
      + " otherwise linked to.",
  ].join("\n");
}
