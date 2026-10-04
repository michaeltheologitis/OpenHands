import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ACPSessionControlsEvent } from "@openhands/typescript-client";
import EventService from "#/api/event-service/event-service.api";
import { useLatestAcpSessionControls } from "#/hooks/query/use-latest-acp-session-controls";
import { useEventStore } from "#/stores/use-event-store";
import { createQueryWrapper } from "../../helpers/query-wrapper";

const CONVERSATION_ID = "conv-controls";

function controlsEvent(
  id: string,
  timestamp: string,
  commands: string[],
): ACPSessionControlsEvent {
  return {
    id,
    kind: "ACPSessionControlsEvent",
    timestamp,
    source: "agent",
    available_commands: commands.map((name) => ({ name, description: name })),
    config_options: [],
  };
}

const renderLatest = (conversationId = CONVERSATION_ID) =>
  renderHook(() => useLatestAcpSessionControls(conversationId, true), {
    wrapper: createQueryWrapper(),
  });

function seedLiveEvents(...events: ACPSessionControlsEvent[]) {
  useEventStore.setState({
    events,
    eventIds: new Set(events.map((event) => String(event.id))),
    loadedConversationId: CONVERSATION_ID,
  });
}

function answerSearchWith(event: ACPSessionControlsEvent | null) {
  return vi
    .spyOn(EventService, "searchEvents")
    .mockResolvedValue({ items: event ? [event] : [], next_page_id: null });
}

describe("useLatestAcpSessionControls", () => {
  beforeEach(() => {
    useEventStore.getState().clearEvents();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("searches the conversation's newest controls event by its module-qualified kind", async () => {
    const search = answerSearchWith(null);

    renderLatest();

    await waitFor(() =>
      expect(search).toHaveBeenCalledWith(CONVERSATION_ID, null, null, {
        // The search matches module-qualified class names; events still
        // carry the short kind.
        kind: "openhands.sdk.event.acp_session_controls.ACPSessionControlsEvent",
        sortOrder: "TIMESTAMP_DESC",
        limit: 1,
      }),
    );
  });

  it.each([
    [
      "an older searched event loses to the live one",
      "2026-10-01T10:00:00Z",
      "live",
    ],
    [
      "a newer searched event wins over the live one",
      "2026-10-01T12:00:00Z",
      "searched",
    ],
  ])("%s", async (_label, searchedAt, expectedId) => {
    seedLiveEvents(controlsEvent("live", "2026-10-01T11:00:00Z", ["live"]));
    answerSearchWith(controlsEvent("searched", searchedAt, ["searched"]));

    const { result } = renderLatest();

    await waitFor(() => expect(EventService.searchEvents).toHaveBeenCalled());
    await waitFor(() => expect(result.current?.id).toBe(expectedId));
  });

  it("keeps the newest of several live events", async () => {
    seedLiveEvents(
      controlsEvent("first", "2026-10-01T10:00:00Z", ["first"]),
      controlsEvent("second", "2026-10-01T11:00:00Z", []),
    );
    answerSearchWith(null);

    const { result } = renderLatest();

    await waitFor(() => expect(result.current?.id).toBe("second"));
  });

  it("is null when the conversation has no controls event", async () => {
    const search = answerSearchWith(null);

    const { result } = renderLatest();

    await waitFor(() => expect(search).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("ignores live events loaded for another conversation", async () => {
    seedLiveEvents(controlsEvent("live", "2026-10-01T11:00:00Z", ["live"]));
    answerSearchWith(null);

    const { result } = renderLatest("another-conversation");

    await waitFor(() => expect(EventService.searchEvents).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });
});
