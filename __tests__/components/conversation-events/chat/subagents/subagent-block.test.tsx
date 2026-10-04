import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "test-utils";
import { AcpToolCallCell } from "#/components/conversation-events/chat/subagents/acp-tool-call-cell";
import {
  SubagentHistoryContext,
  SubagentSourceContext,
  useStaticSubagentSource,
} from "#/components/conversation-events/chat/subagents/subagent-source";
import { writeShowSubagentCosts } from "#/components/conversation-events/chat/subagents/subagent-cost-preference";
import EventService from "#/api/event-service/event-service.api";
import { displayErrorToast } from "#/utils/custom-toast-handlers";
import { useEventStore } from "#/stores/use-event-store";
import type { OpenHandsEvent } from "#/types/agent-server/core";
import type { ACPToolCallEvent } from "#/types/agent-server/core/events/acp-tool-call-event";
import {
  call,
  child,
  message,
  reconnect,
  ROOT_ACP_SESSION_ID as ROOT_ID,
  text,
} from "../../../../helpers/subagent-events";

vi.mock("react-i18next", async (importOriginal) => {
  const { englishT } = await import("../../../../helpers/english-translations");
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: () => ({
      t: englishT,
      i18n: { language: "en", exists: () => true },
    }),
  };
});

const RUNTIME_URL = "http://runtime.example.com/api/conversations/conv-1";

vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => ({
    data: {
      id: "conv-1",
      conversation_url: "http://runtime.example.com/api/conversations/conv-1",
      session_api_key: "session-key",
    },
  }),
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
}));

/** An error as the TypeScript client raises it, with the agent-server's body. */
const httpError = (status: number, body: Record<string, string>) =>
  Object.assign(new Error(`HTTP ${status}`), {
    name: "HttpError",
    status,
    response: body,
  });

const seed = (...events: OpenHandsEvent[]) =>
  act(() => useEventStore.getState().addEvents(events));

const renderCell = (cell: ACPToolCallEvent, historyComplete = true) =>
  renderWithProviders(
    <SubagentHistoryContext.Provider value={historyComplete}>
      <AcpToolCallCell event={cell} depth={0} />
    </SubagentHistoryContext.Provider>,
  );

const rowOf = (sessionId: string) => {
  const row = document.querySelector<HTMLElement>(
    `[data-testid="subagent-row"][data-acp-session-id="${sessionId}"]`,
  );
  if (!row) throw new Error(`no row for ${sessionId}`);
  return row;
};

const user = userEvent.setup();

/** Expand a row and return its transcript. */
const expandRow = async (sessionId: string) => {
  await user.click(
    within(rowOf(sessionId)).getAllByTestId("subagent-row-toggle")[0],
  );
  return within(rowOf(sessionId)).getAllByTestId("subagent-transcript")[0];
};

