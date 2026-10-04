import React from "react";
import { useTranslation } from "react-i18next";
import type { RegisteredCanvasExtensionPanel } from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { EllipsisButton } from "#/components/features/conversation-panel/ellipsis-button";
import { useConversationAppPanelTabs } from "#/hooks/use-conversation-app-panel-tabs";
import { I18nKey } from "#/i18n/declaration";
import { useConversationStore } from "#/stores/conversation-store";
import { mobileTopBarIconClassName } from "#/utils/mobile-top-bar-icon-button-classes";
import { cn } from "#/utils/utils";
import { ConversationTabNav } from "../conversation-tabs/conversation-tab-nav";
import { ConversationAppPanelTabContent } from "./conversation-app-panel-tab-content";
import { ConversationAppPanelTabsMenu } from "./conversation-app-panel-tabs-menu";

export interface ConversationAppPanelProps {
  conversationId: string;
  panel: RegisteredCanvasExtensionPanel;
  /** "compact" fits a page's top bar. */
  variant?: "default" | "compact";
  /** Rendered before the tab row, such as a back button. */
  leading?: React.ReactNode;
}

/**
 * One App panel: its tab row with a ⋯ menu, above the selected tab's page.
 * Clicking the selected tab closes the panel, as the drawer's tabs do.
 */
export function ConversationAppPanel({
  conversationId,
  panel,
  variant = "default",
  leading,
}: ConversationAppPanelProps) {
  const { t } = useTranslation("openhands");
  const tabs = useConversationAppPanelTabs(conversationId, panel);
  const { closeAppPanel } = useConversationStore();
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const menuButtonRef = React.useRef<HTMLButtonElement>(null);
  const selectedTab =
    panel.tabs.find(
      ({ contribution }) => contribution.id === tabs.selectedTabId,
    ) ?? panel.tabs[0];

  // @spec CX-006 — Stable test ids for header panels
  return (
    <section
      aria-label={panel.contribution.title}
      data-testid="conversation-app-panel"
      className="flex min-h-0 flex-1 flex-col"
    >
      <div
        className={cn(
          "flex shrink-0 items-center border-b border-border",
          variant === "compact"
            ? "h-10 min-h-10 gap-1.5 pl-2.5"
            : "min-h-10 p-1",
        )}
      >
        {leading}
        {/* App tabs are text, so the row scrolls instead of measuring. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {tabs.visibleTabs.map(({ id, title }) => (
            <ConversationTabNav
              key={id}
              tabValue={id}
              testId={`conversation-app-panel-tab-${id}`}
              label={title}
              isActive={id === tabs.selectedTabId}
              className="shrink-0"
              onClick={() =>
                id === tabs.selectedTabId ? closeAppPanel() : tabs.selectTab(id)
              }
            />
          ))}
          <EllipsisButton
            ref={menuButtonRef}
            testId="conversation-app-panel-menu-button"
            className="shrink-0"
            onClick={() => setIsMenuOpen((open) => !open)}
            ariaLabel={t(I18nKey.COMMON$MORE_OPTIONS)}
            iconClassName={
              variant === "compact" ? mobileTopBarIconClassName : undefined
            }
          />
        </div>
        <ConversationAppPanelTabsMenu
          isOpen={isMenuOpen}
          onClose={() => setIsMenuOpen(false)}
          anchorRef={menuButtonRef}
          tabs={tabs}
        />
      </div>
      <ConversationAppPanelTabContent
        conversationId={conversationId}
        panel={panel}
        tab={selectedTab}
        selectTab={tabs.selectTab}
      />
    </section>
  );
}
