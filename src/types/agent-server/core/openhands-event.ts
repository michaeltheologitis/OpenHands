// Import all event types
import {
  ACPSessionMessageEvent,
  ACPSessionTextEvent,
  ACPSubagentEvent,
  ACPToolCallEvent,
  ActionEvent,
  MessageEvent,
  ObservationEvent,
  UserRejectObservation,
  AgentErrorEvent,
  SystemPromptEvent,
  CondensationEvent,
  CondensationRequestEvent,
  CondensationSummaryEvent,
  ConversationStateUpdateEvent,
  ConversationErrorEvent,
  HookExecutionEvent,
  PauseEvent,
  ServerErrorEvent,
  StreamingDeltaEvent,
} from "./events/index";

/**
 * Union type representing all possible OpenHands events.
 * This includes all main event types that can occur in the system.
 */
export type OpenHandsEvent =
  // Core action and observation events
  | ActionEvent
  | MessageEvent
  | ObservationEvent
  | UserRejectObservation
  | AgentErrorEvent
  | SystemPromptEvent
  // ACP sub-agent tool call events
  | ACPToolCallEvent
  // ACP sub-agent sessions: associations, directed messages, a child's text
  | ACPSubagentEvent
  | ACPSessionMessageEvent
  | ACPSessionTextEvent
  // Hook events
  | HookExecutionEvent
  // Conversation management events
  | CondensationEvent
  | CondensationRequestEvent
  | CondensationSummaryEvent
  | ConversationStateUpdateEvent
  | ConversationErrorEvent
  // Control events
  | PauseEvent
  | ServerErrorEvent
  | StreamingDeltaEvent;
