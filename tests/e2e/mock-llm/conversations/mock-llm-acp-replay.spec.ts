/**
 * Mock-LLM E2E test: replay recorded ACP streams through the real agent-server
 * and check that the chat nests every sub-agent as the agent-server stored it.
 *
 * One test per transcript named by `OH_ACP_REPLAY_TRANSCRIPTS` (paths joined
 * by the platform's path delimiter); skipped when it is unset. Each transcript
 * is played by the SDK's scripted ACP agent (`SCRIPTED_ACP_AGENT`) in
 * transcript mode with `acp_subagents` on; agent-outgoing recordings are
 * played with wait points inferred from their responses.
 */

import { basename } from "node:path";
import { test, expect } from "@playwright/test";
import {
  deleteConversation,
  ensureMockLLMAgentProfile,
  ensureMockLLMProfileViaAPI,
  resetMockLLM,
  routeSessionApiKey,
  seedLocalStorage,
} from "../utils/mock-llm-helpers";
import {
  REPLAY_TRANSCRIPTS,
  SCRIPTED_ACP_AGENT,
  configureScriptedAcpAgent,
  deleteScriptedAcpAgent,
  expandAllSubagents,
  readRenderedSubagentTree,
  readStoredSubagentTree,
  startConversation,
  waitForTurnsToEnd,
} from "../utils/acp-subagents";

const conversations: string[] = [];

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

  test.afterAll(async ({ request }) => {
    for (const id of conversations) {
      await deleteConversation(request, id).catch(() => undefined);
    }
    await ensureMockLLMAgentProfile(request).catch(() => undefined);
    await deleteScriptedAcpAgent(request).catch(() => undefined);
    await resetMockLLM(request).catch(() => undefined);
  });

  for (const transcript of REPLAY_TRANSCRIPTS) {
    // @spec SUB-001 — Each ACP sub-agent session renders inside the tool call that spawned it, recursively
    test(`nests ${basename(transcript)} as the agent-server stored it`, async ({
      page,
      request,
    }) => {
      test.setTimeout(180_000);
      await configureScriptedAcpAgent(request, {
        flags: ["--transcript", transcript],
        subagents: true,
      });
      await routeSessionApiKey(page);
      const conversationId = await startConversation(page, "Replay.");
      conversations.push(conversationId);
      await waitForTurnsToEnd(request, conversationId);

      await expandAllSubagents(page);

      expect(await readRenderedSubagentTree(page)).toEqual(
        await readStoredSubagentTree(request, conversationId),
      );
    });
  }
});
