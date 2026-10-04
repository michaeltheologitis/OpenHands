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

  // @spec SUB-002 — Without a loaded spawning call, a sub-agent renders at its parent's message to it, else at its announcement
  it("keeps a root call where it started when a child's task lands before it ends", () => {
    seed(
      call(1, "c1"),
      child(2, "n2"),
      message(3, "task", { from: ROOT_ID, to: "n2", text: "Do part two." }),
      call(5, "c1", { status: "completed" }),
      call(7, "c2", { status: "completed" }),
    );

    renderWithProviders(<Chat />);

    const [first, second] = cards();
    expect(isBefore(first, rowOf("n2"))).toBe(true);
    expect(isBefore(rowOf("n2"), second)).toBe(true);
  });

  // @spec SUB-002 — Without a loaded spawning call, a sub-agent renders at its parent's message to it, else at its announcement
  it("puts a child anchored at the instant a root call starts after that call", () => {
    seed(
      call(1, "c1", { status: "completed" }),
      child(2, "n2"),
      call(5, "c2", { status: "completed" }),
      message(5, "task", { from: ROOT_ID, to: "n2", text: "Do part two." }),
      call(7, "c3", { status: "completed" }),
    );

    renderWithProviders(<Chat />);

    const [, tied, next] = cards();
    expect(isBefore(tied, rowOf("n2"))).toBe(true);
    expect(isBefore(rowOf("n2"), next)).toBe(true);
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

  // @spec SUB-003 — A sub-agent whose parent session is not in the conversation is shown apart, never in the root's flow
  it("nests a child spawned inside an unplaced child under it, in one block", async () => {
    const user = userEvent.setup();
    seed(
      child(1, "child-o", { parent: "ghost" }),
      call(2, "co1", { session: "child-o" }),
      child(3, "child-p", { parent: "child-o", cell: "co1" }),
    );
    renderWithProviders(<Chat />);

    const missingParents = screen
      .getAllByTestId("subagent-unplaced")
      .map((block) => block.getAttribute("data-missing-parent-session-id"));
    expect(missingParents).toEqual(["ghost"]);

    const childO = rowOf("child-o") as HTMLElement;
    await user.click(within(childO).getByTestId("subagent-row-toggle"));
    await user.click(within(childO).getByTestId("subagent-block-toggle"));

    expect(childO).toContainElement(rowOf("child-p") as HTMLElement);
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
