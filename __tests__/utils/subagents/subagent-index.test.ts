import { describe, expect, it } from "vitest";
import type { MessageEvent, OpenHandsEvent } from "#/types/agent-server/core";
import {
  buildSubagentIndex,
  EMPTY_SUBAGENT_INDEX,
  foldSubagentEvents,
  messageKey,
  ROOT_SESSION,
  toolCallKey,
  type SubagentIndex,
} from "#/utils/subagents/subagent-index";
import {
  anchorsForParent,
  unplacedGroups,
} from "#/utils/subagents/subagent-placement";
import {
  at,
  call,
  child,
  message,
  reconnect,
  ROOT_ACP_SESSION_ID as ROOT_ID,
  text,
} from "../../helpers/subagent-events";

const fold = (...events: OpenHandsEvent[]) =>
  foldSubagentEvents(EMPTY_SUBAGENT_INDEX, events);

const rootCell = (id: string) => toolCallKey(ROOT_SESSION, id);

/** The transcript as [kind, key or text, at] triples, for readable asserts. */
const transcriptOf = (index: SubagentIndex, sessionId: string) =>
  (index.transcripts.get(sessionId) ?? []).map((item) =>
    item.kind === "text"
      ? [item.kind, item.event.text, item.at]
      : [item.kind, item.key, item.at],
  );

