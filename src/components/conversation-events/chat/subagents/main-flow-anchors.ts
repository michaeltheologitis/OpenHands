import type { OpenHandsEvent } from "#/types/agent-server/core";
import type { SubagentAnchor } from "#/utils/subagents/subagent-index";
import { compareTimestamps } from "#/utils/subagents/subagent-keys";
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

/** When an item starts: its first event's timestamp, unless told otherwise. */
export type ItemStart = (event: OpenHandsEvent) => string | undefined;

const timestampOf: ItemStart = (event) => event.timestamp;

/**
 * Put each anchored root-level child before the first rendered item that
 * starts after its anchor; items keep their order. Returns `items` itself
 * when `anchors` is empty.
 */
export function interleaveSubagentAnchors(
  items: readonly RenderedItem[],
  anchors: readonly SubagentAnchor[],
  startOf: ItemStart = timestampOf,
): readonly MainFlowItem[] {
  if (anchors.length === 0) return items;
  const flow: MainFlowItem[] = [];
  let next = 0;
  for (const item of items) {
    const start = startOf(firstEventOf(item));
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
