import React from "react";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "test-utils";
import { Messages } from "#/components/conversation-events/chat/messages";
import { shouldRenderEvent } from "#/components/conversation-events/chat/event-content-helpers/should-render-event";
import { SubagentHistoryContext } from "#/components/conversation-events/chat/subagents/subagent-source";
import { useEventStore } from "#/stores/use-event-store";
import { AgentState } from "#/types/agent-state";
import type { OpenHandsEvent } from "#/types/agent-server/core";
import {
  call,
  child,
  message,
  ROOT_ACP_SESSION_ID as ROOT_ID,
  text,
} from "../../../helpers/subagent-events";

vi.mock("#/hooks/query/use-config", () => ({
  useConfig: () => ({ data: {} }),
}));

vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => ({
    data: {
      id: "test-conversation-id",
      conversation_url: "",
      session_api_key: null,
    },
  }),
}));

vi.mock("#/hooks/use-agent-state", () => ({
  useAgentState: () => ({ curAgentState: AgentState.RUNNING }),
  usePlanningAgentState: () => ({ isPlanningAgentRunning: false }),
}));

/** The chat's message list, fed from the event store as ChatInterface does. */
function Chat() {
  const uiEvents = useEventStore((state) => state.uiEvents);
  const events = useEventStore((state) => state.events);
  const renderable = React.useMemo(
    () => uiEvents.filter(shouldRenderEvent),
    [uiEvents],
  );
  return <Messages messages={renderable} allEvents={events} />;
}

const seed = (...events: OpenHandsEvent[]) =>
  act(() => useEventStore.getState().addEvents(events));

const cards = () => screen.getAllByTestId("acp-tool-call");

const rowOf = (sessionId: string) =>
  document.querySelector(
    `[data-testid="subagent-row"][data-acp-session-id="${sessionId}"]`,
  );

const isBefore = (first: Element | null, second: Element | null) =>
  first !== null &&
  second !== null &&
  (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !==
    0;

describe("Messages with ACP sub-agent sessions", () => {
  beforeEach(() => {
    useEventStore.getState().clearEvents();
  });

  // @spec SUB-004 — The root's flow shows only the root session's work
  it("main flow shows only the root's work", () => {
    seed(
      call(1, "c1"),
      child(2, "n2", { cell: "c1" }),
      message(3, "task", { from: ROOT_ID, to: "n2", text: "Do part two." }),
      call(4, "c1", { session: "n2" }),
      text(5, "n2", "Working on part two."),
      call(6, "c1", { session: "n2", status: "completed" }),
    );

    renderWithProviders(<Chat />);

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveAttribute("data-acp-tool-call-id", "c1");
    expect(cards()[0]).not.toHaveAttribute("data-acp-session-id");
    expect(screen.queryByText("Do part two.")).not.toBeInTheDocument();
    expect(screen.queryByText("Working on part two.")).not.toBeInTheDocument();
  });

  // @spec SUB-002 — Without a loaded spawning call, a sub-agent renders at its parent's message to it, else at its announcement
  it("anchors a child without a spawning call at the root's message to it", () => {
    seed(
      call(1, "c1", { status: "completed" }),
      child(2, "n2"),
      message(5, "task", { from: ROOT_ID, to: "n2", text: "Do part two." }),
      call(7, "c2", { status: "completed" }),
    );

    renderWithProviders(<Chat />);

    const [first, second] = cards();
    expect(isBefore(first, rowOf("n2"))).toBe(true);
    expect(isBefore(rowOf("n2"), second)).toBe(true);
  });

  // @spec SUB-003 — A sub-agent whose parent session is not in the conversation is shown apart, never in the root's flow
  it("shows children of a missing parent apart once history is complete", () => {
    seed(call(1, "c1"), child(2, "n5", { parent: "ghost" }));

    const { unmount } = renderWithProviders(
      <SubagentHistoryContext.Provider value={false}>
        <Chat />
      </SubagentHistoryContext.Provider>,
    );
    expect(screen.queryByTestId("subagent-unplaced")).not.toBeInTheDocument();
    expect(rowOf("n5")).toBeNull();
    unmount();

    renderWithProviders(<Chat />);

    const unplaced = screen.getByTestId("subagent-unplaced");
    expect(unplaced).toHaveAttribute("data-missing-parent-session-id", "ghost");
    expect(unplaced).toContainElement(rowOf("n5") as HTMLElement);
    expect(isBefore(cards()[0], unplaced)).toBe(true);
  });

  // @spec SUB-009 — Agents without sub-agent sessions render as before
  it("renders agents without sub-agent sessions as before", () => {
    seed(call(1, "c1"), call(2, "c1", { status: "completed" }));

    renderWithProviders(<Chat />);

    expect(cards()).toHaveLength(1);
    expect(cards()[0]).toHaveAttribute(
      "data-acp-tool-call-status",
      "completed",
    );
    expect(screen.queryByTestId("subagent-block")).not.toBeInTheDocument();
    expect(screen.queryByTestId("subagent-unplaced")).not.toBeInTheDocument();
  });

  it("keeps sub-agents expanded when the spawning call completes", async () => {
    const user = userEvent.setup();
    seed(call(1, "c1"), child(2, "n2", { cell: "c1" }));
    renderWithProviders(<Chat />);
    await user.click(screen.getByTestId("subagent-block-toggle"));

    seed(
      child(3, "n2", { cell: "c1", state: "idle" }),
      call(4, "c1", { status: "completed" }),
    );

    const block = screen.getByTestId("subagent-block");
    expect(cards()[0]).toHaveAttribute(
      "data-acp-tool-call-status",
      "completed",
    );
    expect(within(block).getByTestId("subagent-block-toggle")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(within(block).getByTestId("subagent-row")).toHaveAttribute(
      "data-subagent-status",
      "done",
    );
  });
});
