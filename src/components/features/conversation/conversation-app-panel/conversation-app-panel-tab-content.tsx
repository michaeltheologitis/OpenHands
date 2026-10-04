import React from "react";
import type {
  RegisteredCanvasExtensionPanel,
  RegisteredCanvasExtensionPanelTab,
} from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { useCanvasExtensionMount } from "#/components/features/canvas-extensions/use-canvas-extension-mount";
import { useNavigation } from "#/context/navigation-context";
import { cn } from "#/utils/utils";
import { ConversationAppPanelUnavailable } from "./conversation-app-panel-unavailable";

export interface ConversationAppPanelTabContentProps {
  conversationId: string;
  panel: RegisteredCanvasExtensionPanel;
  tab: RegisteredCanvasExtensionPanelTab;
  selectTab: (tabId: string) => void;
}

/**
 * The selected tab's page, mounted while it is visible and disposed when the
 * tab, the conversation or the registration changes.
 */
// @spec CX-002 — A panel tab is mounted for the conversation it is shown in
export function ConversationAppPanelTabContent({
  conversationId,
  panel,
  tab,
  selectTab,
}: ConversationAppPanelTabContentProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { navigate } = useNavigation();
  const tabId = tab.contribution.id;
  const { error } = useCanvasExtensionMount(
    containerRef,
    tab.mount,
    {
      path: tab.contribution.path,
      navigate: (path) => navigate(path),
      conversationId,
      surface: {
        kind: "conversation-panel",
        panelId: panel.contribution.id,
        tabId,
        selectTab,
      },
    },
    JSON.stringify([conversationId, panel.key, tabId]),
  );

  // The container stays mounted under an error, so selecting another tab
  // has somewhere to mount into.
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        data-testid="conversation-app-panel-content"
        data-tab-id={tabId}
        className={cn("h-full min-h-0 overflow-auto", error && "hidden")}
      />
      {error ? <ConversationAppPanelUnavailable error={error} /> : null}
    </div>
  );
}