describe("foldSubagentEvents", () => {
  // @spec SUB-001 — Each ACP sub-agent session renders inside the tool call that spawned it, recursively
  it("rebuilds parent links from each child's latest snapshot", () => {
    const index = fold(
      call(1, "c1"),
      child(2, "n2"),
      call(3, "c2", { session: "n2" }),
      child(4, "n3", { parent: "n2", cell: "c2" }),
      call(5, "c3", { session: "n3" }),
      child(6, "n4", { parent: "n3", cell: "c3" }),
      // The spawning call arrives on a later snapshot of n2; S1 keeps it.
      child(7, "n2", { cell: "c1" }),
    );

    expect(index.placement.byCell.get(rootCell("c1"))).toEqual(["n2"]);
    expect(index.placement.byCell.get(toolCallKey("n2", "c2"))).toEqual(["n3"]);
    expect(index.placement.byCell.get(toolCallKey("n3", "c3"))).toEqual(["n4"]);
    expect(index.placement.byAnchor.size).toBe(0);
    expect(index.placement.pending).toEqual([]);
  });

  it("places a child in the tool call that spawned it, in announcement order", () => {
    const index = fold(
      call(1, "c1"),
      child(2, "n3", { cell: "c1" }),
      child(3, "n2", { cell: "c1" }),
      call(4, "c1", { session: "n2" }),
      child(5, "n5", { parent: "n2", cell: "c1" }),
    );

    expect(index.placement.byCell.get(rootCell("c1"))).toEqual(["n3", "n2"]);
    expect(index.placement.byCell.get(toolCallKey("n2", "c1"))).toEqual(["n5"]);
  });

  it("orders a cell's children by announcement when an older page brings an earlier one", () => {
    const newestPage = fold(call(1, "c1"), child(5, "n3", { cell: "c1" }));

    const index = foldSubagentEvents(newestPage, [
      child(2, "n2", { cell: "c1" }),
    ]);

    expect(index.placement.byCell.get(rootCell("c1"))).toEqual(["n2", "n3"]);
  });

  it("keeps tool calls of different sessions with the same id apart", () => {
    const rootDone = call(5, "c1", { status: "completed" });
    const index = fold(
      call(1, "c1"),
      child(2, "n2", { cell: "c1" }),
      call(3, "c1", { session: "n2" }),
      rootDone,
    );

    expect(index.toolCalls.get(rootCell("c1"))?.latest).toBe(rootDone);
    expect(index.toolCalls.get(toolCallKey("n2", "c1"))?.latest.status).toBe(
      "in_progress",
    );
    expect(transcriptOf(index, "n2")).toEqual([
      ["tool_call", toolCallKey("n2", "c1"), at(3)],
    ]);
  });

  it("keeps messages and routes of different transcripts apart", () => {
    const index = fold(
      child(1, "n2"),
      child(2, "n3"),
      message(3, "m1", { transcript: "n3", from: "n3", to: "n2", text: "hi" }),
      message(4, "m1", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "done",
      }),
      message(5, "task", { from: ROOT_ID, to: "n2", text: "Do n2." }),
    );

    expect(index.messages.get(messageKey("n3", "m1"))?.latest.text).toBe("hi");
    expect(index.messages.get(messageKey("n2", "m1"))?.latest.text).toBe(
      "done",
    );
    expect(index.placement.byAnchor.get(ROOT_SESSION)).toContainEqual({
      sessionId: "n2",
      at: at(5),
      via: "message",
    });
    expect(toolCallKey("n", "2c1")).not.toBe(toolCallKey("n2", "c1"));
  });

  // @spec SUB-002 — Without a loaded spawning call, a sub-agent renders at its parent's message to it, else at its announcement
  it("places a child without a spawning call at its parent's message, else at its announcement", () => {
    const index = fold(
      call(1, "c1"),
      child(2, "n2"),
      child(3, "n3"),
      message(5, "task-n2", { from: ROOT_ID, to: "n2", text: "Do n2." }),
      message(6, "again-n2", { from: ROOT_ID, to: "n2", text: "Again." }),
    );

    expect(index.placement.byAnchor.get(ROOT_SESSION)).toEqual([
      { sessionId: "n3", at: at(3), via: "announcement" },
      { sessionId: "n2", at: at(5), via: "message" },
    ]);
    expect(index.needsOlderHistory).toBe(false);
  });

  it("keeps the newest snapshot when an older page arrives later", () => {
    const newest = child(10, "n2", { state: "idle", stopReason: "end_turn" });
    const newerPage = fold(call(9, "c1"), newest);

    const index = foldSubagentEvents(newerPage, [
      call(1, "c1"),
      child(2, "n2", { cell: "c1", state: "running" }),
    ]);

    expect(index.children.get("n2")?.latest).toBe(newest);
    expect(index.children.get("n2")?.firstAt).toBe(at(2));
  });

  it("takes the later arrival of two snapshots with one timestamp", () => {
    const later = child(2, "n2", { state: "idle", stopReason: "end_turn" });

    expect(fold(child(2, "n2"), later).children.get("n2")?.latest).toBe(later);
  });

  it("keeps the newest confirmed snapshot across a reconnect, whichever page brings it", () => {
    const running = child(1, "n2");
    const reconnected = foldSubagentEvents(fold(running), [reconnect(5, "n2")]);
    const waiting = child(3, "n2", { state: "requires_action" });

    const olderPage = foldSubagentEvents(reconnected, [waiting]);

    expect(reconnected.children.get("n2")?.lastConfirmed).toBe(running);
    expect(olderPage.children.get("n2")?.lastConfirmed).toBe(waiting);
    expect(olderPage.children.get("n2")?.latest.source).toBe("environment");
  });

  it("holds a child known only from reconnect snapshots as never confirmed", () => {
    const index = foldSubagentEvents(fold(reconnect(2, "n2")), [
      reconnect(4, "n2"),
    ]);

    expect(index.children.get("n2")).toMatchObject({
      lastConfirmed: null,
      firstAt: at(2),
    });
  });

  it("keeps the newest version of a message when an older page arrives later", () => {
    const newest = message(9, "m1", {
      transcript: "n2",
      from: "n2",
      to: ROOT_ID,
      text: "final",
    });

    const index = foldSubagentEvents(fold(child(1, "n2"), newest), [
      message(3, "m1", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "draft",
      }),
    ]);

    expect(index.messages.get(messageKey("n2", "m1"))?.latest).toBe(newest);
    expect(transcriptOf(index, "n2")).toEqual([
      ["message", messageKey("n2", "m1"), at(3)],
    ]);
  });

  it("orders a child's transcript by first event, ties by arrival", () => {
    const index = fold(
      child(1, "n2"),
      text(5, "n2", "thinking", { thought: true }),
      call(8, "c1", { session: "n2", status: "completed" }),
      message(5, "m1", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "a",
      }),
      // An older page brings the call's start: the call moves up to it.
      call(3, "c1", { session: "n2" }),
    );

    expect(transcriptOf(index, "n2")).toEqual([
      ["tool_call", toolCallKey("n2", "c1"), at(3)],
      ["text", "thinking", at(5)],
      ["message", messageKey("n2", "m1"), at(5)],
    ]);
  });

  it("keeps every entry of a child's transcript across folds, whatever its kind", () => {
    const first = fold(
      child(1, "n2"),
      text(2, "n2", "plan"),
      call(3, "x", { session: "n2" }),
    );

    const index = foldSubagentEvents(first, [
      text(4, "n2", "check"),
      message(5, "x", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "ok",
      }),
    ]);

    expect(transcriptOf(index, "n2")).toEqual([
      ["text", "plan", at(2)],
      ["tool_call", toolCallKey("n2", "x"), at(3)],
      ["text", "check", at(4)],
      ["message", messageKey("n2", "x"), at(5)],
    ]);
  });

  it("upserts a message and keeps its place", () => {
    const revised = message(9, "m1", {
      transcript: "n2",
      from: "n2",
      to: ROOT_ID,
      text: "final",
    });
    const index = fold(
      child(1, "n2"),
      message(3, "m1", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "d",
      }),
      text(4, "n2", "after"),
      revised,
    );

    expect(index.messages.get(messageKey("n2", "m1"))?.latest).toBe(revised);
    expect(transcriptOf(index, "n2")).toEqual([
      ["message", messageKey("n2", "m1"), at(3)],
      ["text", "after", at(4)],
    ]);
  });

  it("takes the agent's own report of a child call over the failure stored when the root's turn was aborted", () => {
    const report = call(7, "c1", { session: "n2", status: "completed" });
    const index = fold(
      child(1, "n2"),
      call(2, "c1", { session: "n2" }),
      call(5, "c1", { session: "n2", status: "failed" }),
      report,
    );

    expect(index.toolCalls.get(toolCallKey("n2", "c1"))?.latest).toBe(report);
    expect(transcriptOf(index, "n2")).toEqual([
      ["tool_call", toolCallKey("n2", "c1"), at(2)],
    ]);
    expect(index.stats.get("n2")?.toolCalls).toBe(1);
  });

  it("counts a child's own calls and takes its answer from its newest message outside its children", () => {
    const index = fold(
      call(1, "c1"),
      child(2, "n2", { cell: "c1" }),
      call(3, "c2", { session: "n2" }),
      child(4, "n3", { parent: "n2", cell: "c2" }),
      message(5, "task-n3", {
        transcript: "n2",
        from: "n2",
        to: "n3",
        text: "Do n3.",
      }),
      call(6, "c3", { session: "n3" }),
      message(7, "draft", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "d",
      }),
      message(8, "late-n3", {
        transcript: "n2",
        from: "n2",
        to: "n3",
        text: "More.",
      }),
      call(9, "c2", { session: "n2", status: "completed" }),
    );

    expect(index.stats.get("n2")).toEqual({
      toolCalls: 1,
      answerKey: messageKey("n2", "draft"),
    });
    expect(index.stats.get("n3")).toEqual({ toolCalls: 1, answerKey: null });
  });

  it("takes a child's answer from the newest message it sent", () => {
    const index = foldSubagentEvents(fold(child(1, "n2")), [
      message(2, "draft", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "d",
      }),
      message(3, "final", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "f",
      }),
      message(4, "reply", {
        transcript: "n2",
        from: ROOT_ID,
        to: "n2",
        text: "thanks",
      }),
      text(5, "n2", "wrapping up"),
    ]);

    expect(index.stats.get("n2")?.answerKey).toBe(messageKey("n2", "final"));
  });

  it("waits for a parent session that is not loaded", () => {
    const index = fold(call(1, "c1"), child(5, "n3", { parent: "n2" }));

    expect(index.placement.pending).toEqual([
      {
        sessionId: "n3",
        reason: "parent-session",
        missingId: "n2",
        parentSessionRef: "n2",
        fallback: null,
      },
    ]);
    expect(index.needsOlderHistory).toBe(true);
  });

  it("waits for a named spawning call that is not loaded, with its fallback", () => {
    const index = fold(
      child(2, "n2", { cell: "c9" }),
      message(4, "task-n2", { from: ROOT_ID, to: "n2", text: "Do n2." }),
    );

    expect(index.placement.pending).toEqual([
      {
        sessionId: "n2",
        reason: "parent-call",
        missingId: "c9",
        parentSessionRef: ROOT_SESSION,
        fallback: { sessionId: "n2", at: at(4), via: "message" },
      },
    ]);
    expect(index.placement.byCell.size).toBe(0);
    expect(index.needsOlderHistory).toBe(true);
  });

  it("places a waiting child once the older page with its spawning call arrives", () => {
    const newestPage = fold(
      child(1, "n2"),
      text(2, "n2", "thinking"),
      child(5, "n3", { parent: "n2", cell: "c2" }),
    );

    const index = foldSubagentEvents(newestPage, [
      call(3, "c2", { session: "n2" }),
    ]);

    expect(
      newestPage.placement.pending.map(({ sessionId }) => sessionId),
    ).toEqual(["n3"]);
    expect(index.placement.byCell.get(toolCallKey("n2", "c2"))).toEqual(["n3"]);
    expect(index.placement.pending).toEqual([]);
  });

  it("moves a child to its parent's message to it, and to an earlier one an older page brings", () => {
    const announced = fold(child(2, "n2"), child(3, "n3"));

    const tasked = foldSubagentEvents(announced, [
      message(6, "task", { from: ROOT_ID, to: "n2", text: "Do n2." }),
    ]);
    const olderPage = foldSubagentEvents(tasked, [
      message(4, "first", { from: ROOT_ID, to: "n2", text: "Start n2." }),
    ]);

    expect(tasked.placement.byAnchor.get(ROOT_SESSION)).toEqual([
      { sessionId: "n3", at: at(3), via: "announcement" },
      { sessionId: "n2", at: at(6), via: "message" },
    ]);
    expect(olderPage.placement.byAnchor.get(ROOT_SESSION)?.[1]).toEqual({
      sessionId: "n2",
      at: at(4),
      via: "message",
    });
  });

  // @spec SUB-008 — Opening a conversation loads the older history its visible sub-agents need, and no more
  it("needs older history until every spawning call's start is loaded", () => {
    const newestPage = fold(
      call(2, "c2"),
      child(3, "n3", { cell: "c2" }),
      call(9, "c1", { status: "completed" }),
      child(8, "n2", { cell: "c1", state: "idle" }),
    );
    expect(newestPage.placement.byCell.get(rootCell("c1"))).toEqual(["n2"]);
    expect(newestPage.needsOlderHistory).toBe(true);

    const complete = foldSubagentEvents(newestPage, [call(1, "c1")]);

    expect(complete.needsOlderHistory).toBe(false);
  });

  it.each(["pending", "in_progress"] as const)(
    "takes a %s event as the spawning call's start",
    (status) => {
      const index = fold(
        call(1, "c1", { status }),
        child(2, "n2", { cell: "c1" }),
      );

      expect(index.needsOlderHistory).toBe(false);
    },
  );

  it("needs older history for a transcript whose session was never announced in the loaded pages", () => {
    const index = foldSubagentEvents(fold(call(1, "c1")), [
      text(3, "n7", "still busy"),
    ]);

    expect(index.needsOlderHistory).toBe(true);
    expect(
      foldSubagentEvents(index, [child(2, "n7", { cell: "c1" })])
        .needsOlderHistory,
    ).toBe(false);
  });

  it("keeps every unchanged record, transcript, cell list and summary", () => {
    const before = fold(
      call(1, "c1"),
      child(2, "n2", { cell: "c1" }),
      text(3, "n2", "n2 thinks"),
      child(4, "n3", { cell: "c1" }),
    );

    const after = foldSubagentEvents(before, [
      call(5, "c4", { session: "n3" }),
    ]);

    expect(after).not.toBe(before);
    expect(after.children).toBe(before.children);
    expect(after.transcripts.get("n2")).toBe(before.transcripts.get("n2"));
    expect(after.transcripts.get("n3")).not.toBe(before.transcripts.get("n3"));
    expect(after.stats.get("n2")).toBe(before.stats.get("n2"));
    expect(after.placement.byCell.get(rootCell("c1"))).toBe(
      before.placement.byCell.get(rootCell("c1")),
    );
    expect(after.placement.cellSummaries.get(rootCell("c1"))).toBe(
      before.placement.cellSummaries.get(rootCell("c1")),
    );
    expect(after.version).toBeGreaterThan(before.version);
  });

  it("keeps a child's transcript and stats when one of its calls completes", () => {
    const before = fold(child(1, "n2"), call(2, "x", { session: "n2" }));

    const after = foldSubagentEvents(before, [
      call(3, "x", { session: "n2", status: "completed" }),
    ]);

    expect(after.toolCalls.get(toolCallKey("n2", "x"))?.latest.status).toBe(
      "completed",
    );
    expect(after.transcripts.get("n2")).toBe(before.transcripts.get("n2"));
    expect(after.stats.get("n2")).toBe(before.stats.get("n2"));
  });

  it("returns the same index for an older snapshot that changes nothing", () => {
    const before = fold(child(1, "n2"), child(5, "n2", { state: "idle" }));

    expect(foldSubagentEvents(before, [child(3, "n2")])).toBe(before);
  });

  it("keeps the placement when recomputing it changes nothing", () => {
    const before = fold(
      call(1, "c1"),
      child(2, "n2", { cell: "c1" }),
      child(3, "n3"),
      child(4, "n4", { cell: "c9" }),
    );

    const after = foldSubagentEvents(before, [call(5, "c5")]);

    expect(after.toolCalls).not.toBe(before.toolCalls);
    expect(after.placement).toBe(before.placement);
  });

  it("does not recompute placement for a cost-only snapshot", () => {
    const before = fold(call(1, "c1"), child(2, "n2", { cell: "c1" }));

    const after = foldSubagentEvents(before, [
      child(3, "n2", { cell: "c1", cost: 0.0004 }),
    ]);

    expect(after.placement).toBe(before.placement);
    expect(after.children).not.toBe(before.children);
    expect(after.children.get("n2")?.latest.cost).toBe(0.0004);
  });

  it("recomputes the summary when a child's state changes", () => {
    const before = fold(call(1, "c1"), child(2, "n2", { cell: "c1" }));

    const after = foldSubagentEvents(before, [
      child(3, "n2", { cell: "c1", state: "idle", stopReason: "end_turn" }),
    ]);

    expect(after.placement.cellSummaries.get(rootCell("c1"))).toMatchObject({
      total: 1,
      running: 0,
      done: 1,
    });
  });

  // @spec SUB-009 — Agents without sub-agent sessions render as before
  it("returns the same index for events that are not about ACP sessions", () => {
    const before = fold(call(1, "c1"), child(2, "n2", { cell: "c1" }));
    const userMessage = {
      id: "user-1",
      timestamp: at(3),
      source: "user",
      llm_message: { role: "user", content: [{ type: "text", text: "hi" }] },
    } as MessageEvent;

    expect(foldSubagentEvents(before, [userMessage])).toBe(before);
    expect(fold(userMessage).needsOlderHistory).toBe(false);
    expect(foldSubagentEvents(before, [])).toBe(before);
  });

  it("ignores events from the planning agent", () => {
    const planning = { ...child(2, "n2"), isFromPlanningAgent: true };
    const main = { ...child(2, "n2"), isFromPlanningAgent: false };

    expect(fold(planning)).toBe(EMPTY_SUBAGENT_INDEX);
    expect(fold(main).children.has("n2")).toBe(true);
  });

  it("refuses to recurse into a parent loop", () => {
    const index = fold(
      child(1, "n2", { parent: "n3" }),
      child(2, "n3", { parent: "n2" }),
    );

    expect(
      index.placement.pending.map(({ sessionId, reason }) => [
        sessionId,
        reason,
      ]),
    ).toEqual([
      ["n2", "parent-session"],
      ["n3", "parent-session"],
    ]);
  });
});

