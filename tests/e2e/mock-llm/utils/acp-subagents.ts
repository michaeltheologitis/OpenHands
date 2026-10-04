/**
 * Helpers for driving ACP agents with sub-agent sessions through the real
 * agent-server: the SDK's scripted ACP agent, the rendered and the stored
 * sub-agent trees, a generated fan-out transcript and a scroll probe.
 *
 * The page-side readers select only through the stable test ids of
 * specs/acp-subagent-sessions.md (SUB-011).
 */

import { delimiter, join, resolve } from "node:path";
import { writeFile } from "node:fs/promises";
import { expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  BACKEND_URL,
  MOCK_ACP_COMMAND_PYTHON,
  SESSION_API_KEY,
  dismissAnalyticsModal,
  getConversationIdFromURL,
  setChatInput,
  waitForPath,
  waitForTestId,
} from "./mock-llm-helpers";

const API_HEADERS = {
  "X-Session-API-Key": SESSION_API_KEY,
  "Content-Type": "application/json",
};

/**
 * Absolute path of the SDK's scripted ACP agent
 * (`tests/fixtures/acp/scripted_agent.py` in a checkout of the pinned SDK),
 * from `SCRIPTED_ACP_AGENT`; null when unset.
 */
export const SCRIPTED_ACP_AGENT: string | null = process.env.SCRIPTED_ACP_AGENT
  ? resolve(process.env.SCRIPTED_ACP_AGENT)
  : null;

/** The agent profile the scripted agent runs as. */
const SCRIPTED_ACP_PROFILE = "scripted-acp-subagents";

