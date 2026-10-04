import { useQuery } from "@tanstack/react-query";
import {
  ACP_SESSION_CONTROLS_EVENT_KIND,
  isACPSessionControlsEvent,
  type ACPSessionControlsEvent,
} from "@openhands/typescript-client";
import EventService from "#/api/event-service/event-service.api";
import { useActiveBackend } from "#/contexts/active-backend-context";
import { ACP_SESSION_CONTROLS_QUERY_KEYS } from "#/hooks/query/query-keys";
import { useEventStore, type OHEvent } from "#/stores/use-event-store";

function newestControlsEvent(
  events: readonly OHEvent[],
): ACPSessionControlsEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if ("kind" in event && isACPSessionControlsEvent(event)) return event;
  }
  return null;
}

/**
 * The conversation's newest `ACPSessionControlsEvent`: the newer, by
 * timestamp, of the event store's newest one (live and preloaded events) and
 * one REST search for it by kind, which finds it however long ago it was sent.
 * Replaced, never merged: each event carries both lists in full. While
 * disabled it neither searches nor scans the event store.
 */
export function useLatestAcpSessionControls(
  conversationId: string | null,
  enabled: boolean,
): ACPSessionControlsEvent | null {
  const { backend } = useActiveBackend();
  const live = useEventStore((state) =>
    enabled && state.loadedConversationId === conversationId
      ? newestControlsEvent(state.events)
      : null,
  );
  const { data: searched = null } = useQuery({
    queryKey: ACP_SESSION_CONTROLS_QUERY_KEYS.latest(
      backend.id,
      conversationId ?? "",
    ),
    queryFn: async () => {
      const page = await EventService.searchEvents(
        conversationId!,
        null,
        null,
        {
          kind: ACP_SESSION_CONTROLS_EVENT_KIND,
          sortOrder: "TIMESTAMP_DESC",
          limit: 1,
        },
      );
      return newestControlsEvent([...page.items].reverse());
    },
    enabled: enabled && !!conversationId,
    staleTime: Infinity,
    retry: false,
    meta: { disableToast: true },
  });

  if (!live || !searched) return live ?? searched;
  return (searched.timestamp ?? "") > (live.timestamp ?? "") ? searched : live;
}
