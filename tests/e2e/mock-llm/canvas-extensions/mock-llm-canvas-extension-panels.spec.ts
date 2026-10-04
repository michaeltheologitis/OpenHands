/**
 * Mock-LLM E2E test: an App's conversation header panel, against the real
 * agent-server's Canvas Extension API.
 *
 * The `demo-panel` fixture App is installed by absolute path and enabled
 * through the API (the Apps page itself is covered by
 * mock-llm-canvas-extensions.spec.ts). Its one panel has two tabs, and each
 * mount writes `conversation=<id> path=<path> tab=<tab>` into the page, so
 * every step reads the panel's lifecycle from the DOM.
 *
 * Needs an agent-server that serves conversation panels
 * (`canvas_conversation_panels_v1` in /server_info).
 */

import { resolve } from "path";
import { test, expect, type Page } from "@playwright/test";
import {
  BACKEND_URL,
  SESSION_API_KEY,
  deleteConversation,
  dismissAnalyticsModal,
  ensureMockLLMProfile,
  getConversationIdFromURL,
  resetMockLLM,
  routeSessionApiKey,
  seedLocalStorage,
  setChatInput,
  waitForPath,
} from "../utils/mock-llm-helpers";

const APP_NAME = "demo-panel";
const APP_SOURCE = resolve("src/fixtures/canvas-extensions/demo-panel");
const TOGGLE = "conversation-app-panel-toggle-demo-panel-demo";
const API_HEADERS = {
  "X-Session-API-Key": SESSION_API_KEY,
  "Content-Type": "application/json",
};

const conversationIds: string[] = [];

function panel(page: Page) {
  return page.getByRole("region", { name: "Demo panel" });
}

function panelContext(page: Page) {
  return page.getByTestId("demo-panel-context");
}

function drawer(page: Page) {
  return page.getByTestId("tabs-pane-header");
}

async function startConversation(page: Page, message: string) {
  await setChatInput(page, message);
  await page.getByTestId("submit-button").click();
  await waitForPath(page, /\/conversations\/[^/]+$/, 30_000);
  const id = getConversationIdFromURL(page);
  conversationIds.push(id);
  return id;
}