export interface ScriptedAcpAgentOptions {
  /** Flags after the script, e.g. `["--subagents", "--cancel-wait", "30"]`. */
  flags: readonly string[];
  /** Write `acp_subagents: true` on the profile: the opt-in. */
  subagents: boolean;
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

/** Save and activate an ACP agent profile that runs the scripted agent. */
export async function configureScriptedAcpAgent(
  request: APIRequestContext,
  { flags, subagents }: ScriptedAcpAgentOptions,
): Promise<void> {
  if (!SCRIPTED_ACP_AGENT) throw new Error("SCRIPTED_ACP_AGENT is not set");
  const command = [MOCK_ACP_COMMAND_PYTHON, SCRIPTED_ACP_AGENT, ...flags]
    .map(shellQuote)
    .join(" ");
  const profileUrl = `${BACKEND_URL}/api/agent-profiles/${SCRIPTED_ACP_PROFILE}`;
  const saved = await request.post(profileUrl, {
    headers: API_HEADERS,
    data: {
      agent_kind: "acp",
      acp_server: "custom",
      acp_command: command,
      acp_subagents: subagents,
    },
  });
  expect(saved.ok(), `save the scripted ACP profile: ${saved.status()}`).toBe(
    true,
  );
  const detail = await request.get(profileUrl, { headers: API_HEADERS });
  const { profile } = (await detail.json()) as {
    profile: { id: string; acp_subagents?: boolean };
  };
  expect(profile.acp_subagents, "the profile keeps the opt-in").toBe(subagents);
  const activated = await request.post(
    `${BACKEND_URL}/api/agent-profiles/${encodeURIComponent(profile.id)}/activate`,
    { headers: API_HEADERS, data: {} },
  );
  expect(
    activated.ok(),
    `activate the scripted ACP profile: ${activated.status()}`,
  ).toBe(true);
}

/** Remove the scripted agent's profile; no other profile is activated. */
export async function deleteScriptedAcpAgent(request: APIRequestContext) {
  await request.delete(
    `${BACKEND_URL}/api/agent-profiles/${SCRIPTED_ACP_PROFILE}`,
    { headers: API_HEADERS },
  );
}

/**
 * Transcripts the replay spec plays, from `OH_ACP_REPLAY_TRANSCRIPTS`: file
 * paths separated by the platform's path delimiter (`:` on Linux and macOS).
 * Empty when unset.
 */
export const REPLAY_TRANSCRIPTS: readonly string[] = (
  process.env.OH_ACP_REPLAY_TRANSCRIPTS ?? ""
)
  .split(delimiter)
  .filter(Boolean)
  .map((path) => resolve(path));

/** Start a conversation from the home page with the active agent profile. */
export async function startConversation(page: Page, message: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await dismissAnalyticsModal(page);
  await waitForTestId(page, "home-chat-launcher");
  await setChatInput(page, message);
  await page.getByTestId("submit-button").click();
  await waitForPath(page, /\/conversations\/.+/, 30_000);
  return getConversationIdFromURL(page);
}

interface StoredEvent {
  kind?: string;
  timestamp: string;
  acp_session_id?: string | null;
  parent_session_id?: string | null;
  parent_tool_call_id?: string | null;
  tool_call_id?: string;
  state?: string | null;
  cost?: number | null;
  action?: { kind?: string };
}

const SEARCH_PAGE_LIMIT = 100;

/** Every stored event of the conversation, in log order, from the REST route. */
export async function readStoredEvents(
  request: APIRequestContext,
  conversationId: string,
): Promise<StoredEvent[]> {
  const events: StoredEvent[] = [];
  let pageId: string | undefined;
  do {
    const response = await request.get(
      `${BACKEND_URL}/api/conversations/${encodeURIComponent(conversationId)}/events/search`,
      {
        headers: API_HEADERS,
        params: {
          limit: String(SEARCH_PAGE_LIMIT),
          sort_order: "TIMESTAMP",
          ...(pageId ? { page_id: pageId } : {}),
        },
      },
    );
    expect(response.ok(), `events search: ${response.status()}`).toBe(true);
    const page = (await response.json()) as {
      items: StoredEvent[];
      next_page_id?: string | null;
    };
    events.push(...page.items);
    pageId = page.next_page_id ?? undefined;
  } while (pageId);
  return events;
}

/** Wait until the conversation's turns have ended (one FinishAction each). */
export async function waitForTurnsToEnd(
  request: APIRequestContext,
  conversationId: string,
  { turns = 1, timeout = 120_000 } = {},
) {
  await expect
    .poll(
      async () =>
        (await readStoredEvents(request, conversationId)).filter(
          (event) => event.action?.kind === "FinishAction",
        ).length,
      { timeout, intervals: [1_000] },
    )
    .toBeGreaterThanOrEqual(turns);
}

/** One child as a tree shows it: its parent link and its own tool calls. */
export interface SubagentLink {
  sessionId: string;
  /** null for the root session. */
  parentSessionId: string | null;
  /** null when the child is not placed inside a tool call. */
  parentToolCallId: string | null;
  /** The child's own tool calls (not its children's), sorted by id. */
  toolCallIds: readonly string[];
}

const bySessionId = (a: SubagentLink, b: SubagentLink) =>
  a.sessionId.localeCompare(b.sessionId);

// @spec SUB-011 — The test ids and data attributes of the sub-agent tree are stable
const COLLAPSED_TOGGLES =
  '[data-testid="subagent-block-toggle"][aria-expanded="false"], ' +
  '[data-testid="subagent-row-toggle"][aria-expanded="false"]';

/** Turn on the App setting that shows sub-agent costs, as a user does. */
export async function showSubagentCosts(page: Page): Promise<void> {
  await page.goto("/settings/app", { waitUntil: "domcontentloaded" });
  const toggle = page.getByTestId("show-subagent-costs-switch");
  await page.locator("label", { has: toggle }).click();
  await expect(toggle).toBeChecked();
}

/** Expand every collapsed sub-agent block and row, until none is left. */
export async function expandAllSubagents(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((selector) => {
          const collapsed = [
            ...document.querySelectorAll<HTMLElement>(selector),
          ];
          collapsed.forEach((toggle) => toggle.click());
          return collapsed.length;
        }, COLLAPSED_TOGGLES),
      { intervals: [200], timeout: 30_000 },
    )
    .toBe(0);
}

/**
 * The tree as the DOM nests it: each row's parent is its nearest enclosing
 * row (or the root; or, apart, the missing parent its group names), its tool
 * call the nearest enclosing ACP cell inside that parent, and its own calls
 * the ACP cells whose nearest enclosing row is it. Reads nesting only, never
 * a row's own claims.
 */
