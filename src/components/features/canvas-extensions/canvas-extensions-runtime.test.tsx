import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import CanvasExtensionsService from "#/api/canvas-extensions-service";
import { localAgentServerHasCapability } from "#/api/agent-server-compatibility";
import { mountAppBackendFrame } from "#/extensions/mount-app-backend-frame";
import {
  setActiveSelection,
  setRegisteredBackends,
} from "#/api/backend-registry/active-store";
import type { Backend } from "#/api/backend-registry/types";
import { ActiveBackendProvider } from "#/contexts/active-backend-context";
import type {
  CanvasExtensionHost,
  InstalledCanvasExtensionInfo,
} from "#/types/canvas-extension";
import {
  CanvasExtensionsRuntimeProvider,
  useCanvasExtensionsRuntime,
} from "./canvas-extensions-runtime";

vi.mock("#/extensions/mount-app-backend-frame", () => ({
  mountAppBackendFrame: vi.fn(() => () => undefined),
}));

vi.mock("#/api/agent-server-compatibility", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#/api/agent-server-compatibility")
  >()),
  localAgentServerHasCapability: vi.fn(() => true),
}));

const backend: Backend = {
  id: "extension-backend",
  name: "Extension backend",
  host: "http://127.0.0.1:8000",
  apiKey: "test-key",
  kind: "local",
};

const extension: InstalledCanvasExtensionInfo = {
  name: "demo-extension",
  version: "0.1.0",
  enabled: true,
  source: "github:example/demo",
  resolved_ref: "abc123",
  installed_at: "2026-08-01T00:00:00Z",
  install_path: "/tmp/demo-extension",
  manifest: {
    schema_version: 1,
    name: "demo-extension",
    display_name: "Demo extension",
    version: "0.1.0",
    entrypoint: "dist/extension.js",
    contributes: {
      pages: [
        {
          id: "dashboard",
          title: "Dashboard",
          path: "/dashboard",
          nav_label: "Demo dashboard",
        },
      ],
    },
  },
};

const panelExtension: InstalledCanvasExtensionInfo = {
  ...extension,
  manifest: {
    ...extension.manifest!,
    contributes: {
      ...extension.manifest!.contributes,
      conversation_panels: [
        {
          id: "insights",
          title: "Insights",
          icon: null,
          tabs: [
            { id: "overview", title: "Overview", path: "/" },
            { id: "details", title: "Details", path: "/details" },
          ],
        },
        {
          id: "notes",
          title: "Notes",
          tabs: [{ id: "notes-list", title: "List", path: "/" }],
        },
      ],
    },
  },
};

function RuntimeProbe() {
  const runtime = useCanvasExtensionsRuntime();
  return (
    <div>
      <span data-testid="page-count">{runtime.pages.length}</span>
      <span data-testid="page-href">{runtime.pages[0]?.href}</span>
      <span data-testid="runtime-error">
        {runtime.errors.get(extension.name)}
      </span>
      <span data-testid="runtime-notice">
        {runtime.notices.get(extension.name)}
      </span>
      <span data-testid="panels">
        {runtime.panels
          .map(
            (panel) =>
              `${panel.key}=${panel.tabs.map((tab) => `${tab.contribution.id}@${tab.contribution.path}`).join(",")}`,
          )
          .join(" ")}
      </span>
    </div>
  );
}

