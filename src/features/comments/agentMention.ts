/**
 * Finds the AI a comment is addressed to, as in "@gpt run your changes".
 *
 * A mention routes the request to that one AI instead of every enabled one, so
 * matching is deliberately strict: the name must follow an `@` that starts a
 * word, and must not run into a longer word. That keeps an email address or an
 * ordinary mention of a name from silently redirecting a comment.
 */
export function findAgentMention(text: string, agentNames: readonly string[]): string | null {
  let found: { index: number; name: string } | null = null;
  for (const name of agentNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // (^|\s) keeps `grant@gpt.com` from matching; \b stops `@gpteroids`.
    const pattern = new RegExp(`(?:^|\\s)@${escaped}\\b`, 'i');
    const match = pattern.exec(text);
    if (!match) continue;
    if (!found || match.index < found.index) {
      found = { index: match.index, name };
    }
  }
  return found?.name ?? null;
}

/**
 * Which AI a reply is addressed to. A standing choice spares the reader from
 * typing "@gpt" on every comment; an explicit tag still wins, so one reply can
 * be redirected without disturbing the choice. Null means every enabled AI.
 *
 * A choice that no longer names an enabled AI broadcasts rather than silently
 * addressing nobody: the setting outlives the provider it named.
 */
export function resolveReplyTarget(
  text: string,
  agentNames: readonly string[],
  preferred: string
): string | null {
  const mentioned = findAgentMention(text, agentNames);
  if (mentioned) return mentioned;
  const wanted = preferred.trim().toLowerCase();
  if (!wanted) return null;
  return agentNames.find((name) => name.toLowerCase() === wanted) ?? null;
}