export async function readRenderedSubagentTree(
  page: Page,
): Promise<readonly SubagentLink[]> {
  const links = await page.evaluate(() => {
    const ROW = '[data-testid="subagent-row"]';
    const CELL = '[data-testid="acp-tool-call"]';
    const UNPLACED = '[data-testid="subagent-unplaced"]';
    const nearest = (element: Element, selector: string) =>
      element.parentElement?.closest(selector) ?? null;
    const rows = [...document.querySelectorAll(ROW)];
    const cells = [...document.querySelectorAll(CELL)];
    return rows.map((row) => {
      const parentRow = nearest(row, ROW);
      const cell = nearest(row, CELL);
      const inParent = cell && (!parentRow || parentRow.contains(cell));
      return {
        sessionId: row.getAttribute("data-acp-session-id") ?? "",
        parentSessionId: parentRow
          ? parentRow.getAttribute("data-acp-session-id")
          : (nearest(row, UNPLACED)?.getAttribute(
              "data-missing-parent-session-id",
            ) ?? null),
        parentToolCallId: inParent
          ? cell.getAttribute("data-acp-tool-call-id")
          : null,
        toolCallIds: cells
          .filter((candidate) => nearest(candidate, ROW) === row)
          .map((candidate) => candidate.getAttribute("data-acp-tool-call-id"))
          .filter((id): id is string => id !== null)
          .sort(),
      };
    });
  });
  return links.sort(bySessionId);
}

/**
 * The tree as stored: the newest ACPSubagentEvent per child and the
 * ACPToolCallEvents per session, from the events search route; a
 * `parentToolCallId` that names no stored call becomes null.
 */
export async function readStoredSubagentTree(
  request: APIRequestContext,
  conversationId: string,
): Promise<readonly SubagentLink[]> {
  const events = await readStoredEvents(request, conversationId);
  const latest = new Map<string, StoredEvent>();
  const calls = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.kind === "ACPSubagentEvent" && event.acp_session_id) {
      latest.set(event.acp_session_id, event);
    } else if (event.kind === "ACPToolCallEvent" && event.tool_call_id) {
      const session = event.acp_session_id ?? "";
      calls.set(
        session,
        (calls.get(session) ?? new Set()).add(event.tool_call_id),
      );
    }
  }
  return [...latest]
    .map(([sessionId, snapshot]) => {
      const parent = snapshot.parent_session_id ?? null;
      const cell = snapshot.parent_tool_call_id ?? null;
      return {
        sessionId,
        parentSessionId: parent,
        parentToolCallId:
          cell && calls.get(parent ?? "")?.has(cell) ? cell : null,
        toolCallIds: [...(calls.get(sessionId) ?? [])].sort(),
      };
    })
    .sort(bySessionId);
}

export interface FanoutTranscriptOptions {
  children: number;
  cellsPerChild: number;
}

const ROOT_SESSION_ID = "fanout-root";
const FANOUT_CELL = "fanout-cell";
const FANOUT_STEP_COST = 0.0001;

const update = (sessionId: string, body: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  method: "session/update",
  params: { sessionId, update: body },
});

/**
 * Write an agent-outgoing JSONL transcript, in the scripted agent's format, of
 * one root cell fanning out to `children` sub-agents with `cellsPerChild`
 * cells each, each cell a thought, a call and a cost report, interleaved as
 * concurrent children are; returns the file's path.
 */
