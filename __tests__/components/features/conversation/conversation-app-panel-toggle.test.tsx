import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import { ConversationAppPanelToggles } from "#/components/features/conversation/conversation-app-panel-toggle";
import { useConversationStore } from "#/stores/conversation-store";
import type { InstalledCanvasExtensionInfo } from "#/types/canvas-extension";
import { renderWithProviders } from "../../../../test-utils";
import {
  DEMO_PANEL_EXTENSION,
  DEMO_PANEL_KEY,
  PANELS_BACKEND,
  PanelAppsRuntime,
  installPanelApps,
  uninstallPanelApps,
} from "../../../helpers/canvas-extension-panels";

const CONVERSATION_ID = "conv-panels";
const TOGGLE = "conversation-app-panel-toggle-demo-panel-demo";

const { breakpointIsMobile } = vi.hoisted(() => ({
  breakpointIsMobile: { value: false },
}));

vi.mock("#/hooks/use-breakpoint", () => ({
  useBreakpoint: () => breakpointIsMobile.value,
}));

const withoutIcon: InstalledCanvasExtensionInfo = {
  ...DEMO_PANEL_EXTENSION,
  manifest: {
    ...DEMO_PANEL_EXTENSION.manifest!,
    contributes: {
      conversation_panels: [
        {
          ...DEMO_PANEL_EXTENSION.manifest!.contributes!
            .conversation_panels![0],
          icon: null,
        },
        {
          id: "second",
          title: "Second panel",
          tabs: [{ id: "second-tab", title: "Second", path: "/" }],
        },
      ],
    },
  },
};

function renderToggles(navigate = vi.fn()) {
  renderWithProviders(
    <PanelAppsRuntime>
      <ConversationAppPanelToggles />
    </PanelAppsRuntime>,
    { navigation: { conversationId: CONVERSATION_ID, navigate } },
  );
  return { navigate };
}

describe("ConversationAppPanelToggles", () => {
  beforeEach(() => {
    breakpointIsMobile.value = false;
    useConversationStore.setState({
      activeAppPanel: null,
      isRightPanelShown: false,
    });
    installPanelApps();
    vi.spyOn(CanvasExtensionsService, "fetchPanelIcon").mockResolvedValue(
      new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], {
        type: "image/svg+xml",
      }),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallPanelApps();
  });

  it("renders no button on a Cloud backend", async () => {
    const cloud = { ...PANELS_BACKEND, id: "cloud", kind: "cloud" as const };
    setRegisteredBackends([cloud]);
    setActiveSelection({ backendId: cloud.id });

    renderToggles();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });

    expect(CanvasExtensionsService.listInstalled).not.toHaveBeenCalled();
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();
  });

  it("renders no button for an App whose panel has no registered tab", async () => {
    renderWithProviders(
      <PanelAppsRuntime moduleLoader={async () => ({ activate: () => {} })}>
        <ConversationAppPanelToggles />
      </PanelAppsRuntime>,
      { navigation: { conversationId: CONVERSATION_ID } },
    );

    await waitFor(() =>
      expect(CanvasExtensionsService.fetchBundle).toHaveBeenCalled(),
    );
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();
  });

  it("renders one button per registered panel, in panel order", async () => {
    vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
      withoutIcon,
    ]);
    renderWithProviders(
      <PanelAppsRuntime
        moduleLoader={async () => ({
          activate: (host) => {
            host.registerPage("second-tab", () => undefined);
            host.registerPage("overview", () => undefined);
          },
        })}
      >
        <div data-testid="group">
          <ConversationAppPanelToggles />
        </div>
      </PanelAppsRuntime>,
      { navigation: { conversationId: CONVERSATION_ID } },
    );

    await waitFor(() =>
      expect(
        within(screen.getByTestId("group"))
          .getAllByRole("button")
          .map((button) => button.dataset.testid),
      ).toEqual([TOGGLE, "conversation-app-panel-toggle-demo-panel-second"]),
    );
  });

  it("opens and closes its panel, with the tooltip and pressed state following", async () => {
    const user = userEvent.setup();
    renderToggles();
    const toggle = await screen.findByTestId(TOGGLE);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(toggle).toHaveAccessibleName("CONVERSATION$SHOW_APP_PANEL");

    await user.click(toggle);

    expect(useConversationStore.getState().activeAppPanel).toBe(DEMO_PANEL_KEY);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(toggle).toHaveAccessibleName("CONVERSATION$HIDE_APP_PANEL");

    await user.click(toggle);

    expect(useConversationStore.getState().activeAppPanel).toBeNull();
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("navigates to the panel's page on a narrow window instead of opening the column", async () => {
    breakpointIsMobile.value = true;
    const user = userEvent.setup();
    const { navigate } = renderToggles();

    await user.click(await screen.findByTestId(TOGGLE));

    expect(navigate).toHaveBeenCalledWith(
      `/conversations/${CONVERSATION_ID}/panel/demo-panel/demo`,
    );
    expect(useConversationStore.getState().activeAppPanel).toBeNull();
    expect(screen.getByTestId(TOGGLE)).toHaveAttribute("aria-pressed", "false");
  });

  it("shows the panel's icon, fetched with the session key", async () => {
    renderToggles();

    const toggle = await screen.findByTestId(TOGGLE);

    await waitFor(() =>
      expect(toggle.querySelector("img")?.getAttribute("src")).toMatch(
        /^data:image\/svg\+xml/,
      ),
    );
    expect(CanvasExtensionsService.fetchPanelIcon).toHaveBeenCalledWith(
      "demo-panel",
      "demo",
      expect.objectContaining({ kind: "local" }),
    );
  });

  it("draws the default glyph without fetching when the panel has no icon", async () => {
    vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
      withoutIcon,
    ]);

    renderToggles();
    const toggle = await screen.findByTestId(TOGGLE);

    expect(toggle.querySelector("svg.lucide-panel-right")).not.toBeNull();
    expect(toggle.querySelector("img")).toBeNull();
    expect(CanvasExtensionsService.fetchPanelIcon).not.toHaveBeenCalled();
  });

  it("keeps the default glyph when the agent-server cannot serve the icon", async () => {
    vi.mocked(CanvasExtensionsService.fetchPanelIcon).mockRejectedValue(
      new Error("HTTP 404"),
    );

    renderToggles();
    const toggle = await screen.findByTestId(TOGGLE);
    await waitFor(() =>
      expect(CanvasExtensionsService.fetchPanelIcon).toHaveBeenCalled(),
    );
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(toggle.querySelector("svg.lucide-panel-right")).not.toBeNull();
    expect(toggle.querySelector("img")).toBeNull();
  });
});
