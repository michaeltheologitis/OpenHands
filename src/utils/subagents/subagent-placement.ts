import {
  compareTimestamps,
  ROOT_SESSION,
  routeKey,
  toSessionRef,
  toolCallKey,
  type PendingSubagent,
  type SessionRef,
  type SubagentAnchor,
  type SubagentPlacement,
  type SubagentRecord,
  type SubagentRecords,
  type SubagentSummary,
} from "./subagent-index";
import { summarizeSubagents } from "./subagent-status";

export interface PlacementResult {
  placement: SubagentPlacement;
  needsOlderHistory: boolean;
}

type Entry = [sessionId: string, record: SubagentRecord];

/** What a parent with no anchored children renders; one shared reference. */
export const NO_SUBAGENT_ANCHORS: readonly SubagentAnchor[] = [];

const byFirstAt = ([, a]: Entry, [, b]: Entry) =>
  compareTimestamps(a.firstAt, b.firstAt);

const byAt = (a: SubagentAnchor, b: SubagentAnchor) =>
  compareTimestamps(a.at, b.at);

const append = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

/** The parent is loaded, and walking up from it never comes back around. */
const hasPlaceableAncestry = (
  sessionId: string,
  parent: SessionRef,
  children: SubagentRecords["children"],
) => {
  const seen = new Set([sessionId]);
  let current = parent;
  while (current !== ROOT_SESSION) {
    const record = children.get(current);
    if (!record || seen.has(current)) return false;
    seen.add(current);
    current = toSessionRef(record.latest.parent_session_id);
  }
  return true;
};

/** S1 §5 rule 2's fallbacks: the parent's message to the child, else its announcement. */
const fallbackAnchor = (
  [sessionId, record]: Entry,
  parent: SessionRef,
  { firstMessageTo, messages }: SubagentRecords,
): SubagentAnchor => {
  const key = firstMessageTo.get(routeKey(parent, sessionId));
  const task = key === undefined ? undefined : messages.get(key);
  return task
    ? { sessionId, at: task.firstAt, via: "message" }
    : { sessionId, at: record.firstAt, via: "announcement" };
};

const sameAnchor = (a: SubagentAnchor | null, b: SubagentAnchor | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.sessionId === b.sessionId &&
    a.at === b.at &&
    a.via === b.via);

const samePending = (a: PendingSubagent, b: PendingSubagent) =>
  a.sessionId === b.sessionId &&
  a.reason === b.reason &&
  a.missingId === b.missingId &&
  a.parentSessionRef === b.parentSessionRef &&
  sameAnchor(a.fallback, b.fallback);

const sameSummary = (a: SubagentSummary, b: SubagentSummary) =>
  (Object.keys(a) as (keyof SubagentSummary)[]).every(
    (count) => a[count] === b[count],
  );

const sameId = (a: string, b: string) => a === b;

/** `previous` when it holds equal items in the same order, else `next`. */
const reuseList = <T>(
  previous: readonly T[] | undefined,
  next: readonly T[],
  same: (a: T, b: T) => boolean,
): readonly T[] =>
  previous?.length === next.length &&
  next.every((item, index) => same(previous[index], item))
    ? previous
    : next;

/** `previous` when every entry of `next` is the same object, else `next`. */
const reuseMap = <K, V>(
  previous: ReadonlyMap<K, V>,
  next: ReadonlyMap<K, V>,
): ReadonlyMap<K, V> => {
  if (previous.size !== next.size) return next;
  for (const [key, value] of next) {
    if (previous.get(key) !== value) return next;
  }
  return previous;
};

const reuseLists = <K, V>(
  previous: ReadonlyMap<K, readonly V[]>,
  next: Map<K, V[]>,
  same: (a: V, b: V) => boolean,
): ReadonlyMap<K, readonly V[]> =>
  reuseMap(
    previous,
    new Map(
      [...next].map(([key, list]) => [
        key,
        reuseList(previous.get(key), list, same),
      ]),
    ),
  );

