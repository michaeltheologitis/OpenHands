import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ACPSessionControlsEvent } from "@openhands/typescript-client";
import { localAgentServerHasCapability } from "#/api/agent-server-compatibility";
import {
  __resetActiveStoreForTests,
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import AgentServerConversationService from "#/api/conversation-service/agent-server-conversation-service.api";
import EventService from "#/api/event-service/event-service.api";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import {
  NO_AGENT_CONTROLS,
  useConversationAgentControls,
} from "#/hooks/chat/use-agent-controls";
import { useEventStore } from "#/stores/use-event-store";
import { displayErrorToast } from "#/utils/custom-toast-handlers";

vi.mock("#/api/agent-server-compatibility", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#/api/agent-server-compatibility")
  >()),
  localAgentServerHasCapability: vi.fn(() => true),
}));

const conversation = vi.hoisted(() => ({
  data: { agent_kind: "acp" } as { agent_kind: string } | undefined,
}));

vi.mock("#/hooks/query/use-active-conversation", () => ({
  useActiveConversation: () => conversation,
}));

vi.mock("#/utils/custom-toast-handlers", () => ({
  displayErrorToast: vi.fn(),
}));

const LOCAL = {
  id: "local",
  name: "Local",
  host: "http://127.0.0.1:8000",
  apiKey: "key",
  kind: "local" as const,
};

const controlsEvent: ACPSessionControlsEvent = {
  id: "controls-1",
  kind: "ACPSessionControlsEvent",
  timestamp: "2026-10-01T10:00:00Z",
  source: "agent",
  available_commands: [{ name: "summarize", description: "Summarize" }],
  config_options: [
    {
      id: "profile",
      name: "Profile",
      type: "select",
      current_value: "fast",
      options: [
        { value: "fast", name: "fast" },
        { value: "thorough", name: "thorough" },
      ],
    },
    {
      id: "model",
      name: "Model",
      type: "select",
      current_value: "m1",
      options: [{ value: "m1", name: "M1" }],
    },
  ],
};

function wrapper({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={client}>
      <ActiveBackendProvider>{children}</ActiveBackendProvider>
    </QueryClientProvider>
  );
}

const renderControls = () =>
  renderHook(() => useConversationAgentControls("conv-1"), { wrapper });

describe("useConversationAgentControls", () => {
  beforeEach(() => {
    __resetActiveStoreForTests();
    setRegisteredBackends([LOCAL, { ...LOCAL, id: "cloud", kind: "cloud" }]);
    setActiveSelection({ backendId: LOCAL.id });
    conversation.data = { agent_kind: "acp" };
    vi.mocked(localAgentServerHasCapability).mockReturnValue(true);
    vi.spyOn(EventService, "searchEvents").mockResolvedValue({
      items: [controlsEvent],
      next_page_id: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetActiveStoreForTests();
    useEventStore.getState().clearEvents();
  });

  it("offers the newest report's commands and its options except the model", async () => {
    const { result } = renderControls();

    await waitFor(() =>
      expect(result.current.commands.map(({ name }) => name)).toEqual([
        "summarize",
      ]),
    );
    expect(result.current.options.map(({ id }) => id)).toEqual(["profile"]);
    expect(result.current.isLoading).toBe(false);
  });

  // An agent-server publishes a start's first report before the agent has
  // sent its menu; the menu follows in a later report.
  it("shows no agent commands after an empty first report until the agent's menu arrives", async () => {
    vi.mocked(EventService.searchEvents).mockResolvedValue({
      items: [{ ...controlsEvent, available_commands: [] }],
      next_page_id: null,
    });
    const { result } = renderControls();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.commands).toEqual([]);
    expect(result.current.options.map(({ id }) => id)).toEqual(["profile"]);

    act(() => {
      useEventStore.getState().clearEventsForConversation("conv-1");
      useEventStore.getState().addEvent({
        ...controlsEvent,
        id: "controls-2",
        timestamp: "2026-10-01T10:00:01Z",
      });
    });

    await waitFor(() =>
      expect(result.current.commands.map(({ name }) => name)).toEqual([
        "summarize",
      ]),
    );
  });

  // @spec ASC-004 — Only where the agent-server supports them
  it.each([
    [
      "an OpenHands conversation",
      () => (conversation.data = { agent_kind: "openhands" }),
    ],
    [
      "an agent-server without acp_session_controls_v1",
      () => vi.mocked(localAgentServerHasCapability).mockReturnValue(false),
    ],
    ["a Cloud backend", () => setActiveSelection({ backendId: "cloud" })],
  ])(
    "has no controls, and searches nothing, for %s",
    async (_label, arrange) => {
      arrange();

      const { result } = renderControls();
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });

      expect(result.current).toBe(NO_AGENT_CONTROLS);
      expect(EventService.searchEvents).not.toHaveBeenCalled();
    },
  );

  it("sets a pick live, showing it in flight until the agent answers", async () => {
    let answer: () => void = () => undefined;
    const set = vi
      .spyOn(AgentServerConversationService, "setAcpConfigOption")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = () =>
              resolve({
                applied: true,
                controls: {
                  available_commands: [],
                  config_options: [],
                },
              });
          }),
      );
    const { result } = renderControls();
    await waitFor(() => expect(result.current.options).toHaveLength(1));

    act(() => result.current.setOption("profile", "thorough"));

    await waitFor(() =>
      expect(result.current.pendingValues).toEqual({ profile: "thorough" }),
    );
    expect(set).toHaveBeenCalledWith("conv-1", "profile", "thorough");
    await act(async () => answer());
    await waitFor(() => expect(result.current.pendingValues).toEqual({}));
  });

  it("shows the agent's own sentence when it refuses a pick", async () => {
    vi.spyOn(
      AgentServerConversationService,
      "setAcpConfigOption",
    ).mockRejectedValue(
      Object.assign(new Error("HTTP request failed (422)"), {
        name: "HttpError",
        status: 422,
        response: {
          detail:
            "profile is fixed once the session has started (it is 'fast')",
        },
      }),
    );
    const { result } = renderControls();
    await waitFor(() => expect(result.current.options).toHaveLength(1));

    act(() => result.current.setOption("profile", "thorough"));

    await waitFor(() =>
      expect(displayErrorToast).toHaveBeenCalledWith(
        "profile is fixed once the session has started (it is 'fast')",
      ),
    );
  });

  it("never shows a 5xx answer's placeholder detail as the agent's sentence", async () => {
    const failure = Object.assign(new Error("HTTP request failed (504)"), {
      name: "HttpError",
      status: 504,
      response: {
        detail: "Internal Server Error",
        exception: "504: Timed out waiting for the ACP agent",
      },
    });
    vi.spyOn(
      AgentServerConversationService,
      "setAcpConfigOption",
    ).mockRejectedValue(failure);
    const { result } = renderControls();
    await waitFor(() => expect(result.current.options).toHaveLength(1));

    act(() => result.current.setOption("profile", "thorough"));

    await waitFor(() =>
      expect(displayErrorToast).toHaveBeenCalledWith(failure.message),
    );
  });
});
