import type { RegisteredCanvasExtensionPanel } from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import {
  useConversationLocalStorageState,
  type ConversationAppPanelTabState,
} from "#/utils/conversation-local-storage";

export interface ConversationAppPanelTabView {
  id: string;
  title: string;
  pinned: boolean;
}

export interface ConversationAppPanelTabsState {
  /** Every registered tab, in manifest order. */
  tabs: ConversationAppPanelTabView[];
  /** Pinned tabs, plus the selected tab when it is unpinned. */
  visibleTabs: ConversationAppPanelTabView[];
  /** Resolved at read time; always a registered tab. */
  selectedTabId: string;
  selectTab: (tabId: string) => void;
  /** Unpinning the selected tab selects the next pinned tab. */
  togglePin: (tabId: string) => void;
}

const NO_TAB_STATE: ConversationAppPanelTabState = {
  selectedTab: null,
  unpinnedTabs: [],
};

/** The single owner of a panel's selected tab and pins in a conversation. */
// @spec CX-003 — A panel's selected tab and pins are kept per conversation
export function useConversationAppPanelTabs(
  conversationId: string,
  panel: RegisteredCanvasExtensionPanel,
): ConversationAppPanelTabsState {
  const { state, setAppPanelTabState } =
    useConversationLocalStorageState(conversationId);
  const stored = state.appPanelTabs?.[panel.key] ?? NO_TAB_STATE;

  const tabs = panel.tabs.map(({ contribution }) => ({
    id: contribution.id,
    title: contribution.title,
    pinned: !stored.unpinnedTabs.includes(contribution.id),
  }));
  // The fallback is read-time only: nothing is written until the user picks.
  const selectedTabId =
    tabs.find(({ id }) => id === stored.selectedTab)?.id ??
    tabs.find(({ pinned }) => pinned)?.id ??
    tabs[0].id;
  const visibleTabs = tabs.filter(
    ({ id, pinned }) => pinned || id === selectedTabId,
  );

  const write = (next: ConversationAppPanelTabState) =>
    setAppPanelTabState?.(panel.key, next);

  const selectTab = (tabId: string) => {
    if (!tabs.some(({ id }) => id === tabId)) {
      console.warn(`Panel ${panel.key} has no tab "${tabId}".`);
      return;
    }
    write({ ...stored, selectedTab: tabId });
  };

  const togglePin = (tabId: string) => {
    if (stored.unpinnedTabs.includes(tabId)) {
      write({
        ...stored,
        unpinnedTabs: stored.unpinnedTabs.filter((id) => id !== tabId),
      });
      return;
    }
    const unpinnedTabs = [...stored.unpinnedTabs, tabId];
    const nextPinnedTab =
      tabId === selectedTabId
        ? tabs.find(({ id }) => id !== tabId && !unpinnedTabs.includes(id))
        : undefined;
    write({
      selectedTab: nextPinnedTab?.id ?? stored.selectedTab,
      unpinnedTabs,
    });
  };

  return { tabs, visibleTabs, selectedTabId, selectTab, togglePin };
}
