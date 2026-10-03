import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRegisteredAppPanel } from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { ConversationAppPanel } from "#/components/features/conversation/conversation-app-panel/conversation-app-panel";
import { useConversationStore } from "#/stores/conversation-store";
import type {
  CanvasExtensionHost,
  CanvasExtensionModule,
} from "#/types/canvas-extension";
import { getConversationState } from "#/utils/conversation-local-storage";
import { renderWithProviders } from "../../../../test-utils";
import {
  DEMO_PANEL_KEY,
  PanelAppsRuntime,
  demoPanelLifecycle,
  installPanelApps,
  resetDemoPanelLifecycle,
  uninstallPanelApps,
} from "../../../helpers/canvas-extension-panels";

function DemoPanel({ conversationId }: { conversationId: string }) {
  const panel = useRegisteredAppPanel(DEMO_PANEL_KEY);
  return panel ? (
    <ConversationAppPanel conversationId={conversationId} panel={panel} />
  ) : null;
}

function renderPanel(
  conversationId = "conv-1",
  moduleLoader?: () => Promise<CanvasExtensionModule>,
) {
  const ui = (id: string) => (
    <PanelAppsRuntime moduleLoader={moduleLoader}>
      <DemoPanel conversationId={id} />
    </PanelAppsRuntime>
  );
  const rendered = renderWithProviders(ui(conversationId), {
    navigation: { conversationId },
  });
  return {
    ...rendered,
    switchConversation: (id: string) => rendered.rerender(ui(id)),
  };
}

const panelContent = () =>
  screen.findByTestId("conversation-app-panel-content");

describe("ConversationAppPanel", () => {
  beforeEach(() => {
    localStorage.clear();
    resetDemoPanelLifecycle();
    useConversationStore.setState({ activeAppPanel: DEMO_PANEL_KEY });
    installPanelApps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallPanelApps();
  });

  it("is a region named after the panel, with its tabs in manifest order", async () => {
    renderPanel();

    const region = await screen.findByRole("region", { name: "Demo panel" });

    expect(
      within(region)
        .getAllByTestId(/^conversation-app-panel-tab-/)
        .map((tab) => tab.textContent),
    ).toEqual(["Overview", "Details"]);
  });

  it("mounts the selected tab with the conversation's id, its path and its surface", async () => {
    renderPanel("conv-1");

    expect(await panelContent()).toHaveAttribute("data-tab-id", "overview");
    await waitFor(() =>
      expect(screen.getByTestId("demo-panel-context")).toHaveTextContent(
        "conversation=conv-1 path= tab=overview",
      ),
    );
  });

  it("disposes the old tab's mount before mounting the newly selected one", async () => {
    const lifecycle: string[] = [];
    const moduleLoader = async () => ({
      activate: (host: CanvasExtensionHost) => {
        for (const tabId of ["overview", "details"]) {
          host.registerPage(tabId, ({ surface }) => {
            lifecycle.push(
              `mount ${surface.kind === "conversation-panel" && surface.tabId}`,
            );
            return () => lifecycle.push(`dispose ${tabId}`);
          });
        }
      },
    });
    const user = userEvent.setup();
    renderPanel("conv-1", moduleLoader);
    await waitFor(() => expect(lifecycle).toEqual(["mount overview"]));

    await user.click(screen.getByTestId("conversation-app-panel-tab-details"));

    await waitFor(() =>
      expect(lifecycle).toEqual([
        "mount overview",
        "dispose overview",
        "mount details",
      ]),
    );
    expect(
      getConversationState("conv-1").appPanelTabs?.[DEMO_PANEL_KEY],
    ).toMatchObject({ selectedTab: "details" });
  });

  // @spec CX-002 — A panel tab is mounted for the conversation it is shown in
  it("remounts the tab with the new conversation's id when the conversation changes", async () => {
    const { switchConversation } = renderPanel("conv-1");
    await waitFor(() =>
      expect(screen.getByTestId("demo-panel-context")).toHaveTextContent(
        "conversation=conv-1",
      ),
    );

    switchConversation("conv-2");

    await waitFor(() =>
      expect(screen.getByTestId("demo-panel-context")).toHaveTextContent(
        "conversation=conv-2 path= tab=overview",
      ),
    );
    expect(demoPanelLifecycle()).toEqual({ mounted: 2, disposed: 1 });
  });

  it("closes the panel when its selected tab is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(
      await screen.findByTestId("conversation-app-panel-tab-overview"),
    );

    expect(useConversationStore.getState().activeAppPanel).toBeNull();
  });

  it("opens and pins tabs from the ⋯ menu", async () => {
    const user = userEvent.setup();
    renderPanel("conv-1");
    await user.click(
      await screen.findByTestId("conversation-app-panel-menu-button"),
    );

    await user.click(
      screen.getByTestId("conversation-app-panel-menu-open-details"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("demo-panel-context")).toHaveTextContent(
        "tab=details",
      ),
    );
    await user.click(screen.getByTestId("conversation-app-panel-menu-button"));
    await user.click(
      screen.getByTestId("conversation-app-panel-menu-pin-overview"),
    );

    expect(
      screen.queryByTestId("conversation-app-panel-tab-overview"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("conversation-app-panel-menu-pin-overview"),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      getConversationState("conv-1").appPanelTabs?.[DEMO_PANEL_KEY],
    ).toEqual({ selectedTab: "details", unpinnedTabs: ["overview"] });
  });

  it("shows the unavailable state when a tab's mount rejects, and recovers on another tab", async () => {
    const moduleLoader = async () => ({
      activate: (host: CanvasExtensionHost) => {
        host.registerPage("overview", async () => {
          throw new Error("The overview could not load.");
        });
        host.registerPage("details", ({ container }) => {
          container.textContent = "details mounted";
        });
      },
    });
    const user = userEvent.setup();
    renderPanel("conv-1", moduleLoader);

    expect(
      await screen.findByText("The overview could not load."),
    ).toBeInTheDocument();
    expect(screen.getByText("SETUP$UNAVAILABLE_TITLE")).toBeInTheDocument();

    await user.click(screen.getByTestId("conversation-app-panel-tab-details"));

    expect(await screen.findByText("details mounted")).toBeVisible();
    expect(
      screen.queryByText("The overview could not load."),
    ).not.toBeInTheDocument();
  });

  it("lets the page select another tab of its panel through surface.selectTab", async () => {
    const user = userEvent.setup();
    renderPanel("conv-1");

    await user.click(await screen.findByTestId("demo-panel-select-details"));

    await waitFor(() =>
      expect(screen.getByTestId("demo-panel-context")).toHaveTextContent(
        "tab=details",
      ),
    );
    expect(await panelContent()).toHaveAttribute("data-tab-id", "details");
  });
});
