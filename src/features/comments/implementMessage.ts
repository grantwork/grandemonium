import { escapePromptXmlAttribute, formatPromptXmlCdata } from "../../utils/promptXml";

/** One entry of a comment's discussion. */
export interface ImplementThreadEntry {
  author: string;
  text: string;
  ts: string;
}

/** The one comment an implementation request is scoped to. */
export interface ImplementTarget {
  /** Key of the entry in the file's tandem-comments block. */
  commentId: string;
  /** Vault-relative path of the note holding the comment. */
  filePath: string;
  /** The anchored passage, so the AI can locate the comment without the id. */
  quote: string;
  /** The AI's own reply being actioned. */
  reply: string;
  /** The whole discussion in order, so the AI acts with its context. */
  thread: readonly ImplementThreadEntry[];
}

function formatThread(thread: readonly ImplementThreadEntry[]): string[] {
  if (thread.length === 0) return [];
  return [
    "  <thread>",
    ...thread.map(entry =>
      `    <entry author="${escapePromptXmlAttribute(entry.author)}"`
      + ` ts="${escapePromptXmlAttribute(entry.ts)}">`
      + `${formatPromptXmlCdata(entry.text)}</entry>`),
    "  </thread>",
  ];
}

/**
 * Builds the message sent to one AI when asked to carry out its own reply.
 *
 * The configured prompt leads, so the user's wording is what the AI reads
 * first. The target block follows because the prompt alone ("implement your
 * suggested changes") does not say which comment, and an AI given a whole file
 * of open comments would otherwise act on all of them.
 */
export function buildImplementMessage(prompt: string, target: ImplementTarget): string {
  return [
    prompt.trim(),
    "",
    `<comment_target path="${escapePromptXmlAttribute(target.filePath)}"`
      + ` id="${escapePromptXmlAttribute(target.commentId)}">`,
    `  <quote>${formatPromptXmlCdata(target.quote)}</quote>`,
    ...formatThread(target.thread),
    `  <your_reply>${formatPromptXmlCdata(target.reply)}</your_reply>`,
    "</comment_target>",
    "",
    "Act on only this comment. Do not review, reply to, resolve, or change any"
      + " other comment in the file.",
  ].join("\n");
}
