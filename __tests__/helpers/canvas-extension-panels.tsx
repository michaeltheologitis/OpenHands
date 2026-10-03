import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import {
  CanvasExtensionsRuntimeProvider,
  type RegisteredCanvasExtensionPanel,
} from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import { toConversationAppPanelKey } from "#/stores/conversation-store";
import type {
  CanvasExtensionManifest,
  CanvasExtensionModule,
  CanvasExtensionPageMount,
  InstalledCanvasExtensionInfo,
} from "#/types/canvas-extension";
import demoPanelManifest from "#/fixtures/canvas-extensions/demo-panel/canvas-extension.json";

export const PANELS_BACKEND: Backend = {
  id: "panels-backend",
  name: "Panels backend",
  host: "http://127.0.0.1:8000",
  apiKey: "session-key",
  kind: "local",
};

/** The demo-panel fixture App, installed and enabled. */
export const DEMO_PANEL_EXTENSION: InstalledCanvasExtensionInfo = {
  name: "demo-panel",
  version: "0.1.0",
  enabled: true,
  source: "src/fixtures/canvas-extensions/demo-panel",
  resolved_ref: "working-tree",
  installed_at: "2026-10-01T00:00:00Z",
  install_path: "/tmp/demo-panel",
  manifest: demoPanelManifest as CanvasExtensionManifest,
};

export const DEMO_PANEL_KEY = toConversationAppPanelKey("demo-panel", "demo");

export interface DemoPanelLifecycle {
  mounted: number;
  disposed: number;
}

/** The fixture's mount and dispose counts since the last reset. */
export function demoPanelLifecycle(): DemoPanelLifecycle {
  const global = globalThis as { __demoPanelMounts?: DemoPanelLifecycle };
  global.__demoPanelMounts ??= { mounted: 0, disposed: 0 };
  return global.__demoPanelMounts;
}

export function resetDemoPanelLifecycle() {
  Object.assign(demoPanelLifecycle(), { mounted: 0, disposed: 0 });
}

const loadDemoPanelModule = () =>
  import("#/fixtures/canvas-extensions/demo-panel/extension.js") as Promise<CanvasExtensionModule>;

/**
 * Activate the given Apps on a local backend: the inventory and bundle
 * requests are answered at the service boundary, and every bundle loads as
 * `moduleLoader` (by default the demo-panel fixture's own module).
 */
export function installPanelApps(
  extensions: InstalledCanvasExtensionInfo[] = [DEMO_PANEL_EXTENSION],
) {
  setRegisteredBackends([PANELS_BACKEND]);
  setActiveSelection({ backendId: PANELS_BACKEND.id });
  vi.spyOn(CanvasExtensionsService, "listInstalled").mockResolvedValue(
    extensions,
  );
  vi.spyOn(CanvasExtensionsService, "fetchBundle").mockResolvedValue(
    "fixture bundle",
  );
}

export function uninstallPanelApps() {
  setActiveSelection(null);
  setRegisteredBackends([]);
}

interface PanelAppsRuntimeProps {
  children: React.ReactNode;
  moduleLoader?: (source: string) => Promise<CanvasExtensionModule>;
}

/** The real Canvas Extensions runtime, as the root layout provides it. */
export function PanelAppsRuntime({
  children,
  moduleLoader = loadDemoPanelModule,
}: PanelAppsRuntimeProps) {
  const [queryClient] = React.useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <MemoryRouter>
          <CanvasExtensionsRuntimeProvider moduleLoader={moduleLoader}>
            {children}
          </CanvasExtensionsRuntimeProvider>
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>
  );
}

/** A registered panel as plain data, for code that takes one as a prop. */
export function registeredPanel(
  extension: InstalledCanvasExtensionInfo,
  panelId: string,
  mount: CanvasExtensionPageMount = () => undefined,
): RegisteredCanvasExtensionPanel {
  const contribution =
    extension.manifest!.contributes!.conversation_panels!.find(
      ({ id }) => id === panelId,
    )!;
  return {
    key: toConversationAppPanelKey(extension.name, panelId),
    extension,
    contribution,
    tabs: contribution.tabs.map((tab) => ({
      extension,
      panel: contribution,
      contribution: { ...tab, path: tab.path.replace(/^\/+/, "") },
      mount,
    })),
  };
}
