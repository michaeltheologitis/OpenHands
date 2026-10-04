import { describe, expect, it } from "vitest";
import type { ACPSubagentEvent } from "#/types/agent-server/core/events/acp-subagent-event";
import type { SubagentRecord } from "#/utils/subagents/subagent-index";
import {
  getSubagentStatus,
  summarizeSubagents,
} from "#/utils/subagents/subagent-status";
import { child, reconnect } from "../../helpers/subagent-events";

const recordOf = (
  latest: ACPSubagentEvent,
  lastConfirmed: ACPSubagentEvent | null = latest.source === "agent"
    ? latest
    : null,
): SubagentRecord => ({ latest, lastConfirmed, firstAt: latest.timestamp });

const snapshot = (state: string | null, stopReason?: string) =>
  child(1, "n2", { state, stopReason });

// @spec SUB-005 — Each sub-agent shows its latest state; an unconfirmed state never shows a spinner
describe("getSubagentStatus", () => {
  it.each([
    ["running", undefined, "running"],
    ["requires_action", undefined, "waiting"],
    ["idle", "end_turn", "done"],
    ["idle", undefined, "done"],
    ["idle", "cancelled", "stopped"],
    ["idle", "max_tokens", "limited"],
    ["idle", "max_turn_requests", "limited"],
    ["idle", "refusal", "refused"],
    ["idle", "something_new", "other"],
    ["unknown", undefined, "other"],
    ["thinking_hard", undefined, "other"],
  ])("reads %s / %s as %s", (state, stopReason, category) => {
    expect(getSubagentStatus(recordOf(snapshot(state, stopReason)))).toEqual({
      category,
      reported: stopReason ? `${state} / ${stopReason}` : state,
      stale: false,
      lastKnown: null,
    });
  });

  it.each([
    [
      "the agent's own snapshot without a state",
      child(1, "n2", { state: null }),
    ],
    [
      "a reconnect snapshot that still carries a state",
      child(1, "n2", { state: "running", source: "environment" }),
    ],
  ])("reads %s as unconfirmed", (_case, latest) => {
    expect(getSubagentStatus(recordOf(latest)).category).toBe("unconfirmed");
  });

  it("reads a reconnect with nothing confirmed loaded as unconfirmed", () => {
    expect(getSubagentStatus(recordOf(reconnect(2, "n2")))).toEqual({
      category: "unconfirmed",
      reported: null,
      stale: false,
      lastKnown: null,
    });
  });

  it.each([
    ["running", undefined, "running"],
    ["requires_action", undefined, "waiting"],
  ])(
    "keeps a last confirmed %s state as the last known one after a reconnect",
    (state, stopReason, lastKnown) => {
      const status = getSubagentStatus(
        recordOf(reconnect(2, "n2"), snapshot(state, stopReason)),
      );

      expect(status).toEqual({
        category: "unconfirmed",
        reported: state,
        stale: true,
        lastKnown,
      });
    },
  );

  it("keeps a last confirmed idle state as history after a reconnect", () => {
    const status = getSubagentStatus(
      recordOf(reconnect(2, "n2"), snapshot("idle", "cancelled")),
    );

    expect(status).toEqual({
      category: "stopped",
      reported: "idle / cancelled",
      stale: true,
      lastKnown: null,
    });
  });
});

describe("summarizeSubagents", () => {
  it("counts children by status category", () => {
    const summary = summarizeSubagents([
      recordOf(snapshot("idle", "end_turn")),
      recordOf(snapshot("running")),
      recordOf(snapshot("idle")),
      recordOf(snapshot("idle", "cancelled")),
      recordOf(reconnect(2, "n2"), snapshot("running")),
      recordOf(snapshot("requires_action")),
      recordOf(snapshot("idle", "refusal")),
      recordOf(snapshot("idle", "max_tokens")),
      recordOf(snapshot("mystery")),
    ]);

    expect(summary).toEqual({
      total: 9,
      done: 2,
      running: 1,
      waiting: 1,
      stopped: 1,
      limited: 1,
      refused: 1,
      unconfirmed: 1,
      other: 1,
    });
  });
});
