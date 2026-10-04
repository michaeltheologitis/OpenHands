/**
 * Mock-LLM E2E test: ACP sub-agent sessions nested in the chat.
 *
 * Runs the SDK's scripted ACP agent (`SCRIPTED_ACP_AGENT`, fetched from the
 * pinned SDK by the workflow) in transcript mode as an ACP agent profile with
 * `acp_subagents` on, through the real agent-server, and asserts what the chat
 * shows against what the agent-server stored:
 *
 *   - nested-stop.jsonl: two children in the root's cell, one with a child of
 *     its own; it waits for Stop on `child-x` before finishing the turn.
 *   - fallback-placement.jsonl: children without a spawning call, one naming
 *     a call never sent, and one announced on a session that is not in the
 *     conversation.
 *   - a generated fan-out (E6): 50 children × 5 calls at 60 events per second,
 *     every child expanded as it appears, while a probe scrolls the chat.
 */

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import {
  ensureMockLLMProfile,
  routeSessionApiKey,
  seedLocalStorage,
} from "../utils/mock-llm-helpers";
import {
  COLLAPSED_TOGGLES,
  SCRIPTED_ACP_AGENT,
  expandAllSubagents,
  probeScrollResponsiveness,
  readRenderedSubagentTree,
  readStoredEvents,
  readStoredSubagentTree,
  scriptedAcpRuns,
  showSubagentCosts,
  waitForTurnsToEnd,
  writeFanoutTranscript,
} from "../utils/acp-subagents";

const TRANSCRIPTS = resolve("tests/e2e/mock-llm/fixtures/acp-subagents");
// The nested-stop transcript waits this long for Stop before it gives up.
const WAIT_FOR_STOP_S = "120";
// E6: 60 events per second.
const FANOUT_INTERVAL_MS = "16";
const SCROLL_LATENCY_LIMIT_MS = 1_000;

const runs = scriptedAcpRuns();

const rowOf = (page: Page, sessionId: string) =>
  page.locator(
    `[data-testid="subagent-row"][data-acp-session-id="${sessionId}"]`,
  );

const stopOf = (page: Page, sessionId: string) =>
  rowOf(page, sessionId).getByTestId("subagent-stop").first();

/** The root's own cards: ACP cells outside every sub-agent row. */
const rootCellIds = (page: Page) =>
  page
    .getByTestId("acp-tool-call")
    .evaluateAll((cells) =>
      cells
        .filter((cell) => !cell.closest('[data-testid="subagent-row"]'))
        .map((cell) => cell.getAttribute("data-acp-tool-call-id")),
    );

test.describe.configure({ mode: "serial" });

