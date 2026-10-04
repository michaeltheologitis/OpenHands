import type { ACPToolCallEvent } from "#/types/agent-server/core/events/acp-tool-call-event";
import { toolCallKey } from "#/utils/subagents/subagent-keys";
import { GenericEventMessageWrapper } from "../event-message-components/generic-event-message-wrapper";
import { SubagentBlock } from "./subagent-block";

export interface AcpToolCallCellProps {
  /** A root or child ACP tool call; its sub-agents are found by its key. */
  event: ACPToolCallEvent;
  /** Nesting depth of the session the call belongs to; the root is 0. */
  depth: number;
}

/** Today's ACP card, plus the sub-agents the call spawned. */
export function AcpToolCallCell({ event, depth }: AcpToolCallCellProps) {
  return (
    <div
      data-testid="acp-tool-call"
      data-acp-tool-call-id={event.tool_call_id}
      data-acp-session-id={event.acp_session_id ?? undefined}
      data-acp-tool-call-status={event.status ?? undefined}
    >
      <GenericEventMessageWrapper event={event} isLastMessage={false} />
      <SubagentBlock
        cellKey={toolCallKey(event.acp_session_id, event.tool_call_id)}
        depth={depth + 1}
      />
    </div>
  );
}
