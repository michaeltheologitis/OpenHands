import { screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localAgentServerHasCapability } from "#/api/agent-server-compatibility";
import type { InstalledCanvasExtensionInfo } from "#/types/canvas-extension";
import { renderWithProviders } from "../../../../test-utils";
import {
  DEMO_PANEL_EXTENSION,
  PanelAppsRuntime,
  installPanelApps,
  uninstallPanelApps,
} from "../../../../__tests__/helpers/canvas-extension-panels";
import { CanvasExtensionCard } from "./canvas-extension-card";

vi.mock("#/api/agent-server-compatibility", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("#/api/agent-server-compatibility")
  >()),
  localAgentServerHasCapability: vi.fn(() => true),
}));

/** The demo App as an agent-server without panels lists it: the key dropped. */
const withoutPanelSupport: InstalledCanvasExtensionInfo = {
  ...DEMO_PANEL_EXTENSION,
  manifest: { ...DEMO_PANEL_EXTENSION.manifest!, contributes: {} },
};

function renderCard(extension: InstalledCanvasExtensionInfo) {
  installPanelApps([extension]);
  renderWithProviders(
    <PanelAppsRuntime>
      <CanvasExtensionCard
        extension={extension}
        isBusy={false}
        onToggle={vi.fn()}
        onRefresh={vi.fn()}
        onUninstall={vi.fn()}
      />
    </PanelAppsRuntime>,
  );
  return screen.getByTestId(`canvas-extension-card-${extension.name}`);
}

describe("CanvasExtensionCard", () => {
  beforeEach(() => {
    vi.mocked(localAgentServerHasCapability).mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    uninstallPanelApps();
  });

  it("lists the App's header panels by title with their count", () => {
    const card = renderCard(DEMO_PANEL_EXTENSION);

    expect(within(card).getByText("SETTINGS$APPS_PANELS: 1")).toBeVisible();
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["Demo panel"]);
  });

  // @spec CX-004 — on an agent-server without conversation panels the refusal does not fail the App
  it("says why an App's panels are missing on an agent-server without panels", async () => {
    vi.mocked(localAgentServerHasCapability).mockReturnValue(false);

    const card = renderCard(withoutPanelSupport);

    expect(
      await within(card).findByText("SETTINGS$APPS_PANELS_UNSUPPORTED"),
    ).toBeVisible();
  });

  it("shows the App's activation error", async () => {
    const card = renderCard(withoutPanelSupport);

    expect(
      await within(card).findByText(
        'Extension demo-panel registered undeclared page "overview".',
      ),
    ).toBeVisible();
  });
});
