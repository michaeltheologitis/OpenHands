import { BaseEvent } from "../base/event";

/**
 * ACPSubagentEvent — an ACP sub-agent session's association with its parent,
 * as the agent-server last stored it (ACP schema 1.24.1, unstable). Each event
 * is the whole association with ACP's patch rules already applied, so the
 * newest event per `acp_session_id` is the child's current state.
 */
export interface ACPSubagentEvent extends BaseEvent {
  kind: "ACPSubagentEvent";

  /**
   * `"environment"` marks the agent-server's own record that the ACP
   * connection the last state came from has ended: state unconfirmed, cancel
   * withdrawn.
   */
  source: "agent" | "environment";

  /** The child's ACP session id. */
  acp_session_id: string;

  /** The parent's ACP session id; absent or null for the root session. */
  parent_session_id?: string | null;

  /**
   * The parent's tool call that spawned the child, from
   * `_meta.openhands.parentToolCallId`. Unique only within the parent session.
   */
  parent_tool_call_id?: string | null;

  title?: string | null;

  description?: string | null;

  /**
   * `running`, `idle`, `requires_action`, `unknown`, an agent-specific value
   * (shown as it is), or null: no confirmed current activity.
   */
  state?: string | null;

  /** ACP's stop reason when `state` is `idle`. */
  stop_reason?: string | null;

  /** The agent granted `cancel` for this child on the live connection. */
  cancellable?: boolean;

  /** The child's latest reported cumulative cost; never add it to another. */
  cost?: number | null;

  cost_currency?: string | null;

  /** The association's ACP `_meta`. Opaque: Canvas never reads it. */
  meta?: Record<string, unknown> | null;
}

/**
 * ACPSessionMessageEvent — a message between ACP sessions, as one session's
 * transcript shows it. Upserts: the newest per `(acp_session_id, message_id)`
 * is current.
 */
export interface ACPSessionMessageEvent extends BaseEvent {
  kind: "ACPSessionMessageEvent";

  source: "agent";

  /** The transcript the message belongs to; absent or null for the root. */
  acp_session_id?: string | null;

  message_id: string;

  /** Verbatim ACP session id: the root's real id, never null for the root. */
  sender_session_id?: string | null;

  /** Verbatim ACP session id: the root's real id, never null for the root. */
  recipient_session_id?: string | null;

  text?: string;

  /** The message's ACP `_meta`. Opaque: Canvas never reads it. */
  meta?: Record<string, unknown> | null;
}

/**
 * ACPSessionTextEvent — one run of a child session's own streamed text or
 * reasoning. Append-only, in log order.
 */
export interface ACPSessionTextEvent extends BaseEvent {
  kind: "ACPSessionTextEvent";

  source: "agent";

  /** Always a child session. */
  acp_session_id: string;

  /** True for reasoning (`agent_thought_chunk`), false for the child's text. */
  thought?: boolean;

  text: string;
}
