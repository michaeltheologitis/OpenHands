/**
 * The sub-agent index: every ACP sub-agent session's records, folded from the
 * conversation's events in whatever order the pages bring them, and where
 * each child is placed.
 *
 * Every record is an upsert keyed so that "latest wins" is one lookup: it
 * holds its newest event, a tie going to the later arrival, and the timestamp
 * of its earliest loaded event, which is where it sits. A fold copies each
 * map it changes once and keeps every record, transcript and list it leaves
 * alone, so a selector sees a change only in its own slice, and placement is
 * recomputed only when the fold changed something placement reads.
 */
import type { OpenHandsEvent } from "#/types/agent-server/core";
import type { BaseEvent } from "#/types/agent-server/core/base/event";
import type { ACPToolCallEvent } from "#/types/agent-server/core/events/acp-tool-call-event";
import type {
  ACPSessionMessageEvent,
  ACPSessionTextEvent,
  ACPSubagentEvent,
} from "#/types/agent-server/core/events/acp-subagent-event";
import {
  isACPSessionMessageEvent,
  isACPSessionTextEvent,
  isACPSubagentEvent,
  isACPToolCallEvent,
} from "#/types/agent-server/type-guards";
import {
  compareTimestamps,
  messageKey,
  ROOT_SESSION,
  routeKey,
  toSessionRef,
  toolCallKey,
  type SessionRef,
} from "./subagent-keys";
import { placeSubagents } from "./subagent-placement";
import type { SubagentSummary } from "./subagent-status";

export interface SubagentRecord {
  /** The newest snapshot in log order, whatever its source. */
  latest: ACPSubagentEvent;
  /** The newest snapshot the agent sent itself; null if only resets loaded. */
  lastConfirmed: ACPSubagentEvent | null;
  /** The earliest loaded snapshot's timestamp: the announcement, once loaded. */
  firstAt: string;
}

export interface ToolCallRecord {
  /** Started, then terminal. */
  latest: ACPToolCallEvent;
  firstAt: string;
  /** A pending or in_progress event of the call is loaded. */
  startLoaded: boolean;
}

export interface MessageRecord {
  latest: ACPSessionMessageEvent;
  firstAt: string;
}

export type TranscriptItem =
  | {
      kind: "tool_call" | "message";
      /** The record's key in `toolCalls` or `messages`. */
      key: string;
      at: string;
    }
  | {
      kind: "text";
      /** Text runs are immutable, so the item holds the event itself. */
      event: ACPSessionTextEvent;
      at: string;
    };

export interface ChildStats {
  /** Tool calls in the child's own transcript (loaded ones). */
  toolCalls: number;
  /** `messageKey` of the newest message the child sent, not to a child. */
  answerKey: string | null;
}

export interface SubagentRecords {
  /** Every known child session, by its ACP session id. */
  children: ReadonlyMap<string, SubagentRecord>;
  /** Every ACP tool call, root and child alike, by `toolCallKey`. */
  toolCalls: ReadonlyMap<string, ToolCallRecord>;
  /** Every directed message, by `messageKey`. */
  messages: ReadonlyMap<string, MessageRecord>;
  /** `routeKey(transcript, recipient)` → `messageKey` of the first one. */
  firstMessageTo: ReadonlyMap<string, string>;
  /** Each child's own transcript, ordered by `at`, then by arrival. */
  transcripts: ReadonlyMap<string, readonly TranscriptItem[]>;
  stats: ReadonlyMap<string, ChildStats>;
}

export interface SubagentAnchor {
  sessionId: string;
  /** Timestamp the child is placed at in its parent's flow. */
  at: string;
  /** The parent's message to the child, else its announcement. */
  via: "message" | "announcement";
}

export interface PendingSubagent {
  sessionId: string;
  /** Which part of the parent link is not in the loaded events. */
  reason: "parent-session" | "parent-call";
  /** The parent session id, or the spawning tool call id, that is missing. */
  missingId: string;
  parentSessionRef: SessionRef;
  /** Where the child goes once history is complete; null: could not be placed. */
  fallback: SubagentAnchor | null;
}

