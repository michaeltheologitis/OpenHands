import type { ACPToolCallEvent } from "#/types/agent-server/core/events/acp-tool-call-event";
import type {
  ACPSessionMessageEvent,
  ACPSessionTextEvent,
  ACPSubagentEvent,
} from "#/types/agent-server/core/events/acp-subagent-event";

/**
 * Builders for the events the agent-server stores for ACP sub-agent sessions,
 * field for field, so a test reads like a run: `call(1, "c1")` is the root's
 * spawning cell at tick 1, `child(2, "n2", { cell: "c1" })` announces a child
 * in it, and so on. Fields the agent-server leaves unset are absent, as its
 * `exclude_none` storage leaves them.
 */

/** The root's real ACP session id, as directed messages name it. */
export const ROOT_ACP_SESSION_ID = "s-root";

/** An ISO timestamp, increasing with `tick`, in the agent-server's format. */
export const at = (tick: number) =>
  `2026-10-02T14:00:00.${String(tick).padStart(6, "0")}`;

let sequence = 0;
const nextId = () => {
  sequence += 1;
  return `event-${sequence}`;
};

interface CallOptions {
  /** The child session the call ran in; absent for the root. */
  session?: string;
  status?: ACPToolCallEvent["status"];
  title?: string;
  id?: string;
}

/** An ACPToolCallEvent; started (`in_progress`) unless a status is given. */
export const call = (
  tick: number,
  toolCallId: string,
  { session, status = "in_progress", title, id }: CallOptions = {},
): ACPToolCallEvent => ({
  kind: "ACPToolCallEvent",
  id: id ?? nextId(),
  timestamp: at(tick),
  source: "agent",
  tool_call_id: toolCallId,
  title: title ?? `Run ${toolCallId}`,
  status,
  tool_kind: "execute",
  raw_input: null,
  raw_output: null,
  content: null,
  is_error: false,
  ...(session === undefined ? {} : { acp_session_id: session }),
});

interface ChildOptions {
  /** The parent session; absent for the root. */
  parent?: string;
  /** The parent's spawning tool call. */
  cell?: string;
  title?: string;
  description?: string;
  state?: string | null;
  stopReason?: string;
  cancellable?: boolean;
  cost?: number;
  currency?: string;
  source?: ACPSubagentEvent["source"];
}

/** An ACPSubagentEvent: an announcement, or a later snapshot of the child. */
export const child = (
  tick: number,
  sessionId: string,
  {
    parent,
    cell,
    title,
    description,
    state = "running",
    stopReason,
    cancellable = false,
    cost,
    currency = "USD",
    source = "agent",
  }: ChildOptions = {},
): ACPSubagentEvent => ({
  kind: "ACPSubagentEvent",
  id: nextId(),
  timestamp: at(tick),
  source,
  acp_session_id: sessionId,
  ...(parent === undefined ? {} : { parent_session_id: parent }),
  ...(cell === undefined ? {} : { parent_tool_call_id: cell }),
  title: title ?? `Task ${sessionId}`,
  ...(description === undefined ? {} : { description }),
  state,
  ...(stopReason === undefined ? {} : { stop_reason: stopReason }),
  cancellable,
  ...(cost === undefined ? {} : { cost, cost_currency: currency }),
});

/** The agent-server's reconnect snapshot: state unconfirmed, cancel withdrawn. */
export const reconnect = (
  tick: number,
  sessionId: string,
  options: Omit<ChildOptions, "state" | "source" | "cancellable"> = {},
): ACPSubagentEvent =>
  child(tick, sessionId, {
    ...options,
    state: null,
    source: "environment",
    cancellable: false,
  });

interface MessageOptions {
  /** The transcript the message is stored in; absent for the root's. */
  transcript?: string;
  from: string;
  to: string;
  text: string;
}

/** An ACPSessionMessageEvent; ids name sessions verbatim (the root's real id). */
export const message = (
  tick: number,
  messageId: string,
  { transcript, from, to, text }: MessageOptions,
): ACPSessionMessageEvent => ({
  kind: "ACPSessionMessageEvent",
  id: nextId(),
  timestamp: at(tick),
  source: "agent",
  ...(transcript === undefined ? {} : { acp_session_id: transcript }),
  message_id: messageId,
  sender_session_id: from,
  recipient_session_id: to,
  text,
});

/** An ACPSessionTextEvent: one run of a child's own text or reasoning. */
export const text = (
  tick: number,
  sessionId: string,
  content: string,
  { thought = false }: { thought?: boolean } = {},
): ACPSessionTextEvent => ({
  kind: "ACPSessionTextEvent",
  id: nextId(),
  timestamp: at(tick),
  source: "agent",
  acp_session_id: sessionId,
  thought,
  text: content,
});
