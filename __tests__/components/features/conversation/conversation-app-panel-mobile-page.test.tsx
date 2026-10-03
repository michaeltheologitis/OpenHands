import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationAppPanelMobilePage } from "#/components/features/conversation/conversation-main/conversation-app-panel-mobile-page";
import { useConversationStore } from "#/stores/conversation-store";
import { renderWithProviders } from "../../../../test-utils";
import {
  PanelAppsRuntime,
  installPanelApps,
  uninstallPanelApps,
} from "../../../helpers/canvas-extension-panels";

function renderPage(panelId = "demo", onNavigateBack = vi.fn()) {
  renderWithProviders(
    <PanelAppsRuntime>
      <ConversationAppPanelMobilePage
        extensionName="demo-panel"
        panelId={panelId}
        onNavigateBack={onNavigateBack}
      />
    </PanelAppsRuntime>,
    { navigation: { conversationId: "conv-narrow" } },
  );
  return { onNavigateBack };
}

describe("ConversationAppPanelMobilePage", () => {
  beforeEach(() => {
    localStorage.clear();
    useConversationStore.setState({
      activeAppPanel: null,
      isRightPanelShown: false,
    });
    installPanelApps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallPanelApps();
  });

  it("shows the route's panel with its tabs and the selected tab's page for the conversation", async () => {
    renderPage();

    expect(
      await screen.findByRole("region", { name: "Demo panel" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("conversation-app-panel-tab-details"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("demo-panel-context")).toHaveTextContent(
        "conversation=conv-narrow path= tab=overview",
      ),
    );
    expect(useConversationStore.getState()).toMatchObject({
      activeAppPanel: null,
      isRightPanelShown: false,
    });
  });

  it("returns to the conversation with the back button", async () => {
    const user = userEvent.setup();
    const { onNavigateBack } = renderPage();
    await screen.findByRole("region", { name: "Demo panel" });

    await user.click(screen.getByTestId("conversation-app-panel-page-back"));

    expect(onNavigateBack).toHaveBeenCalledTimes(1);
  });

  it("shows the unavailable state once the App is active without that panel", async () => {
    renderPage("missing");

    expect(
      await screen.findByText("SETTINGS$APPS_PAGE_UNAVAILABLE"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("conversation-app-panel-page-back"),
    ).toBeInTheDocument();
  });
});