function renderRuntime(
  moduleLoader: (source: string) => Promise<{
    activate: (host: CanvasExtensionHost) => void | (() => void);
  }>,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <ActiveBackendProvider>
        <MemoryRouter>
          <CanvasExtensionsRuntimeProvider moduleLoader={moduleLoader}>
            <RuntimeProbe />
          </CanvasExtensionsRuntimeProvider>
        </MemoryRouter>
      </ActiveBackendProvider>
    </QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

describe("CanvasExtensionsRuntimeProvider", () => {
  beforeEach(() => {
    setRegisteredBackends([backend]);
    setActiveSelection({ backendId: backend.id });
    vi.spyOn(CanvasExtensionsService, "listInstalled").mockResolvedValue([
      extension,
    ]);
    vi.spyOn(CanvasExtensionsService, "fetchBundle").mockResolvedValue(
      "fixture source",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setActiveSelection(null);
    setRegisteredBackends([]);
  });

  it("activates enabled extensions and admits declared page registrations", async () => {
    const disposeActivation = vi.fn();
    const moduleLoader = vi.fn().mockResolvedValue({
      activate: (host: CanvasExtensionHost) => {
        host.registerPage("dashboard", () => undefined);
        return disposeActivation;
      },
    });

    const rendered = renderRuntime(moduleLoader);

    await waitFor(() =>
      expect(screen.getByTestId("page-count")).toHaveTextContent("1"),
    );
    expect(screen.getByTestId("page-href")).toHaveTextContent(
      "/extensions/demo-extension/dashboard",
    );
    expect(CanvasExtensionsService.fetchBundle).toHaveBeenCalledWith(
      extension.name,
      expect.objectContaining({ id: backend.id }),
    );

    rendered.unmount();
    expect(disposeActivation).toHaveBeenCalledTimes(1);
  });

  it("re-activates an extension refreshed without a version change", async () => {
    const disposeActivation = vi.fn();
    const moduleLoader = vi.fn().mockResolvedValue({
      activate: () => disposeActivation,
    });

    const { queryClient } = renderRuntime(moduleLoader);
    await waitFor(() => expect(moduleLoader).toHaveBeenCalledTimes(1));

    vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
      { ...extension, installed_at: "2026-08-02T00:00:00Z" },
    ]);
    await queryClient.invalidateQueries();

    await waitFor(() => expect(moduleLoader).toHaveBeenCalledTimes(2));
    expect(disposeActivation).toHaveBeenCalledTimes(1);
  });

  it("rejects registrations that were not declared in the manifest", async () => {
    const moduleLoader = vi.fn().mockResolvedValue({
      activate: (host: CanvasExtensionHost) => {
        host.registerPage("surprise", () => undefined);
      },
    });

    renderRuntime(moduleLoader);

    await waitFor(() =>
      expect(screen.getByTestId("runtime-error")).toHaveTextContent(
        'registered undeclared page "surprise"',
      ),
    );
    expect(screen.getByTestId("page-count")).toHaveTextContent("0");
  });

  it("degrades gracefully when the backend response has no manifest", async () => {
    vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
      { ...extension, manifest: null },
    ]);
    const moduleLoader = vi.fn().mockResolvedValue({
      activate: (host: CanvasExtensionHost) => {
        host.registerPage("dashboard", () => undefined);
      },
    });

    renderRuntime(moduleLoader);

    await waitFor(() =>
      expect(screen.getByTestId("runtime-error")).toHaveTextContent(
        'registered undeclared page "dashboard"',
      ),
    );
    expect(screen.getByTestId("page-count")).toHaveTextContent("0");
  });

  describe("conversation panels", () => {
    beforeEach(() => {
      vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
        panelExtension,
      ]);
      vi.mocked(localAgentServerHasCapability).mockReturnValue(true);
    });

    const registering =
      (...ids: string[]) =>
      (host: CanvasExtensionHost) => {
        for (const id of ids) host.registerPage(id, () => undefined);
      };

    it("lists a panel with its registered tabs in manifest order, paths without the leading slash", async () => {
      renderRuntime(
        vi.fn().mockResolvedValue({
          activate: registering("details", "overview"),
        }),
      );

      await waitFor(() =>
        expect(screen.getByTestId("panels")).toHaveTextContent(
          "demo-extension/insights=overview@,details@details",
        ),
      );
      expect(screen.getByTestId("panels")).not.toHaveTextContent("notes");
    });

    it.each([
      ["a panel's own id", "insights", 'registered panel "insights"'],
      ["an undeclared id", "surprise", 'registered undeclared page "surprise"'],
    ])(
      "fails activation when an App registers %s",
      async (_label, id, message) => {
        renderRuntime(vi.fn().mockResolvedValue({ activate: registering(id) }));

        await waitFor(() =>
          expect(screen.getByTestId("runtime-error")).toHaveTextContent(
            message,
          ),
        );
        expect(screen.getByTestId("panels")).toBeEmptyDOMElement();
      },
    );

    // @spec CX-004 — on an agent-server without conversation panels the refusal does not fail the App
    it("refuses tab registrations without failing the App on an agent-server without panels", async () => {
      vi.mocked(localAgentServerHasCapability).mockReturnValue(false);
      vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
        extension,
      ]);
      const disposeTab = vi.fn();
      const activate = vi.fn((host: CanvasExtensionHost) => {
        disposeTab.mockImplementation(host.registerPage("overview", vi.fn()));
        host.registerPage("dashboard", () => undefined);
      });

      renderRuntime(vi.fn().mockResolvedValue({ activate }));

      await waitFor(() =>
        expect(screen.getByTestId("page-count")).toHaveTextContent("1"),
      );
      expect(screen.getByTestId("runtime-error")).toBeEmptyDOMElement();
      expect(screen.getByTestId("runtime-notice")).toHaveTextContent(
        "SETTINGS$APPS_PANELS_UNSUPPORTED",
      );
      expect(screen.getByTestId("panels")).toBeEmptyDOMElement();
      expect(() => disposeTab()).not.toThrow();
    });

    it("removes an App's panels when it is disabled", async () => {
      const { queryClient } = renderRuntime(
        vi.fn().mockResolvedValue({ activate: registering("overview") }),
      );
      await waitFor(() =>
        expect(screen.getByTestId("panels")).toHaveTextContent("insights"),
      );

      vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
        { ...panelExtension, enabled: false },
      ]);
      await queryClient.invalidateQueries();

      await waitFor(() =>
        expect(screen.getByTestId("panels")).toBeEmptyDOMElement(),
      );
    });

    it("re-activates an App whose manifest panels change", async () => {
      const moduleLoader = vi
        .fn()
        .mockResolvedValue({ activate: registering("overview") });
      const { queryClient } = renderRuntime(moduleLoader);
      await waitFor(() => expect(moduleLoader).toHaveBeenCalledTimes(1));

      const panels = panelExtension.manifest!.contributes!.conversation_panels!;
      vi.mocked(CanvasExtensionsService.listInstalled).mockResolvedValue([
        {
          ...panelExtension,
          manifest: {
            ...panelExtension.manifest!,
            contributes: {
              conversation_panels: [{ ...panels[0], title: "Renamed" }],
            },
          },
        },
      ]);
      await queryClient.invalidateQueries();

      await waitFor(() => expect(moduleLoader).toHaveBeenCalledTimes(2));
    });
  });

  it("gives each App a frame mounter bound to that App and its backend", async () => {
    const container = document.createElement("div");
    const onError = vi.fn();
    const moduleLoader = vi.fn().mockResolvedValue({
      activate: (host: CanvasExtensionHost) => {
        host.registerPage("dashboard", () => undefined);
        host.appBackend.mountFrame(container, { title: "Dashboard", onError });
      },
    });

    renderRuntime(moduleLoader);

    await waitFor(() =>
      expect(mountAppBackendFrame).toHaveBeenCalledWith(
        {
          backend: expect.objectContaining({ id: backend.id }),
          extensionName: extension.name,
        },
        container,
        { title: "Dashboard", onError },
      ),
    );
  });
});