export interface SubagentPlacement {
  /** Children placed in each tool call (`toolCallKey`), announcement order. */
  byCell: ReadonlyMap<string, readonly string[]>;
  /** Children placed in a parent's flow without a loaded spawning call. */
  byAnchor: ReadonlyMap<SessionRef, readonly SubagentAnchor[]>;
  /** Children whose parent session or spawning call is not loaded yet. */
  pending: readonly PendingSubagent[];
  /** The summary line of each spawning tool call, keyed like `byCell`. */
  cellSummaries: ReadonlyMap<string, SubagentSummary>;
}

export interface SubagentIndex extends SubagentRecords {
  placement: SubagentPlacement;
  /** A placement or a spawning call's start waits for an older page. */
  needsOlderHistory: boolean;
  /** Changes whenever anything above changes: a scroll-follow key. */
  version: number;
}

export const EMPTY_SUBAGENT_INDEX: SubagentIndex = {
  children: new Map(),
  toolCalls: new Map(),
  messages: new Map(),
  firstMessageTo: new Map(),
  transcripts: new Map(),
  stats: new Map(),
  placement: {
    byCell: new Map(),
    byAnchor: new Map(),
    pending: [],
    cellSummaries: new Map(),
  },
  needsOlderHistory: false,
  version: 0,
};

/**
 * Fold events into the index. Pure; returns `index` itself when no event
 * concerns ACP sessions, and otherwise a new index that reuses every record,
 * transcript, cell list and summary the events did not change. Each event
 * must be folded once: dedupe by id first, as `buildSubagentIndex` does.
 */
export function foldSubagentEvents(
  index: SubagentIndex,
  events: readonly OpenHandsEvent[],
): SubagentIndex {
  const draft = draftOf(index);
  let placementDirty = false;
  for (const event of events) {
    if (!isFromPlanningAgent(event)) {
      placementDirty = foldEvent(draft, event) || placementDirty;
    }
  }
  draft.answersToCheck.delete(ROOT_SESSION);
  draft.answersToCheck.forEach((sessionId) => updateAnswer(draft, sessionId));

  const records: SubagentRecords = {
    children: draft.children.result(),
    toolCalls: draft.toolCalls.result(),
    messages: draft.messages.result(),
    firstMessageTo: draft.firstMessageTo.result(),
    transcripts: draft.transcripts.result(),
    stats: draft.stats.result(),
  };
  const unchanged = (Object.keys(records) as (keyof SubagentRecords)[]).every(
    (map) => records[map] === index[map],
  );
  if (unchanged) return index;
  const { placement, needsOlderHistory } = placementDirty
    ? placeSubagents(records, index.placement)
    : index;
  return {
    ...records,
    placement,
    needsOlderHistory,
    version: index.version + 1,
  };
}

const isFromPlanningAgent = (event: OpenHandsEvent) =>
  "isFromPlanningAgent" in event && event.isFromPlanningAgent === true;

