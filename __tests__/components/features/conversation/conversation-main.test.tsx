import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SidebarMobileNavProvider } from "#/components/features/sidebar/sidebar-mobile-nav-context";
import { NavigationProvider } from "#/context/navigation-context";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import {
  DEMO_PANEL_KEY,
  PanelAppsRuntime,
  installPanelApps,
  uninstallPanelApps,
} from "../../../helpers/canvas-extension-panels";

// Mutable mock state for controlling breakpoint
let mockIsMobile = false;
let mockIsRightPanelShown = false;
let mockActiveAppPanel: string | null = null;
let mockLeftWidth = 50;

// Track ChatInterface unmount via vi.fn()
const chatInterfaceUnmount = vi.fn();
const tabContentUnmount = vi.fn();

vi.mock("#/hooks/use-breakpoint", () => ({
  useBreakpoint: () => mockIsMobile,
  SIDEBAR_RAIL_COLLAPSE_MAX_WIDTH: 767,
}));

vi.mock("#/hooks/use-resizable-panels", () => ({
  useResizablePanels: () => ({
    leftWidth: mockLeftWidth,
    rightWidth: 100 - mockLeftWidth,
    isDragging: false,
    containerRef: { current: null },
    handleMouseDown: vi.fn(),
  }),
}));

vi.mock("#/stores/conversation-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#/stores/conversation-store")>()),
  useConversationStore: () => ({
    isRightPanelShown: mockIsRightPanelShown,
    activeAppPanel: mockActiveAppPanel,
  }),
}));

// Mock ChatInterface with useEffect to track mount/unmount lifecycle
vi.mock("#/components/features/chat/chat-interface", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const React = require("react");
  return {
    ChatInterface: () => {
      React.useEffect(() => {
        return () => chatInterfaceUnmount();
      }, []);
      return <div data-testid="chat-interface">Chat Interface</div>;
    },
  };
});

vi.mock(
  "#/components/features/conversation/conversation-tabs/conversation-tab-content/conversation-tab-content",
  () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const React = require("react");
    return {
      ConversationTabContent: () => {
        React.useEffect(() => () => tabContentUnmount(), []);
        return <div data-testid="tab-content" />;
      },
    };
  },
);

vi.mock(
  "#/components/features/conversation/conversation-app-panel/conversation-app-panel",
  () => ({
    ConversationAppPanel: ({
      conversationId,
      panel,
    }: {
      conversationId: string;
      panel: { key: string };
    }) => (
      <div data-testid="app-panel">
        {conversationId} {panel.key}
      </div>
    ),
  }),
);

// ConversationMain now renders the conversation name and tabs inline as the
// pane headers; both reach into route/store state we don't set up here, so
// stub them out for layout-stability tests.
vi.mock(
  "#/components/features/conversation/conversation-name-with-status",
  () => ({
    ConversationNameWithStatus: () => (
      <div data-testid="conversation-name-with-status" />
    ),
  }),
);

vi.mock(
  "#/components/features/conversation/conversation-tabs/conversation-tabs",
  () => ({
    ConversationTabs: () => <div data-testid="conversation-tabs" />,
  }),
);

import { ConversationMain } from "#/components/features/conversation/conversation-main/conversation-main";

function renderConversationMain() {
  return render(
    <SidebarMobileNavProvider>
      <ConversationMain />
    </SidebarMobileNavProvider>,
  );
}

describe("ConversationMain - Layout Transition Stability", () => {
  beforeEach(() => {
    mockIsMobile = false;
    mockIsRightPanelShown = false;
    mockLeftWidth = 50;
    chatInterfaceUnmount.mockClear();
  });

  it("renders ChatInterface at desktop width", () => {
    mockIsMobile = false;
    renderConversationMain();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });

  it("renders ChatInterface at mobile width", () => {
    mockIsMobile = true;
    renderConversationMain();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });

  it("does not unmount ChatInterface when crossing from desktop to mobile", () => {
    mockIsMobile = false;
    const { rerender } = renderConversationMain();
    expect(chatInterfaceUnmount).not.toHaveBeenCalled();

    // Cross the breakpoint to mobile
    mockIsMobile = true;
    rerender(
      <SidebarMobileNavProvider>
        <ConversationMain />
      </SidebarMobileNavProvider>,
    );

    // ChatInterface must NOT have been unmounted and remounted
    expect(chatInterfaceUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });

  it("does not unmount ChatInterface when crossing from mobile to desktop", () => {
    mockIsMobile = true;
    const { rerender } = renderConversationMain();
    expect(chatInterfaceUnmount).not.toHaveBeenCalled();

    // Cross the breakpoint to desktop
    mockIsMobile = false;
    rerender(
      <SidebarMobileNavProvider>
        <ConversationMain />
      </SidebarMobileNavProvider>,
    );

    // ChatInterface must NOT have been unmounted and remounted
    expect(chatInterfaceUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });

  it("survives rapid back-and-forth resize without unmounting ChatInterface", () => {
    mockIsMobile = false;
    const { rerender } = renderConversationMain();

    // Simulate rapid resize back and forth across the breakpoint
    for (const mobile of [true, false, true, false, true]) {
      mockIsMobile = mobile;
      rerender(
        <SidebarMobileNavProvider>
          <ConversationMain />
        </SidebarMobileNavProvider>,
      );
    }

    expect(chatInterfaceUnmount).not.toHaveBeenCalled();
    expect(screen.getByTestId("chat-interface")).toBeInTheDocument();
  });
});

// @spec CX-001 — An App panel never shares the right side with the drawer or the overview
describe("ConversationMain - App header panels", () => {
  function renderWithPanels() {
    const ui = () => (
      <NavigationProvider
        value={{
          currentPath: "/conversations/conv-1",
          conversationId: "conv-1",
          isNavigating: false,
          navigate: vi.fn(),
        }}
      >
        <PanelAppsRuntime>
          <SidebarMobileNavProvider>
            <ConversationMain />
          </SidebarMobileNavProvider>
        </PanelAppsRuntime>
      </NavigationProvider>
    );
    const rendered = render(ui());
    return { rerender: () => rendered.rerender(ui()) };
  }

  const rightColumn = () => screen.getByTestId("conversation-right-column");

  beforeEach(() => {
    mockIsMobile = false;
    mockIsRightPanelShown = false;
    mockActiveAppPanel = null;
    mockLeftWidth = 40;
    tabContentUnmount.mockClear();
    installPanelApps();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallPanelApps();
  });

  it("shows an open App panel in the drawer's column, keeping the drawer's content mounted but hidden", async () => {
    mockIsRightPanelShown = true;
    const { rerender } = renderWithPanels();
    expect(rightColumn()).toHaveStyle({ width: "60%" });

    mockIsRightPanelShown = false;
    mockActiveAppPanel = DEMO_PANEL_KEY;
    rerender();

    expect(await screen.findByTestId("app-panel")).toHaveTextContent(
      `conv-1 ${DEMO_PANEL_KEY}`,
    );
    expect(rightColumn()).toHaveStyle({ width: "60%" });
    expect(screen.getByTestId("tab-content")).not.toBeVisible();
    expect(tabContentUnmount).not.toHaveBeenCalled();
  });

  it("leaves the column closed for a panel that is not registered", async () => {
    mockActiveAppPanel = "uninstalled-app/panel";
    renderWithPanels();
    await waitFor(() =>
      expect(CanvasExtensionsService.fetchBundle).toHaveBeenCalled(),
    );

    expect(rightColumn()).toHaveStyle({ width: "0%" });
    expect(screen.queryByTestId("app-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-content")).toBeVisible();
  });
});