test.describe("ACP sub-agent sessions", () => {
  test.skip(
    process.env.MOCK_LLM_DOCKER_MODE === "true",
    "the scripted ACP agent and its transcripts are not mounted into the Docker image",
  );
  test.skip(
    !SCRIPTED_ACP_AGENT && !process.env.CI,
    "set SCRIPTED_ACP_AGENT to tests/fixtures/acp/scripted_agent.py in a checkout of the pinned SDK",
  );

  let conversationId = "";

  test.beforeAll(() => {
    expect(
      SCRIPTED_ACP_AGENT,
      "CI must fetch the scripted ACP agent (SCRIPTED_ACP_AGENT)",
    ).not.toBeNull();
  });

  test.beforeEach(async ({ page }) => {
    await seedLocalStorage(page);
  });

  test.afterAll(({ request }) => runs.cleanUp(request));

  // @spec SUB-001 — Each ACP sub-agent session renders inside the tool call that spawned it, recursively
  // @spec SUB-004 — The root's flow shows only the root session's work
  // @spec SUB-006 — Costs show only when the setting is on; then each sub-agent shows its latest reported cost, never a sum
  test("nests each sub-agent under the call that spawned it", async ({
    page,
    request,
  }) => {
    test.setTimeout(150_000);
    await ensureMockLLMProfile(page);
    conversationId = await runs.start(
      page,
      request,
      [
        "--transcript",
        join(TRANSCRIPTS, "nested-stop.jsonl"),
        "--wait-timeout",
        WAIT_FOR_STOP_S,
      ],
      "Compare CS101 and CS201.",
    );

    const summary = page.getByTestId("subagent-block-toggle").first();
    await expect(summary).toHaveText("2 sub-agents · 2 running", {
      timeout: 60_000,
    });
    // child-z is announced inside child-x's cell before the run waits.
    await expect
      .poll(async () =>
        (await readStoredSubagentTree(request, conversationId)).map(
          ({ sessionId }) => sessionId,
        ),
      )
      .toEqual(["child-x", "child-y", "child-z"]);

    await expandAllSubagents(page);

    expect(await readRenderedSubagentTree(page)).toEqual(
      await readStoredSubagentTree(request, conversationId),
    );
    expect(await rootCellIds(page)).toEqual(["cell-1"]);

    // child-x has reported its cost, and its row shows it only once the App
    // setting is on, which a full page load keeps.
    await expect
      .poll(async () =>
        (await readStoredEvents(request, conversationId)).some(
          (event) =>
            event.kind === "ACPSubagentEvent" &&
            event.acp_session_id === "child-x" &&
            event.cost === 0.0004,
        ),
      )
      .toBe(true);
    await expect(
      rowOf(page, "child-x").getByTestId("subagent-cost"),
    ).toHaveCount(0);
    await showSubagentCosts(page);
    await page.goto(`/conversations/${conversationId}`);
    await expect(summary).toHaveText("2 sub-agents · 2 running", {
      timeout: 30_000,
    });
    await expandAllSubagents(page);
    await expect(
      rowOf(page, "child-x").getByTestId("subagent-cost").first(),
    ).toHaveText("$0.0004");
  });

  // @spec SUB-007 — Stop is offered only for a running sub-agent that granted cancel on the live connection
  test("stops one sub-agent and its branch", async ({ page }) => {
    test.setTimeout(120_000);
    await routeSessionApiKey(page);
    await page.goto(`/conversations/${conversationId}`);
    const summary = page.getByTestId("subagent-block-toggle").first();
    await expect(summary).toHaveText("2 sub-agents · 2 running", {
      timeout: 30_000,
    });
    // Opened as a user does, with the pointer, which hover tooltips wait for.
    await summary.click();

    const withheld = stopOf(page, "child-y");
    await expect(withheld).toHaveAttribute("data-subagent-stop", "withheld");
    await expect(withheld).toHaveAttribute("aria-disabled", "true");
    await withheld.hover();
    await expect(page.getByRole("tooltip")).toHaveText(
      "This agent cannot stop a single sub-agent. Stop ends the whole turn.",
    );
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    const stop = stopOf(page, "child-x");
    await expect(stop).toHaveAttribute("data-subagent-stop", "ready");
    const cancelRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request
          .url()
          .endsWith(
            `/api/conversations/${conversationId}/acp/sessions/child-x/cancel`,
          ),
    );
    await stop.click();
    await cancelRequest;
    await expandAllSubagents(page);

    await expect(rowOf(page, "child-x")).toHaveAttribute(
      "data-subagent-status",
      "stopped",
      { timeout: 30_000 },
    );
    await expect(rowOf(page, "child-z")).toHaveAttribute(
      "data-subagent-status",
      "stopped",
    );
    await expect(
      page.locator(
        '[data-testid="acp-tool-call"][data-acp-tool-call-id="cell-x1"]',
      ),
    ).toHaveAttribute("data-acp-tool-call-status", "failed");
    await expect(rowOf(page, "child-y")).toHaveAttribute(
      "data-subagent-status",
      "done",
    );
    await expect(page.getByTestId("subagent-stop")).toHaveCount(0);
  });

  // @spec SUB-005 — Each sub-agent shows its latest state; an unconfirmed state never shows a spinner
  test("shows the same tree after reloading", async ({ page, request }) => {
    test.setTimeout(90_000);
    await waitForTurnsToEnd(request, conversationId);
    await routeSessionApiKey(page);
    await page.goto(`/conversations/${conversationId}`);
    await expect(page.getByTestId("subagent-block-toggle").first()).toHaveText(
      "2 sub-agents · 1 done · 1 stopped",
      { timeout: 30_000 },
    );

    await expandAllSubagents(page);

    expect(await readRenderedSubagentTree(page)).toEqual(
      await readStoredSubagentTree(request, conversationId),
    );
    await expect(page.getByTestId("subagent-stop")).toHaveCount(0);
    // The root's answer is there, and a child's words only inside its row.
    await expect(page.getByText("NESTED_STOP_DONE")).toBeVisible();
    const childAnswer = page.getByText("CS101: 3cr, 0 prereqs, light");
    expect(await childAnswer.count()).toBeGreaterThan(0);
    expect(
      await childAnswer.evaluateAll((elements) =>
        elements.every((element) =>
          element.closest('[data-testid="subagent-row"]'),
        ),
      ),
    ).toBe(true);
  });

  // @spec SUB-002 — Without a loaded spawning call, a sub-agent renders at its parent's message to it, else at its announcement
  // @spec SUB-003 — A sub-agent whose parent session is not in the conversation is shown apart, never in the root's flow
  test("places sub-agents without a spawning call and shows orphans apart", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    const id = await runs.start(
      page,
      request,
      ["--transcript", join(TRANSCRIPTS, "fallback-placement.jsonl")],
      "Map the catalog.",
    );
    await waitForTurnsToEnd(request, id);
    await expect(page.getByText("FALLBACK_PLACEMENT_DONE")).toBeVisible({
      timeout: 30_000,
    });
    const unplaced = page.getByTestId("subagent-unplaced");
    await expect(unplaced).toHaveAttribute(
      "data-missing-parent-session-id",
      "ghost",
    );

    // The root's flow, top to bottom: cards and the rows placed in it.
    const flow = await page
      .locator(
        '[data-testid="acp-tool-call"], [data-testid="subagent-row"], [data-testid="subagent-unplaced"]',
      )
      .evaluateAll((elements) =>
        elements.map(
          (element) =>
            element.getAttribute("data-acp-tool-call-id") ??
            element.getAttribute("data-acp-session-id") ??
            `unplaced:${element.getAttribute("data-missing-parent-session-id")}`,
        ),
      );
    expect(flow).toEqual([
      "cell-1",
      "child-m",
      "child-a",
      "child-g",
      "cell-2",
      "unplaced:ghost",
      "child-o",
    ]);
  });

  // @spec SUB-010 — 50 sub-agents × 5 tool calls arriving at 60 events per second leave the chat responsive to scrolling within 1 s, with every sub-agent expanded
  test("stays responsive while 50 sub-agents with 5 tool calls each stream in", async ({
    page,
    request,
  }) => {
    test.setTimeout(300_000);
    const transcript = await writeFanoutTranscript(
      await mkdtemp(join(tmpdir(), "acp-fanout-")),
      { children: 50, cellsPerChild: 5 },
    );
    const id = await runs.start(
      page,
      request,
      [
        "--transcript",
        transcript,
        "--transcript-interval-ms",
        FANOUT_INTERVAL_MS,
      ],
      "Summarize every part.",
    );
    await expect(page.getByTestId("subagent-block-toggle").first()).toBeVisible(
      { timeout: 60_000 },
    );

    // Expand every block and row as it appears, inside the page.
    const expander = await page.evaluateHandle(
      (selector) =>
        window.setInterval(() => {
          document
            .querySelectorAll<HTMLElement>(selector)
            .forEach((toggle) => toggle.click());
        }, 100),
      COLLAPSED_TOGGLES,
    );
    const finished = waitForTurnsToEnd(request, id, { timeout: 180_000 });
    const probe = await probeScrollResponsiveness(page, finished);

    await page.evaluate((interval) => window.clearInterval(interval), expander);
    const subagentEvents = (await readStoredEvents(request, id)).filter(
      ({ kind }) => kind?.startsWith("ACP"),
    );
    const seconds =
      (Date.parse(subagentEvents.at(-1)!.timestamp) -
        Date.parse(subagentEvents[0].timestamp)) /
      1000;
    console.log(
      `E6: ${subagentEvents.length} ACP events in ${seconds.toFixed(1)} s ` +
        `(${(subagentEvents.length / seconds).toFixed(1)}/s); ` +
        `scroll probe ${JSON.stringify(probe)}`,
    );
    expect(probe.maxScrollLatencyMs).toBeLessThan(SCROLL_LATENCY_LIMIT_MS);
    expect(probe.scrolls).toBeGreaterThan(10);
    await expect(page.getByTestId("subagent-block-toggle").first()).toHaveText(
      "50 sub-agents · 50 done",
      { timeout: 30_000 },
    );
    await expandAllSubagents(page);
    const stored = await readStoredSubagentTree(request, id);
    expect(stored).toHaveLength(50);
    expect(await readRenderedSubagentTree(page)).toEqual(stored);
  });
});
