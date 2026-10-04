import type { ACPSubagentEvent } from "#/types/agent-server/core/events/acp-subagent-event";
import type { SubagentRecord } from "./subagent-index";

export type SubagentStatusCategory =
  | "running"
  | "waiting"
  | "done"
  | "stopped"
  | "limited"
  | "refused"
  | "unconfirmed"
  | "other";

/** How many of one call's children are in each category, and in all. */
export type SubagentSummary = Record<SubagentStatusCategory | "total", number>;

export interface SubagentStatus {
  category: SubagentStatusCategory;
  /** `state` or `state / stop_reason`; `other` shows it as reported. */
  reported: string | null;
  /**
   * The status is the last one the agent confirmed before the agent-server's
   * ACP connection was replaced. Never a spinner, never Stop.
   */
  stale: boolean;
  /**
   * For an unconfirmed child whose last confirmed state was active, that
   * state's category ("running · last known"); null otherwise.
   */
  lastKnown: SubagentStatusCategory | null;
}

const ACTIVE_STATES: ReadonlyMap<string, SubagentStatusCategory> = new Map([
  ["running", "running"],
  ["requires_action", "waiting"],
]);

const IDLE_CATEGORIES: ReadonlyMap<string, SubagentStatusCategory> = new Map([
  ["end_turn", "done"],
  ["cancelled", "stopped"],
  ["max_tokens", "limited"],
  ["max_turn_requests", "limited"],
  ["refusal", "refused"],
]);

const USD = "USD";
const COST_DECIMALS = 4;

const reportedOf = (snapshot: ACPSubagentEvent): string | null => {
  if (!snapshot.state) return null;
  return snapshot.stop_reason
    ? `${snapshot.state} / ${snapshot.stop_reason}`
    : snapshot.state;
};

/** The category of a snapshot that carries a state the agent confirmed. */
const categoryOf = (snapshot: ACPSubagentEvent): SubagentStatusCategory => {
  const state = snapshot.state ?? "";
  const active = ACTIVE_STATES.get(state);
  if (active) return active;
  if (state !== "idle") return "other";
  if (!snapshot.stop_reason) return "done";
  return IDLE_CATEGORIES.get(snapshot.stop_reason) ?? "other";
};

const isUnconfirmed = (snapshot: ACPSubagentEvent) =>
  snapshot.source === "environment" || !snapshot.state;

const isActive = (snapshot: ACPSubagentEvent) =>
  !isUnconfirmed(snapshot) && ACTIVE_STATES.has(snapshot.state ?? "");

export function getSubagentStatus(record: SubagentRecord): SubagentStatus {
  const { latest, lastConfirmed } = record;
  if (!isUnconfirmed(latest)) {
    return {
      category: categoryOf(latest),
      reported: reportedOf(latest),
      stale: false,
      lastKnown: null,
    };
  }
  if (!lastConfirmed?.state) {
    return {
      category: "unconfirmed",
      reported: null,
      stale: false,
      lastKnown: null,
    };
  }
  const confirmed = categoryOf(lastConfirmed);
  const wasActive = ACTIVE_STATES.has(lastConfirmed.state);
  return {
    category: wasActive ? "unconfirmed" : confirmed,
    reported: reportedOf(lastConfirmed),
    stale: true,
    lastKnown: wasActive ? confirmed : null,
  };
}

/** Running or waiting, confirmed on the live connection, with `cancel`. */
export function canStopSubagent(record: SubagentRecord): boolean {
  return isActive(record.latest) && record.latest.cancellable === true;
}

/** Running or waiting, confirmed, without `cancel`: Stop shown disabled. */
export function isStopWithheld(record: SubagentRecord): boolean {
  return isActive(record.latest) && record.latest.cancellable !== true;
}

/** `$0.0004` for USD (Canvas's own format), `0.0004 EUR` otherwise. */
export function formatSubagentCost(
  cost: number | null | undefined,
  currency: string | null | undefined,
): string | null {
  if (cost === null || cost === undefined) return null;
  const amount = cost.toFixed(COST_DECIMALS);
  if (currency === USD) return `$${amount}`;
  return currency ? `${amount} ${currency}` : amount;
}

export function summarizeSubagents(
  records: readonly SubagentRecord[],
): SubagentSummary {
  const summary: SubagentSummary = {
    total: records.length,
    running: 0,
    waiting: 0,
    done: 0,
    stopped: 0,
    limited: 0,
    refused: 0,
    unconfirmed: 0,
    other: 0,
  };
  for (const record of records) {
    summary[getSubagentStatus(record).category] += 1;
  }
  return summary;
}
