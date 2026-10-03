import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConversationAppPanelTabs } from "#/hooks/use-conversation-app-panel-tabs";
import {
  LOCAL_STORAGE_KEYS,
  getConversationState,
  setConversationState,
} from "#/utils/conversation-local-storage";
import type { InstalledCanvasExtensionInfo } from "#/types/canvas-extension";
import {
  DEMO_PANEL_EXTENSION,
  DEMO_PANEL_KEY,
  registeredPanel,
} from "../helpers/canvas-extension-panels";

const demoPanel = registeredPanel(DEMO_PANEL_EXTENSION, "demo");

const twoPanelExtension: InstalledCanvasExtensionInfo = {
  ...DEMO_PANEL_EXTENSION,
  manifest: {
    ...DEMO_PANEL_EXTENSION.manifest!,
    contributes: {
      conversation_panels: [
        ...DEMO_PANEL_EXTENSION.manifest!.contributes!.conversation_panels!,
        {
          id: "other",
          title: "Other",
          tabs: [
            { id: "first", title: "First", path: "/" },
            { id: "second", title: "Second", path: "/second" },
          ],
        },
      ],
    },
  },
};

function renderTabs(conversationId: string, panel = demoPanel) {
  return renderHook(() => useConversationAppPanelTabs(conversationId, panel));
}

describe("useConversationAppPanelTabs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // @spec CX-003 — A panel's selected tab and pins are kept per conversation
  it("falls back to the first pinned tab when the stored one is gone, without writing", () => {
    setConversationState("conv-1", {
      appPanelTabs: {
        [DEMO_PANEL_KEY]: {
          selectedTab: "removed",
          unpinnedTabs: ["overview"],
        },
      },
    });
    const storedBefore = localStorage.getItem(
      `${LOCAL_STORAGE_KEYS.CONVERSATION_STATE}-conv-1`,
    );

    const { result } = renderTabs("conv-1");

    expect(result.current.selectedTabId).toBe("details");
    expect(result.current.visibleTabs.map(({ id }) => id)).toEqual(["details"]);
    expect(
      localStorage.getItem(`${LOCAL_STORAGE_KEYS.CONVERSATION_STATE}-conv-1`),
    ).toBe(storedBefore);
  });

  it("unpinning the selected tab selects the next pinned one and hides it", () => {
    const { result } = renderTabs("conv-1");
    act(() => result.current.selectTab("overview"));

    act(() => result.current.togglePin("overview"));

    expect(result.current.selectedTabId).toBe("details");
    expect(result.current.tabs).toEqual([
      { id: "overview", title: "Overview", pinned: false },
      { id: "details", title: "Details", pinned: true },
    ]);
    expect(result.current.visibleTabs.map(({ id }) => id)).toEqual(["details"]);
  });

  it("keeps an unpinned tab visible while it is selected", () => {
    const { result } = renderTabs("conv-1");

    act(() => result.current.togglePin("details"));
    act(() => result.current.selectTab("details"));

    expect(result.current.visibleTabs.map(({ id }) => id)).toEqual([
      "overview",
      "details",
    ]);
  });

  it("keeps the selection and pins per conversation and per panel", () => {
    const first = renderTabs("conv-1");
    act(() => first.result.current.selectTab("details"));
    act(() => first.result.current.togglePin("overview"));

    expect(renderTabs("conv-2").result.current.selectedTabId).toBe("overview");
    expect(
      renderTabs("conv-1", registeredPanel(twoPanelExtension, "other")).result
        .current.selectedTabId,
    ).toBe("first");
    expect(renderTabs("conv-1").result.current.selectedTabId).toBe("details");
    expect(getConversationState("conv-1").appPanelTabs).toEqual({
      [DEMO_PANEL_KEY]: { selectedTab: "details", unpinnedTabs: ["overview"] },
    });
  });

  it("ignores a tab the panel does not have, with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderTabs("conv-1");

    act(() => result.current.selectTab("missing"));

    expect(result.current.selectedTabId).toBe("overview");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"missing"'));
    warn.mockRestore();
  });
});