describe("sub-agents under the call that spawned them", () => {
  beforeEach(() => {
    useEventStore.getState().clearEvents();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.mocked(displayErrorToast).mockReset();
  });

  it("shows a collapsed summary counting children by state", () => {
    const cell = call(1, "c1");
    seed(
      cell,
      child(2, "n2", { cell: "c1" }),
      child(3, "n3", { cell: "c1" }),
      child(4, "n4", { cell: "c1" }),
      child(5, "n2", { cell: "c1", state: "idle", stopReason: "end_turn" }),
      child(6, "n4", { cell: "c1", state: "idle" }),
    );

    renderCell(cell);

    const toggle = screen.getByTestId("subagent-block-toggle");
    expect(toggle).toHaveTextContent("3 sub-agents · 2 done · 1 running");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(toggle).getByTestId("spinner-icon")).toBeInTheDocument();
    expect(screen.getByTestId("subagent-block")).toHaveAttribute(
      "data-subagent-count",
      "3",
    );
    expect(screen.queryByTestId("subagent-row")).not.toBeInTheDocument();
  });

  // @spec SUB-001 — Each ACP sub-agent session renders inside the tool call that spawned it, recursively
  it("expands to each child's cells and their own sub-agents", async () => {
    const cell = call(1, "c1");
    seed(
      cell,
      child(2, "n2", { cell: "c1" }),
      call(3, "c2", { session: "n2" }),
      child(4, "n3", { parent: "n2", cell: "c2" }),
      call(5, "c3", { session: "n3" }),
      child(6, "n4", { parent: "n3", cell: "c3" }),
    );
    renderCell(cell);

    await user.click(screen.getByTestId("subagent-block-toggle"));
    const n2Cell = within(await expandRow("n2")).getByTestId("acp-tool-call");
    expect(n2Cell).toHaveAttribute("data-acp-session-id", "n2");
    expect(n2Cell).toHaveAttribute("data-acp-tool-call-id", "c2");
    await user.click(within(n2Cell).getByTestId("subagent-block-toggle"));
    const n3Cell = within(await expandRow("n3")).getByTestId("acp-tool-call");
    await user.click(within(n3Cell).getByTestId("subagent-block-toggle"));

    expect(n3Cell).toHaveAttribute("data-acp-tool-call-id", "c3");
    expect(rowOf("n2")).toContainElement(rowOf("n3"));
    expect(n3Cell).toContainElement(rowOf("n4"));
  });

  // @spec SUB-006 — Costs show only when the setting is on; then each sub-agent shows its latest reported cost, never a sum
  it("shows each child's latest cost and never a sum when costs are shown", async () => {
    writeShowSubagentCosts(true);
    const cell = call(1, "c1");
    seed(
      cell,
      child(2, "n2", { cell: "c1", cost: 0.0004 }),
      child(3, "n3", { cell: "c1", cost: 0.0002 }),
      child(4, "n2", { cell: "c1", cost: 0.0009 }),
    );
    renderCell(cell);

    await user.click(screen.getByTestId("subagent-block-toggle"));

    expect(within(rowOf("n2")).getByTestId("subagent-cost")).toHaveTextContent(
      "$0.0009",
    );
    expect(within(rowOf("n3")).getByTestId("subagent-cost")).toHaveTextContent(
      "$0.0002",
    );
    expect(screen.getByTestId("subagent-block-toggle")).not.toHaveTextContent(
      "$",
    );
  });

  // @spec SUB-005 — Each sub-agent shows its latest state; an unconfirmed state never shows a spinner
  it("shows the last known state without a spinner after a reconnect", async () => {
    const cell = call(1, "c1");
    seed(
      cell,
      child(2, "n2", { cell: "c1", cancellable: true }),
      reconnect(3, "n2", { cell: "c1" }),
    );
    renderCell(cell);

    const toggle = screen.getByTestId("subagent-block-toggle");
    await user.click(toggle);

    const row = rowOf("n2");
    expect(row).toHaveAttribute("data-subagent-status", "unconfirmed");
    expect(row).toHaveAttribute("data-subagent-stale");
    expect(within(row).getByTestId("subagent-status")).toHaveTextContent(
      "running · last known",
    );
    expect(within(row).queryByTestId("spinner-icon")).not.toBeInTheDocument();
    expect(within(row).queryByTestId("subagent-stop")).not.toBeInTheDocument();
    expect(toggle).toHaveTextContent(
      "1 sub-agent · 1 not confirmed since reconnecting",
    );
    expect(
      within(toggle).queryByTestId("spinner-icon"),
    ).not.toBeInTheDocument();
  });

  // @spec SUB-005 — Each sub-agent shows its latest state; an unconfirmed state never shows a spinner
  it.each([
    ["running", undefined, "spinner-icon"],
    ["idle", "end_turn", "subagent-done-icon"],
    ["idle", "cancelled", "subagent-stopped-icon"],
    ["requires_action", undefined, null],
    ["idle", "max_tokens", null],
  ])(
    "marks a %s / %s child with %s beside its status",
    async (state, stopReason, icon) => {
      const cell = call(1, "c1");
      seed(cell, child(2, "n2", { cell: "c1", state, stopReason }));
      renderCell(cell);
      await user.click(screen.getByTestId("subagent-block-toggle"));

      const toggle = within(rowOf("n2")).getByTestId("subagent-row-toggle");
      const icons = [
        "spinner-icon",
        "subagent-done-icon",
        "subagent-stopped-icon",
      ].filter((testId) => within(toggle).queryByTestId(testId));

      expect(icons).toEqual(icon ? [icon] : []);
    },
  );

  it("shows a child's task first and its answer last", async () => {
    const cell = call(1, "c1");
    seed(
      cell,
      child(2, "n2", { cell: "c1", title: "Summarize CS101" }),
      message(3, "task", { from: ROOT_ID, to: "n2", text: "Summarize CS101." }),
      text(4, "n2", "Reading the catalog.", { thought: true }),
      call(5, "c2", { session: "n2" }),
      message(6, "answer", {
        transcript: "n2",
        from: "n2",
        to: ROOT_ID,
        text: "3cr, 0 prereqs — light\nCS101 has no prerequisites.",
      }),
      child(7, "n2", { cell: "c1", state: "idle", stopReason: "end_turn" }),
    );
    renderCell(cell);
    await user.click(screen.getByTestId("subagent-block-toggle"));

    const row = rowOf("n2");
    expect(within(row).getByTestId("subagent-answer")).toHaveTextContent(
      /^3cr, 0 prereqs — light$/,
    );
    expect(within(row).getByTestId("subagent-tool-calls")).toHaveTextContent(
      "1 tool call",
    );
    const entries = [...(await expandRow("n2")).children];

    expect(entries[0]).toHaveAttribute("data-testid", "subagent-task");
    expect(entries[0]).toHaveTextContent("Summarize CS101.");
    expect(entries.at(-1)).toHaveTextContent("To the main agent");
    expect(entries.at(-1)).toHaveTextContent("CS101 has no prerequisites.");
    expect(entries).toHaveLength(4);
  });

  // @spec SUB-001 — Each ACP sub-agent session renders inside the tool call that spawned it, recursively
  it("shows a child's task to its own child only as that child's task", async () => {
    const cell = call(1, "c1");
    seed(
      cell,
      child(2, "n2", { cell: "c1" }),
      call(3, "c2", { session: "n2" }),
      child(4, "n3", { parent: "n2", cell: "c2", title: "Read CS201" }),
      message(5, "task-n3", {
        transcript: "n2",
        from: "n2",
        to: "n3",
        text: "Check the prerequisites of CS201.",
      }),
    );
    renderCell(cell);

    await user.click(screen.getByTestId("subagent-block-toggle"));
    const n2Transcript = await expandRow("n2");
    await user.click(within(n2Transcript).getByTestId("subagent-block-toggle"));
    const n3Transcript = await expandRow("n3");

    expect(within(n3Transcript).getByTestId("subagent-task")).toHaveTextContent(
      "Check the prerequisites of CS201.",
    );
    expect(
      screen.getAllByText("Check the prerequisites of CS201."),
    ).toHaveLength(1);
    expect(n2Transcript).not.toHaveTextContent("To Read CS201");
  });

  // @spec SUB-008 — Opening a conversation loads the older history its visible sub-agents need, and no more
  it("says earlier activity is loading while the cell's start is missing", () => {
    const cell = call(9, "c1", { status: "completed" });
    seed(cell, child(8, "n2", { cell: "c1" }));

    const { unmount } = renderCell(cell, false);
    expect(screen.getByTestId("subagent-loading-earlier")).toHaveTextContent(
      "Loading earlier sub-agent activity…",
    );
    unmount();

    renderCell(cell, true);
    expect(
      screen.queryByTestId("subagent-loading-earlier"),
    ).not.toBeInTheDocument();
  });

  describe("Stop", () => {
    const stopOf = (sessionId: string) =>
      within(rowOf(sessionId)).queryByTestId("subagent-stop");

    const seedStoppableRun = () => {
      const cell = call(1, "c1");
      seed(
        cell,
        child(2, "n2", { cell: "c1", title: "Read CS201", cancellable: true }),
        child(3, "n3", { cell: "c1", cancellable: false }),
        // An agent may keep a finished child's grant; the route answers 409.
        child(4, "n4", {
          cell: "c1",
          state: "idle",
          stopReason: "end_turn",
          cancellable: true,
        }),
        child(5, "n5", { cell: "c1", cancellable: true }),
        reconnect(6, "n5", { cell: "c1" }),
      );
      return cell;
    };

    // @spec SUB-007 — Stop is offered only for a running sub-agent that granted cancel on the live connection
    it("offers Stop only for a running child that granted cancel", async () => {
      renderCell(seedStoppableRun());
      await user.click(screen.getByTestId("subagent-block-toggle"));

      expect(stopOf("n2")).toHaveAttribute("data-subagent-stop", "ready");
      expect(stopOf("n2")).not.toHaveAttribute("aria-disabled", "true");
      expect(stopOf("n2")).toHaveAccessibleName("Stop Read CS201");
      expect(stopOf("n3")).toHaveAttribute("data-subagent-stop", "withheld");
      expect(stopOf("n4")).toBeNull();
      expect(stopOf("n5")).toBeNull();
    });

    it("explains why Stop is unavailable when the agent withheld cancel", async () => {
      const cancel = vi.spyOn(EventService, "cancelAcpSession");
      renderCell(seedStoppableRun());
      await user.click(screen.getByTestId("subagent-block-toggle"));

      const withheld = stopOf("n3") as HTMLElement;
      expect(withheld).toHaveAttribute("aria-disabled", "true");
      await user.hover(withheld);
      expect(await screen.findByRole("tooltip")).toHaveTextContent(
        "This agent cannot stop a single sub-agent. Stop ends the whole turn.",
      );
      await user.click(withheld);
      expect(cancel).not.toHaveBeenCalled();
    });

    it("asks to cancel and waits for the child's own cancelled state", async () => {
      const cancel = vi
        .spyOn(EventService, "cancelAcpSession")
        .mockResolvedValue({ session_id: "n2", requested: true });
      renderCell(seedStoppableRun());
      await user.click(screen.getByTestId("subagent-block-toggle"));

      await user.click(stopOf("n2") as HTMLElement);

      expect(cancel).toHaveBeenCalledWith(
        "conv-1",
        "n2",
        RUNTIME_URL,
        "session-key",
      );
      expect(stopOf("n2")).toHaveAttribute("data-subagent-stop", "stopping");
      expect(stopOf("n2")).toHaveAttribute("aria-disabled", "true");
      expect(stopOf("n2")).toHaveTextContent("Stopping…");
      expect(rowOf("n2")).toHaveAttribute("data-subagent-status", "running");

      seed(
        child(7, "n2", { cell: "c1", state: "idle", stopReason: "cancelled" }),
      );

      expect(stopOf("n2")).toBeNull();
      expect(rowOf("n2")).toHaveAttribute("data-subagent-status", "stopped");
    });

    it.each([
      [
        "a 409 with its detail",
        httpError(409, {
          detail:
            "ACP session n2 does not accept cancel; cancel the conversation's turn instead.",
        }),
        "ACP session n2 does not accept cancel; cancel the conversation's turn instead.",
      ],
      [
        "a 504, whose reason the agent-server moves under exception",
        httpError(504, {
          detail: "Internal Server Error",
          exception:
            "504: ACP server did not accept the cancel for n2 within 2s.",
        }),
        "ACP server did not accept the cancel for n2 within 2s.",
      ],
      [
        "a failure without a body",
        new Error("Failed to fetch"),
        "Could not stop the sub-agent.",
      ],
    ])(
      "shows the server's reason when a cancel is refused: %s",
      async (_case, error, shown) => {
        vi.spyOn(EventService, "cancelAcpSession").mockRejectedValue(error);
        renderCell(seedStoppableRun());
        await user.click(screen.getByTestId("subagent-block-toggle"));

        await user.click(stopOf("n2") as HTMLElement);

        expect(displayErrorToast).toHaveBeenCalledWith(shown);
        expect(stopOf("n2")).toHaveAttribute("data-subagent-stop", "ready");
      },
    );

    it("never offers Stop in a read-only view", async () => {
      const cell = call(1, "c1");
      const events = [cell, child(2, "n2", { cell: "c1", cancellable: true })];
      function ReadOnlyCell() {
        const source = useStaticSubagentSource(events);
        return (
          <SubagentSourceContext.Provider value={source}>
            <AcpToolCallCell event={cell} depth={0} />
          </SubagentSourceContext.Provider>
        );
      }
      renderWithProviders(<ReadOnlyCell />);

      await user.click(screen.getByTestId("subagent-block-toggle"));

      expect(rowOf("n2")).toHaveAttribute("data-subagent-status", "running");
      expect(stopOf("n2")).toBeNull();
    });
  });
});
