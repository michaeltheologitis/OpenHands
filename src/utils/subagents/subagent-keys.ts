/**
 * How ACP sessions, tool calls and messages are identified and ordered. ACP
 * ids are unique only within a session, so each key pairs an id with its
 * session, and the root session is `ROOT_SESSION`.
 */

/** The root session in every key. The agent-server stores the root as null. */
export const ROOT_SESSION = "";

/** A child's ACP session id, or `ROOT_SESSION`. */
export type SessionRef = string;

// No ACP id contains a NUL, so joined keys never collide across sessions.
const KEY_SEPARATOR = "\u0000";

export function toSessionRef(sessionId: string | null | undefined): SessionRef {
  return sessionId ?? ROOT_SESSION;
}

/** A tool call: the session it ran in, and its id. */
export function toolCallKey(
  sessionId: string | null | undefined,
  toolCallId: string,
): string {
  return toSessionRef(sessionId) + KEY_SEPARATOR + toolCallId;
}

/** A message: the transcript it is stored in, and its id. */
export function messageKey(
  transcriptSessionId: string | null | undefined,
  messageId: string,
): string {
  return toSessionRef(transcriptSessionId) + KEY_SEPARATOR + messageId;
}

/** The first message a transcript addressed to a recipient: its task. */
export function routeKey(
  transcriptSessionId: string | null | undefined,
  recipientSessionId: string,
): string {
  return toSessionRef(transcriptSessionId) + KEY_SEPARATOR + recipientSessionId;
}

/** ISO timestamps in one format order as strings; never by locale. */
export const compareTimestamps = (a: string, b: string): number => {
  if (a === b) return 0;
  return a < b ? -1 : 1;
};