/**
 * S1 §5 rules 1–2 over the loaded records, with partial history: a child
 * whose parent session or named spawning call is not loaded is pending, not
 * misplaced. Reuses `previous`'s arrays, maps and summaries wherever the
 * result is equal, so selectors keep their references.
 */
export function placeSubagents(
  records: SubagentRecords,
  previous: SubagentPlacement,
): PlacementResult {
  const { children, toolCalls, transcripts } = records;
  const cells = new Map<string, string[]>();
  const anchors = new Map<SessionRef, SubagentAnchor[]>();
  const pending: PendingSubagent[] = [];

  for (const entry of [...children].sort(byFirstAt)) {
    const [sessionId, { latest }] = entry;
    const parent = toSessionRef(latest.parent_session_id);
    if (!hasPlaceableAncestry(sessionId, parent, children)) {
      pending.push({
        sessionId,
        reason: "parent-session",
        missingId: parent,
        parentSessionRef: parent,
        fallback: null,
      });
      continue;
    }
    const fallback = fallbackAnchor(entry, parent, records);
    const cell = latest.parent_tool_call_id;
    if (!cell) {
      append(anchors, parent, fallback);
    } else if (toolCalls.has(toolCallKey(parent, cell))) {
      append(cells, toolCallKey(parent, cell), sessionId);
    } else {
      pending.push({
        sessionId,
        reason: "parent-call",
        missingId: cell,
        parentSessionRef: parent,
        fallback,
      });
    }
  }
  anchors.forEach((list) => list.sort(byAt));

  const byCell = reuseLists(previous.byCell, cells, sameId);
  const summaries = new Map(
    [...byCell].map(([cellKey, sessionIds]) => {
      const summary = summarizeSubagents(
        sessionIds.map((id) => children.get(id)!),
      );
      const held = previous.cellSummaries.get(cellKey);
      return [cellKey, held && sameSummary(held, summary) ? held : summary];
    }),
  );
  const placement: SubagentPlacement = {
    byCell,
    byAnchor: reuseLists(previous.byAnchor, anchors, sameAnchor),
    pending: reuseList(previous.pending, pending, samePending),
    cellSummaries: reuseMap(previous.cellSummaries, summaries),
  };

  const needsOlderHistory =
    pending.length > 0 ||
    [...byCell.keys()].some((key) => !toolCalls.get(key)?.startLoaded) ||
    [...transcripts.keys()].some((sessionId) => !children.has(sessionId));

  const unchanged = (
    Object.keys(placement) as (keyof SubagentPlacement)[]
  ).every((part) => placement[part] === previous[part]);
  return { placement: unchanged ? previous : placement, needsOlderHistory };
}

/**
 * The anchors a parent's flow renders: the placed ones, plus, once history is
 * complete, the fallbacks of children whose spawning call never turned up.
 * Sorted by `at`; returns `placed` itself when nothing is added.
 */
export function anchorsForParent(
  placed: readonly SubagentAnchor[],
  pending: readonly PendingSubagent[],
  parent: SessionRef,
  historyComplete: boolean,
): readonly SubagentAnchor[] {
  if (!historyComplete) return placed;
  const fallbacks = pending.flatMap(({ reason, parentSessionRef, fallback }) =>
    reason === "parent-call" && parentSessionRef === parent && fallback
      ? [fallback]
      : [],
  );
  return fallbacks.length === 0 ? placed : [...placed, ...fallbacks].sort(byAt);
}

export interface UnplacedGroup {
  /** The parent session id the conversation does not contain. */
  missingParentId: string;
  sessionIds: readonly string[];
}

/** Children whose parent session is not in the conversation, by parent. */
export function unplacedGroups(
  pending: readonly PendingSubagent[],
): readonly UnplacedGroup[] {
  const groups = new Map<string, string[]>();
  for (const { reason, missingId, sessionId } of pending) {
    if (reason === "parent-session") append(groups, missingId, sessionId);
  }
  return [...groups].map(([missingParentId, sessionIds]) => ({
    missingParentId,
    sessionIds,
  }));
}