export async function writeFanoutTranscript(
  directory: string,
  { children, cellsPerChild }: FanoutTranscriptOptions,
): Promise<string> {
  const ids = Array.from({ length: children }, (_, i) => `fanout-${i + 1}`);
  const lines: unknown[] = [
    {
      jsonrpc: "2.0",
      id: 0,
      result: {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        authMethods: [],
      },
    },
    { jsonrpc: "2.0", id: 1, result: { sessionId: ROOT_SESSION_ID } },
    update(ROOT_SESSION_ID, {
      sessionUpdate: "tool_call",
      toolCallId: FANOUT_CELL,
      title: `Run fan_out(${children})`,
      kind: "execute",
      status: "in_progress",
    }),
  ];
  for (const id of ids) {
    lines.push(
      update(ROOT_SESSION_ID, {
        sessionUpdate: "subagent_update",
        sessionId: id,
        title: `Summarize part ${id}`,
        state: { state: "running" },
        capabilities: { cancel: {} },
        _meta: { openhands: { parentToolCallId: FANOUT_CELL } },
      }),
      update(ROOT_SESSION_ID, {
        sessionUpdate: "session_message",
        messageId: `${id}-task`,
        senderSessionId: ROOT_SESSION_ID,
        recipientSessionId: id,
        content: [{ type: "text", text: `Summarize part ${id}.` }],
      }),
    );
  }
  for (let cell = 1; cell <= cellsPerChild; cell += 1) {
    for (const id of ids) {
      const toolCallId = `${id}-c${cell}`;
      lines.push(
        update(id, {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: `Planning step ${cell} of ${id}.` },
        }),
        update(id, {
          sessionUpdate: "tool_call",
          toolCallId,
          title: `Run step ${cell} of ${id}`,
          kind: "execute",
          status: "in_progress",
        }),
        update(id, {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "completed",
          rawOutput: `step ${cell} done`,
        }),
        update(id, {
          sessionUpdate: "usage_update",
          used: 10 * cell,
          size: 1000,
          cost: { amount: FANOUT_STEP_COST * cell, currency: "USD" },
        }),
      );
    }
  }
  for (const id of ids) {
    lines.push(
      update(id, {
        sessionUpdate: "session_message",
        messageId: `${id}-answer`,
        senderSessionId: id,
        recipientSessionId: ROOT_SESSION_ID,
        content: [{ type: "text", text: `Part ${id} is fine.` }],
      }),
      update(ROOT_SESSION_ID, {
        sessionUpdate: "subagent_update",
        sessionId: id,
        state: { state: "idle", stopReason: "end_turn" },
      }),
    );
  }
  lines.push(
    update(ROOT_SESSION_ID, {
      sessionUpdate: "tool_call_update",
      toolCallId: FANOUT_CELL,
      status: "completed",
      rawOutput: `${children} parts summarized`,
    }),
    update(ROOT_SESSION_ID, {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "FANOUT_DONE" },
    }),
    { jsonrpc: "2.0", id: 2, result: { stopReason: "end_turn" } },
  );
  const path = join(directory, `fanout-${children}x${cellsPerChild}.jsonl`);
  await writeFile(
    path,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
  );
  return path;
}

export interface ScrollProbeResult {
  /** Worst delay between a scheduled scroll and the next painted frame. */
  maxScrollLatencyMs: number;
  /** Long tasks observed while the probe ran, in milliseconds. */
  longTasks: readonly number[];
  /** How many scrolls the probe made. */
  scrolls: number;
}

const SCROLL_PROBE_INTERVAL_MS = 250;

/** Scroll the chat every 250 ms until `stop` resolves; report the worst. */
export async function probeScrollResponsiveness(
  page: Page,
  stop: Promise<void>,
): Promise<ScrollProbeResult> {
  await page.evaluate((intervalMs) => {
    const container = document.querySelector<HTMLElement>(
      '[data-testid="chat-scroll-container"]',
    );
    if (!container) throw new Error("no chat scroll container");
    const probe = {
      latencies: [] as number[],
      longTasks: [] as number[],
      stopped: false,
      // When the scroll in flight was due; it counts even if never painted.
      pendingDue: null as number | null,
    };
    (
      window as unknown as { subagentScrollProbe: typeof probe }
    ).subagentScrollProbe = probe;
    new PerformanceObserver((list) => {
      list
        .getEntries()
        .forEach((entry) => probe.longTasks.push(entry.duration));
    }).observe({ type: "longtask" });
    const scheduleScroll = () => {
      if (probe.stopped) return;
      const due = performance.now() + intervalMs;
      probe.pendingDue = due;
      setTimeout(() => {
        // Alternate between the bottom and a point below the top, so the
        // probe never asks for older history.
        const { scrollHeight } = container;
        container.scrollTop =
          container.scrollTop > scrollHeight / 2
            ? scrollHeight / 4
            : scrollHeight;
        requestAnimationFrame(() => {
          probe.latencies.push(performance.now() - due);
          probe.pendingDue = null;
          scheduleScroll();
        });
      }, intervalMs);
    };
    scheduleScroll();
  }, SCROLL_PROBE_INTERVAL_MS);

  await stop;

  return page.evaluate(() => {
    const probe = (
      window as unknown as {
        subagentScrollProbe: {
          latencies: number[];
          longTasks: number[];
          stopped: boolean;
          pendingDue: number | null;
        };
      }
    ).subagentScrollProbe;
    probe.stopped = true;
    // A scroll that was due and never painted is the worst latency of all.
    const starved =
      probe.pendingDue === null ? 0 : performance.now() - probe.pendingDue;
    return {
      maxScrollLatencyMs: Math.max(0, starved, ...probe.latencies),
      longTasks: probe.longTasks,
      scrolls: probe.latencies.length,
    };
  });
}