async function openConversation(page: Page, id: string) {
  await page.goto(`/conversations/${id}`, { waitUntil: "domcontentloaded" });
  await dismissAnalyticsModal(page);
  await expect(page.getByTestId(TOGGLE)).toBeVisible({ timeout: 30_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("App header panels", () => {
  test.skip(
    !!process.env.MOCK_LLM_DOCKER_MODE,
    "installs the fixture App from a host path the container cannot see",
  );

  test.beforeAll(async ({ request }) => {
    const info = await (await request.get(`${BACKEND_URL}/server_info`)).json();
    expect(
      info.capabilities,
      "the agent-server must serve conversation panels",
    ).toContain("canvas_conversation_panels_v1");

    const installed = await request.post(
      `${BACKEND_URL}/api/canvas-extensions/install`,
      { headers: API_HEADERS, data: { source: APP_SOURCE, force: true } },
    );
    expect(installed.ok(), `install: ${installed.status()}`).toBe(true);
    const enabled = await request.patch(
      `${BACKEND_URL}/api/canvas-extensions/installed/${APP_NAME}`,
      { headers: API_HEADERS, data: { enabled: true } },
    );
    expect(enabled.ok(), `enable: ${enabled.status()}`).toBe(true);
  });

  test.beforeEach(async ({ page }) => {
    await seedLocalStorage(page);
    await routeSessionApiKey(page);
  });

  test.afterEach(async ({ request }) => {
    await resetMockLLM(request);
  });

  test.afterAll(async ({ request }) => {
    for (const id of conversationIds) {
      await deleteConversation(request, id).catch(() => undefined);
    }
    await request.delete(
      `${BACKEND_URL}/api/canvas-extensions/installed/${APP_NAME}`,
      { headers: API_HEADERS },
    );
  });

  // @spec CX-001 — One right-hand panel
  // @spec CX-006 — Stable test ids for header panels
  test("the App's button follows Show panel and opens one right-hand panel for the conversation", async ({
    page,
  }) => {
    await ensureMockLLMProfile(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await dismissAnalyticsModal(page);
    const conversationId = await startConversation(page, "Open the panel.");

    const toggle = page.getByTestId(TOGGLE);
    await expect(toggle).toBeVisible({ timeout: 30_000 });
    const headerButtons = await toggle
      .locator("xpath=ancestor::div[contains(@class,'shrink-0')][1]")
      .locator("button[data-testid]")
      .evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("data-testid")),
      );
    expect(headerButtons.slice(-2)).toEqual(["right-panel-toggle", TOGGLE]);
    await expect(toggle.locator("img")).toHaveAttribute(
      "src",
      /^data:image\/svg\+xml/,
    );

    await toggle.click();
    await expect(panel(page)).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(panelContext(page)).toHaveText(
      `conversation=${conversationId} path= tab=overview`,
    );

    await page.getByTestId("right-panel-toggle").click();
    await expect(drawer(page)).toBeVisible();
    await expect(panel(page)).toHaveCount(0);

    await toggle.click();
    await expect(panel(page)).toBeVisible();
    await expect(drawer(page)).toBeHidden();

    await page.getByTestId("conversation-overview-toggle").click();
    await expect(
      page.getByTestId("conversation-overview-toggle"),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(panel(page)).toHaveCount(0);

    await toggle.click();
    await expect(panel(page)).toBeVisible();
    await expect(
      page.getByTestId("conversation-overview-toggle"),
    ).toHaveAttribute("aria-pressed", "false");

    await page.getByTestId("demo-panel-select-details").click();
    await expect(panelContext(page)).toHaveText(
      `conversation=${conversationId} path=details tab=details`,
    );
  });

  // @spec CX-003 — Panel tab state
  test("a tab unpinned from the ⋯ menu stays unpinned after a reload, while the panel itself starts closed", async ({
    page,
  }) => {
    await openConversation(page, conversationIds[0]);
    await page.getByTestId(TOGGLE).click();
    await page.getByTestId("conversation-app-panel-menu-button").click();
    await page.getByTestId("conversation-app-panel-menu-open-overview").click();
    await page.getByTestId("conversation-app-panel-menu-button").click();
    await page.getByTestId("conversation-app-panel-menu-pin-details").click();
    await expect(
      page.getByTestId("conversation-app-panel-tab-details"),
    ).toHaveCount(0);

    await page.reload({ waitUntil: "domcontentloaded" });
    await dismissAnalyticsModal(page);
    await expect(page.getByTestId(TOGGLE)).toHaveAttribute(
      "aria-pressed",
      "false",
      { timeout: 30_000 },
    );
    await expect(panel(page)).toHaveCount(0);

    await page.getByTestId(TOGGLE).click();
    await expect(
      page.getByTestId("conversation-app-panel-tab-overview"),
    ).toBeVisible();
    await expect(
      page.getByTestId("conversation-app-panel-tab-details"),
    ).toHaveCount(0);
    await page.getByTestId("conversation-app-panel-menu-button").click();
    await expect(
      page.getByTestId("conversation-app-panel-menu-pin-details"),
    ).toHaveAttribute("aria-pressed", "false");
  });

  // @spec CX-002 — A panel tab belongs to its conversation
  test("switching conversation with the panel open remounts it for the other conversation", async ({
    page,
  }) => {
    const first = conversationIds[0];
    await openConversation(page, first);
    await page.getByTestId(TOGGLE).click();
    await expect(panelContext(page)).toContainText(`conversation=${first}`);

    await page.getByTestId("sidebar-conversations-link").click();
    await waitForPath(page, /\/conversations$/);
    const second = await startConversation(page, "Another conversation.");

    await expect(panelContext(page)).toHaveText(
      `conversation=${second} path= tab=overview`,
      { timeout: 30_000 },
    );

    await page.goBack();
    await page.goBack();
    await waitForPath(page, new RegExp(`/conversations/${first}$`));
    await expect(panelContext(page)).toContainText(`conversation=${first}`);
  });

  test("on a narrow window the button opens the panel as a page of its own", async ({
    page,
  }) => {
    const id = conversationIds[0];
    await page.setViewportSize({ width: 800, height: 900 });
    await openConversation(page, id);

    await page.getByTestId(TOGGLE).click();

    await waitForPath(
      page,
      new RegExp(`/conversations/${id}/panel/${APP_NAME}/demo$`),
    );
    await expect(page.getByTestId("conversation-app-panel-page")).toBeVisible();
    await expect(panelContext(page)).toContainText(`conversation=${id}`);

    await page.getByTestId("conversation-app-panel-page-back").click();
    await waitForPath(page, new RegExp(`/conversations/${id}$`));
  });

  test("disabling the App removes its button and closes its panel", async ({
    page,
  }) => {
    const id = conversationIds[0];
    await openConversation(page, id);
    await page.getByTestId(TOGGLE).click();
    await expect(panel(page)).toBeVisible();

    await page.getByTestId("sidebar-skills-link").click();
    await page.getByRole("link", { name: "Apps", exact: true }).click();
    const card = page.getByTestId(`canvas-extension-card-${APP_NAME}`);
    await card.getByRole("switch").click();
    await expect(card.getByRole("switch")).toHaveAttribute(
      "aria-checked",
      "false",
    );

    await page.goBack();
    await page.goBack();
    await waitForPath(page, new RegExp(`/conversations/${id}$`));
    await expect(page.getByTestId("right-panel-toggle")).toBeVisible();
    await expect(page.getByTestId(TOGGLE)).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  });
});
