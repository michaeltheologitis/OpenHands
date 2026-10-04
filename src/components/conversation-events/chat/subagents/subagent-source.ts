import React from "react";
import { useEventStore } from "#/stores/use-event-store";
import type { OpenHandsEvent } from "#/types/agent-server/core";
import {
  buildSubagentIndex,
  type SubagentIndex,
} from "#/utils/subagents/subagent-index";

export interface SubagentSourceState {
  subagents: SubagentIndex;
}

/**
 * Where sub-agent components read the index from. `useEventStore` satisfies
 * it as it is (it has `getState` and `subscribe`); a read-only view passes one
 * built from its own events.
 */
export interface SubagentSource {
  getState: () => SubagentSourceState;
  subscribe: (listener: () => void) => () => void;
  /** A read-only view (a shared conversation): never offer Stop. */
  readonly readOnly?: boolean;
}

/** Defaults to the live event store: a live conversation needs no provider. */
export const SubagentSourceContext =
  React.createContext<SubagentSource>(useEventStore);

/**
 * True when no older history remains to load, so a child whose parent link is
 * still missing is final ("could not be placed", or its fallback anchor).
 * Defaults to true.
 */
export const SubagentHistoryContext = React.createContext(true);

/**
 * Select from the nearest source's index. `selector` must return a stored
 * reference or a primitive (useSyncExternalStore compares by `Object.is`).
 */
export function useSubagents<T>(selector: (index: SubagentIndex) => T): T {
  const source = React.useContext(SubagentSourceContext);
  const select = () => selector(source.getState().subagents);
  return React.useSyncExternalStore(source.subscribe, select, select);
}

const NEVER_CHANGES = () => () => {};

/** A read-only source over a fixed list of events, rebuilt when it changes. */
export function useStaticSubagentSource(
  events: readonly OpenHandsEvent[],
): SubagentSource {
  return React.useMemo(() => {
    const state = { subagents: buildSubagentIndex(events) };
    return { getState: () => state, subscribe: NEVER_CHANGES, readOnly: true };
  }, [events]);
}
