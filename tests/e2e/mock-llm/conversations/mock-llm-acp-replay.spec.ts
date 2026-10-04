/**
 * Mock-LLM E2E test: replay recorded ACP streams through the real agent-server
 * and check that the chat nests every sub-agent as the agent-server stored it,
 * and that a transcript announcing a sub-agent left at least one stored.
 *
 * One test per transcript named by `OH_ACP_REPLAY_TRANSCRIPTS` (paths joined
 * by the platform's path delimiter); skipped when it is unset. Each transcript
 * is played by the SDK's scripted ACP agent (`SCRIPTED_ACP_AGENT`) in
 * transcript mode with `acp_subagents` on; agent-outgoing recordings are
 * played with wait points inferred from their responses.
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { test, expect } from "@playwright/test";
import {
  ensureMockLLMProfileViaAPI,
  seedLocalStorage,
} from "../utils/mock-llm-helpers";
import {
  REPLAY_TRANSCRIPTS,
  SCRIPTED_ACP_AGENT,
  expandAllSubagents,
  readRenderedSubagentTree,
  readStoredSubagentTree,
  scriptedAcpRuns,
  waitForTurnsToEnd,
} from "../utils/acp-subagents";

const runs = scriptedAcpRuns();

/** Matches a transcript that announces a sub-agent: any `subagent_update`. */
const SUBAGENT_UPDATE = /"sessionUpdate":\s*"subagent_update"/;

test.describe.configure({ mode: "serial" });

test.describe("ACP sub-agent sessions, replayed", () => {
  test.skip(
    REPLAY_TRANSCRIPTS.length === 0,
    "OH_ACP_REPLAY_TRANSCRIPTS names no transcript",
  );
  test.skip(
    process.env.MOCK_LLM_DOCKER_MODE === "true",
    "the scripted ACP agent and its transcripts are not mounted into the Docker image",
  );

  test.beforeAll(async ({ request }) => {
    expect(
      SCRIPTED_ACP_AGENT,
      "replaying needs the scripted ACP agent (SCRIPTED_ACP_AGENT)",
    ).not.toBeNull();
    await ensureMockLLMProfileViaAPI(request);
  });

  test.beforeEach(async ({ page }) => {
    await seedLocalStorage(page);
  });

  test.afterAll(({ request }) => runs.cleanUp(request));

  for (const transcript of REPLAY_TRANSCRIPTS) {
    // @spec SUB-001 — Each ACP sub-agent session renders inside the tool call that spawned it, recursively
    test(`nests ${basename(transcript)} as the agent-server stored it`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      const conversationId = await runs.start(
        page,
        request,
        ["--transcript", transcript],
        "Replay.",
      );
      await waitForTurnsToEnd(request, conversationId);

      await expandAllSubagents(page);

      const rendered = await readRenderedSubagentTree(page);
      const stored = await readStoredSubagentTree(request, conversationId);

      if (SUBAGENT_UPDATE.test(await readFile(transcript, "utf8"))) {
        expect(
          stored.length,
          "the agent-server stored no sub-agent for this transcript",
        ).toBeGreaterThan(0);
      }
      expect(rendered).toEqual(stored);
    });
  }
});
