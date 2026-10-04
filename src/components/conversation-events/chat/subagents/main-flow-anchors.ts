import type { OpenHandsEvent } from "#/types/agent-server/core";
import { isACPToolCallEvent } from "#/types/agent-server/type-guards";
import type {
  SubagentAnchor,
  SubagentRecords,
} from "#/utils/subagents/subagent-index";
import {
  compareTimestamps,
  toolCallKey,
} from "#/utils/subagents/subagent-keys";
import type { RenderedItem } from "../group-events";

export type MainFlowItem =
  | RenderedItem
  | {
      kind: "subagent";
      anchor: SubagentAnchor;
    };

const firstEventOf = (item: RenderedItem): OpenHandsEvent => {
  if (item.kind === "single") return item.event;
  if (item.kind === "thought") return item.action;
  return item.events[0];
};

/**
 * An item's first event's time. An ACP call's item holds its terminal event,
 * so a call starts at its record's `firstAt`.
 */
const startOf = (
  item: RenderedItem,
  toolCalls: SubagentRecords["toolCalls"],
): string | undefined => {
  const event = firstEventOf(item);
  if (!isACPToolCallEvent(event)) return event.timestamp;
  const key = toolCallKey(event.acp_session_id, event.tool_call_id);
  return toolCalls.get(key)?.firstAt ?? event.timestamp;
};

/**
 * Put each anchored root-level child before the first rendered item that
 * starts after its anchor; items keep their order. Returns `items` itself
 * when `anchors` is empty.
 */
export function interleaveSubagentAnchors(
  items: readonly RenderedItem[],
  anchors: readonly SubagentAnchor[],
  toolCalls: SubagentRecords["toolCalls"],
): readonly MainFlowItem[] {
  if (anchors.length === 0) return items;
  const flow: MainFlowItem[] = [];
  let next = 0;
  for (const item of items) {
    const start = startOf(item, toolCalls);
    while (
      start !== undefined &&
      next < anchors.length &&
      compareTimestamps(anchors[next].at, start) < 0
    ) {
      flow.push({ kind: "subagent", anchor: anchors[next] });
      next += 1;
    }
    flow.push(item);
  }
  anchors
    .slice(next)
    .forEach((anchor) => flow.push({ kind: "subagent", anchor }));
  return flow;
}
