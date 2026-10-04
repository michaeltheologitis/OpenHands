import type {
  ACPSessionMessageEvent as ClientACPSessionMessageEvent,
  ACPSessionTextEvent as ClientACPSessionTextEvent,
  ACPSubagentEvent as ClientACPSubagentEvent,
} from "@openhands/typescript-client";
import type { BaseEvent } from "../base/event";

// The agent-server's sub-agent event kinds as the TypeScript client declares
// them, with the id, timestamp and source it always stores.

/**
 * A child session's whole association with its parent; the newest per
 * `acp_session_id` is current. `source: "environment"` is the agent-server's
 * own record that the connection ended: state unconfirmed, cancel withdrawn.
 */
export type ACPSubagentEvent = ClientACPSubagentEvent & BaseEvent;

/** A message between sessions in one transcript; the newest per id is current. */
export type ACPSessionMessageEvent = ClientACPSessionMessageEvent & BaseEvent;

/** One run of a child's own text or reasoning, append-only. */
export type ACPSessionTextEvent = ClientACPSessionTextEvent & BaseEvent;
