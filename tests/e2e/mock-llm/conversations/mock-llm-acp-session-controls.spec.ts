/**
 * Mock-LLM E2E test: an ACP agent's slash commands and config options.
 *
 * The mock ACP agent runs with `--session-controls`: one `profile` option
 * (`fast` or `thorough`) and commands that depend on it (`fast`: summarize;
 * `thorough`: summarize and compare, which takes "what to compare"). The first
 * prompt clears the commands and fixes the profile, and the reply reads
 * `MOCK_ACP_E2E_REPLY_OK profile=<profile>`, so the reply shows which value
 * reached the agent before its first prompt.
 *
 * Needs an agent-server that serves ACP session controls
 * (`acp_session_controls_v1` in /server_info).
 */

import { test, expect, type Page } from "@playwright/test";
import {
  ACP_REPLY_TOKEN,
  BACKEND_URL,
  MOCK_ACP_COMMAND_PYTHON,
  MOCK_ACP_COMMAND_SCRIPT,
  SESSION_API_KEY,
  deleteConversation,
  dismissAnalyticsModal,
  ensureMockLLMAgentProfile,
  ensureMockLLMProfile,
  getConversationIdFromURL,
  resetMockLLM,
  routeSessionApiKey,
  seedLocalStorage,
  waitForNonUserMessageText,
  waitForPath,
  waitForTestId,
} from "../utils/mock-llm-helpers";

const PROFILE_NAME = "mock-acp-session-controls";
const ACP_COMMAND = `${MOCK_ACP_COMMAND_PYTHON} ${MOCK_ACP_COMMAND_SCRIPT} --session-controls`;
const API_HEADERS = {
  "X-Session-API-Key": SESSION_API_KEY,
  "Content-Type": "application/json",
};

let conversationId: string | null = null;

/** The commands the slash menu lists for what is typed so far. */
async function slashMenuCommands(page: Page): Promise<string[]> {
  const menu = page.getByTestId("slash-command-menu");
  await expect(menu).toBeVisible();
  return menu
    .getByTestId("slash-command-item")
    .evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-command") ?? ""),
    );
}

async function openSlashMenu(page: Page) {
  const input = page.getByTestId("chat-input");
  await input.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("/");
}

async function activateSessionControlsAgent(
  request: import("@playwright/test").APIRequestContext,
) {
  const saved = await request.post(
    `${BACKEND_URL}/api/agent-profiles/${PROFILE_NAME}`,
    {
      headers: API_HEADERS,
      data: {
        agent_kind: "acp",
        acp_server: "custom",
        acp_command: ACP_COMMAND,
      },
    },
  );
  expect(saved.ok(), `save ACP profile: ${saved.status()}`).toBe(true);
  const detail = await request.get(
    `${BACKEND_URL}/api/agent-profiles/${PROFILE_NAME}`,
    { headers: API_HEADERS },
  );
  const id = (await detail.json())?.profile?.id as string;
  const activated = await request.post(
    `${BACKEND_URL}/api/agent-profiles/${encodeURIComponent(id)}/activate`,
    { headers: API_HEADERS, data: {} },
  );
  expect(activated.ok(), `activate ACP profile: ${activated.status()}`).toBe(
    true,
  );
}

test.describe.configure({ mode: "serial" });

test.describe("ACP agent commands and options", () => {
  test.beforeAll(async ({ request }) => {
    const info = await (await request.get(`${BACKEND_URL}/server_info`)).json();
    expect(
      info.capabilities,
      "the agent-server must serve ACP session controls",
    ).toContain("acp_session_controls_v1");
  });

  test.beforeEach(async ({ page }) => {
    await seedLocalStorage(page);
    await routeSessionApiKey(page);
  });

  test.afterAll(async ({ request }) => {
    if (conversationId) {
      await deleteConversation(request, conversationId).catch(() => undefined);
    }
    await ensureMockLLMAgentProfile(request);
    await request.delete(`${BACKEND_URL}/api/agent-profiles/${PROFILE_NAME}`, {
      headers: API_HEADERS,
    });
    await resetMockLLM(request);
  });

  // @spec ASC-001 — The slash menu lists the agent's current commands
  // @spec ASC-002 — A conversation starts with values the preview accepted
  test("the home screen previews the agent, and the picked profile reaches it before the first prompt", async ({
    page,
    request,
  }) => {
    test.setTimeout(120_000);
    await ensureMockLLMProfile(page);
    await activateSessionControlsAgent(request);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissAnalyticsModal(page);
    await waitForTestId(page, "home-chat-launcher");

    const pill = page.getByTestId("agent-option-profile");
    await expect(pill).toHaveText(/Profile: fast/, { timeout: 30_000 });
    await openSlashMenu(page);
    expect(await slashMenuCommands(page)).toContain("/summarize");
    expect(await slashMenuCommands(page)).not.toContain("/compare");

    await page.keyboard.press("Escape");
    await pill.click();
    await page.getByTestId("agent-option-profile-value-thorough").click();
    await expect(pill).toHaveText(/Profile: thorough/, { timeout: 30_000 });
    await expect(pill).toHaveAttribute("data-value", "thorough");
    await openSlashMenu(page);
    await expect
      .poll(() => slashMenuCommands(page), { timeout: 30_000 })
      .toEqual(expect.arrayContaining(["/summarize", "/compare"]));
    await expect(
      page
        .locator('[data-testid="slash-command-item"][data-command="/compare"]')
        .getByTestId("slash-command-hint"),
    ).toHaveText("‹what to compare›");

    const started = page.waitForRequest(
      (req) =>
        req.method() === "POST" &&
        new URL(req.url()).pathname === "/api/conversations",
    );
    await page.keyboard.type("compare a b");
    await page.getByTestId("submit-button").click();
    expect((await started).postDataJSON().acp_config_options).toEqual({
      profile: "thorough",
    });
    await waitForPath(page, /\/conversations\/[^/]+$/, 30_000);
    conversationId = getConversationIdFromURL(page);

    await waitForNonUserMessageText(
      page,
      `${ACP_REPLY_TOKEN} profile=thorough`,
      60_000,
    );
  });

  // @spec ASC-001 — The slash menu lists the agent's current commands
  test("in the started conversation the profile is fixed and the agent offers no commands, after a reload too", async ({
    page,
  }) => {
    test.skip(!conversationId, "the first test must start the conversation");
    await page.goto(`/conversations/${conversationId}`, {
      waitUntil: "domcontentloaded",
    });
    await dismissAnalyticsModal(page);

    for (const pass of ["live", "after reload"]) {
      await test.step(pass, async () => {
        const pill = page.getByTestId("agent-option-profile");
        await expect(pill).toHaveAttribute("data-fixed", "true", {
          timeout: 30_000,
        });
        await expect(pill).toHaveAttribute("data-value", "thorough");
        await openSlashMenu(page);
        const commands = await slashMenuCommands(page);
        expect(commands).not.toContain("/summarize");
        expect(commands).not.toContain("/compare");
        await page.reload({ waitUntil: "domcontentloaded" });
        await dismissAnalyticsModal(page);
      });
    }
  });
});
