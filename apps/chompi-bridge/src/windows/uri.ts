/** Lowercase canonical UUID, the form Codex thread IDs and Claude Desktop session IDs take. */
export const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const CODEX_THREAD = new RegExp(`^codex://threads/(${UUID_PATTERN})$`);
const CLAUDE_CONTINUE = new RegExp(`^claude://code/continue\\?session=(local_${UUID_PATTERN})$`);

export const THREAD_ID = new RegExp(`^${UUID_PATTERN}$`);
export const LOCAL_ID = new RegExp(`^local_${UUID_PATTERN}$`);

export type DeepLink = { client: 'codex'; threadId: string } | { client: 'claude'; localId: string };

/**
 * Accepts exactly the two qualified links: `codex://threads/<uuid>` and
 * `claude://code/continue?session=local_<uuid>`. Anything else, including other Claude routes that import,
 * unarchive or pick a different session, returns null.
 */
export function parseDeepLink(uri: unknown): DeepLink | null {
  if (typeof uri !== 'string' || uri.length > 128) return null;
  const codex = CODEX_THREAD.exec(uri);
  if (codex) return { client: 'codex', threadId: codex[1]! };
  const claude = CLAUDE_CONTINUE.exec(uri);
  if (claude) return { client: 'claude', localId: claude[1]! };
  return null;
}