/** `foldSubagentEvents(EMPTY_SUBAGENT_INDEX, events)`, deduped by event id. */
export function buildSubagentIndex(
  events: readonly OpenHandsEvent[],
): SubagentIndex {
  const seen = new Set<string>();
  const unique = events.filter(({ id }) => {
    if (id === undefined) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return foldSubagentEvents(EMPTY_SUBAGENT_INDEX, unique);
}

/** Each fold step returns whether placement must be recomputed. */
function foldEvent(draft: Draft, event: OpenHandsEvent): boolean {
  if (isACPSubagentEvent(event)) return foldSnapshot(draft, event);
  if (isACPToolCallEvent(event)) return foldToolCall(draft, event);
  if (isACPSessionMessageEvent(event)) return foldMessage(draft, event);
  if (isACPSessionTextEvent(event)) return foldText(draft, event);
  return false;
}

function foldSnapshot(draft: Draft, event: ACPSubagentEvent): boolean {
  const sessionId = event.acp_session_id;
  const held = draft.children.read(sessionId);
  const confirms = event.source !== "environment";
  const next: SubagentRecord = {
    ...upsert(held, event),
    lastConfirmed:
      confirms && isAtLeastAsNew(event, held?.lastConfirmed)
        ? event
        : (held?.lastConfirmed ?? null),
  };
  if (
    held?.latest === next.latest &&
    held.lastConfirmed === next.lastConfirmed &&
    held.firstAt === next.firstAt
  ) {
    return false;
  }
  draft.children.write(sessionId, next);
  if (held && placementFieldsOf(held) === placementFieldsOf(next)) {
    return false;
  }
  // A new child turns its parent's messages to it into its task.
  draft.answersToCheck.add(toSessionRef(next.latest.parent_session_id));
  return true;
}

function foldToolCall(draft: Draft, event: ACPToolCallEvent): boolean {
  const key = toolCallKey(event.acp_session_id, event.tool_call_id);
  const held = draft.toolCalls.read(key);
  const next: ToolCallRecord = {
    ...upsert(held, event),
    startLoaded: (held?.startLoaded ?? false) || isStarted(event),
  };
  draft.toolCalls.write(key, next);
  // A new call may be the spawning call a pending child waits for.
  const dirty = held?.startLoaded !== next.startLoaded;

  const sessionId = event.acp_session_id;
  if (!sessionId || held?.firstAt === next.firstAt) return dirty;
  if (!held) {
    const stats = draft.stats.read(sessionId) ?? NO_STATS;
    draft.stats.write(sessionId, { ...stats, toolCalls: stats.toolCalls + 1 });
  }
  const opened = placeItem(draft, sessionId, {
    kind: "tool_call",
    key,
    at: next.firstAt,
  });
  return dirty || opened;
}

function foldMessage(draft: Draft, event: ACPSessionMessageEvent): boolean {
  const key = messageKey(event.acp_session_id, event.message_id);
  const held = draft.messages.read(key);
  const next: MessageRecord = upsert(held, event);
  draft.messages.write(key, next);
  const sessionId = event.acp_session_id;
  if (sessionId) draft.answersToCheck.add(sessionId);
  if (held?.firstAt === next.firstAt) return false;

  // A new message, or one an older page moved earlier, may be a child's task.
  const recipient = event.recipient_session_id;
  if (recipient) {
    const route = routeKey(sessionId, recipient);
    const first = draft.firstMessageTo.read(route);
    const firstAt = first ? draft.messages.read(first)?.firstAt : undefined;
    if (!firstAt || compareTimestamps(next.firstAt, firstAt) < 0) {
      draft.firstMessageTo.write(route, key);
    }
  }
  if (sessionId) {
    placeItem(draft, sessionId, { kind: "message", key, at: next.firstAt });
  }
  return true;
}

function foldText(draft: Draft, event: ACPSessionTextEvent): boolean {
  if (!event.acp_session_id) return false;
  return placeItem(draft, event.acp_session_id, {
    kind: "text",
    event,
    at: event.timestamp,
  });
}

/** A record's newest event and earliest timestamp, with `event` folded in. */
const upsert = <E extends BaseEvent>(
  held: { latest: E; firstAt: string } | undefined,
  event: E,
) => ({
  latest: held && !isAtLeastAsNew(event, held.latest) ? held.latest : event,
  firstAt: held ? earlier(held.firstAt, event.timestamp) : event.timestamp,
});

/** "Latest" is the newer timestamp; an equal one arrived later, so it wins. */
const isAtLeastAsNew = (event: BaseEvent, held: BaseEvent | null | undefined) =>
  !held || compareTimestamps(event.timestamp, held.timestamp) >= 0;

const earlier = (a: string, b: string) =>
  compareTimestamps(a, b) <= 0 ? a : b;

const isStarted = (event: ACPToolCallEvent) =>
  event.status === "pending" || event.status === "in_progress";

/** What placement and the cell summaries read from a child's record. */
const placementFieldsOf = ({
  latest,
  lastConfirmed,
  firstAt,
}: SubagentRecord) =>
  JSON.stringify([
    firstAt,
    latest.parent_session_id,
    latest.parent_tool_call_id,
    latest.state,
    latest.stop_reason,
    latest.cancellable,
    latest.source,
    lastConfirmed?.state,
    lastConfirmed?.stop_reason,
  ]);

/**
 * The transcript's array, copied once per fold before it is changed, and
 * whether this opens it: a session's first item may belong to a child whose
 * announcement is not loaded, which placement must hear about.
 */
function ownTranscript(draft: Draft, sessionId: string) {
  const owned = draft.ownedTranscripts.get(sessionId);
  if (owned) return { items: owned, opened: false };
  const existing = draft.transcripts.read(sessionId);
  const items = existing ? [...existing] : [];
  draft.ownedTranscripts.set(sessionId, items);
  draft.transcripts.write(sessionId, items);
  return { items, opened: !existing };
}

/**
 * Insert after every item at or before `item.at`, so equal timestamps keep
 * arrival order; a call's or message's item an older page moved earlier is
 * taken out first. Returns whether this opened the transcript.
 */
function placeItem(
  draft: Draft,
  sessionId: string,
  item: TranscriptItem,
): boolean {
  const { items, opened } = ownTranscript(draft, sessionId);
  if (item.kind !== "text") {
    const held = items.findIndex(
      (candidate) => candidate.kind === item.kind && candidate.key === item.key,
    );
    if (held !== -1) items.splice(held, 1);
  }
  let low = 0;
  let high = items.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareTimestamps(items[middle].at, item.at) <= 0) low = middle + 1;
    else high = middle;
  }
  items.splice(low, 0, item);
  return opened;
}

