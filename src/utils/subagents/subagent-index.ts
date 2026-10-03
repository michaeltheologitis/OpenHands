/** The root session in every key below. S1 stores the root as null. */
export const ROOT_SESSION = "";

/** A child's ACP session id, or `ROOT_SESSION`. */
export type SessionRef = string;

// No ACP id contains a NUL, so joined keys never collide across sessions.
const KEY_SEPARATOR = "\u0000";

export function toSessionRef(sessionId: string | null | undefined): SessionRef {
  return sessionId ?? ROOT_SESSION;
}

/** ACP tool-call ids are unique only within a session, so keys pair them. */
export function toolCallKey(
  sessionId: string | null | undefined,
  toolCallId: string,
): string {
  return toSessionRef(sessionId) + KEY_SEPARATOR + toolCallId;
}

/** ACP message ids are unique only within a transcript. */
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