describe("buildSubagentIndex", () => {
  it("builds the same index from a page in any order, each event once", () => {
    const events = [
      call(1, "c1"),
      child(2, "n2", { cell: "c1" }),
      message(3, "task-n2", { from: ROOT_ID, to: "n2", text: "Do n2." }),
      text(4, "n2", "thinking", { thought: true }),
      call(5, "c2", { session: "n2" }),
      child(6, "n3", { parent: "n2", cell: "c2" }),
      call(7, "c2", { session: "n2", status: "completed" }),
      child(8, "n2", { cell: "c1", state: "idle", cost: 0.0009 }),
    ];
    const { version: inOrderVersion, ...inOrder } = buildSubagentIndex(events);

    const shuffled = [5, 0, 7, 2, 6, 1, 3, 4].map((i) => events[i]);
    const { version, ...fromShuffled } = buildSubagentIndex([
      ...shuffled,
      events[3],
    ]);

    expect(fromShuffled).toEqual(inOrder);
    expect(version).toBeGreaterThan(0);
    expect(inOrderVersion).toBeGreaterThan(0);
  });
});

describe("anchorsForParent", () => {
  const placed = [{ sessionId: "n2", at: at(5), via: "message" as const }];
  const pending = [
    {
      sessionId: "n3",
      reason: "parent-call" as const,
      missingId: "c9",
      parentSessionRef: ROOT_SESSION,
      fallback: { sessionId: "n3", at: at(2), via: "announcement" as const },
    },
    {
      sessionId: "n4",
      reason: "parent-session" as const,
      missingId: "n7",
      parentSessionRef: "n7",
      fallback: null,
    },
  ];

  it("adds the fallbacks of children whose spawning call never turned up, once history is complete", () => {
    expect(anchorsForParent(placed, pending, ROOT_SESSION, false)).toBe(placed);
    expect(anchorsForParent(placed, pending, ROOT_SESSION, true)).toEqual([
      { sessionId: "n3", at: at(2), via: "announcement" },
      { sessionId: "n2", at: at(5), via: "message" },
    ]);
    expect(anchorsForParent(placed, pending, "n2", true)).toBe(placed);
  });

  // @spec SUB-003 — A sub-agent whose parent session is not in the conversation is shown apart, never in the root's flow
  it("groups children whose parent session is missing by that parent", () => {
    expect(
      unplacedGroups([
        ...pending,
        { ...pending[1], sessionId: "n5" },
        { ...pending[1], sessionId: "n6", missingId: "n8" },
      ]),
    ).toEqual([
      { missingParentId: "n7", sessionIds: ["n4", "n5"] },
      { missingParentId: "n8", sessionIds: ["n6"] },
    ]);
  });
});