/** The newest message the session sent, other than to its own children. */
function updateAnswer(draft: Draft, sessionId: string) {
  const isAnswer = (item: TranscriptItem) => {
    if (item.kind !== "message") return false;
    const sent = draft.messages.read(item.key)?.latest;
    return (
      sent?.sender_session_id === sessionId &&
      !isChildOf(draft, sent.recipient_session_id ?? "", sessionId)
    );
  };
  const answer = [...(draft.transcripts.read(sessionId) ?? [])]
    .reverse()
    .find(isAnswer);
  const answerKey = answer?.kind === "message" ? answer.key : null;
  const stats = draft.stats.read(sessionId) ?? NO_STATS;
  if (stats.answerKey !== answerKey) {
    draft.stats.write(sessionId, { ...stats, answerKey });
  }
}

const isChildOf = (draft: Draft, sessionId: string, parent: string) => {
  const record = draft.children.read(sessionId);
  return (
    record !== undefined &&
    toSessionRef(record.latest.parent_session_id) === parent
  );
};

/** A map copied on its first write, so a map the fold never writes is kept. */
function writableMap<K, V>(source: ReadonlyMap<K, V>) {
  let copy: Map<K, V> | null = null;
  return {
    read: (key: K) => (copy ?? source).get(key),
    write: (key: K, value: V) => {
      copy ??= new Map(source);
      copy.set(key, value);
    },
    result: (): ReadonlyMap<K, V> => copy ?? source,
  };
}

/** One fold's copy-on-write view of the records. */
function draftOf(index: SubagentIndex) {
  return {
    children: writableMap(index.children),
    toolCalls: writableMap(index.toolCalls),
    messages: writableMap(index.messages),
    firstMessageTo: writableMap(index.firstMessageTo),
    transcripts: writableMap(index.transcripts),
    stats: writableMap(index.stats),
    /** Transcripts already copied in this fold, safe to change in place. */
    ownedTranscripts: new Map<string, TranscriptItem[]>(),
    /** Sessions whose answer may have changed. */
    answersToCheck: new Set<string>(),
  };
}

type Draft = ReturnType<typeof draftOf>;

const NO_STATS: ChildStats = { toolCalls: 0, answerKey: null };
