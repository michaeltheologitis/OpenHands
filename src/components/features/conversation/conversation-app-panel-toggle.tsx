import { PanelRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCanvasExtensionsRuntime,
  type RegisteredCanvasExtensionPanel,
} from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { useNavigation } from "#/context/navigation-context";
import { useBreakpoint } from "#/hooks/use-breakpoint";
import { useOptionalConversationId } from "#/hooks/use-conversation-id";
import { useCanvasExtensionPanelIcon } from "#/hooks/query/use-canvas-extension-panel-icon";
import { I18nKey } from "#/i18n/declaration";
import { useConversationStore } from "#/stores/conversation-store";
import { buildConversationAppPanelPath } from "#/utils/conversation-app-panel-path";
import { mobileTopBarIconButtonClassName } from "#/utils/mobile-top-bar-icon-button-classes";
import { cn } from "#/utils/utils";
import { ChatActionTooltip } from "../chat/chat-action-tooltip";

export interface ConversationAppPanelToggleProps {
  panel: RegisteredCanvasExtensionPanel;
}

/** The header button of one App panel; mirrors `RightPanelToggle`. */
export function ConversationAppPanelToggle({
  panel,
}: ConversationAppPanelToggleProps) {
  const { t } = useTranslation("openhands");
  const isMobile = useBreakpoint();
  const { navigate } = useNavigation();
  const { conversationId } = useOptionalConversationId();
  const { activeAppPanel, openAppPanel, closeAppPanel } =
    useConversationStore();
  const icon = useCanvasExtensionPanelIcon(panel);

  const isOpen = !isMobile && activeAppPanel === panel.key;
  const tooltipText = t(
    isOpen
      ? I18nKey.CONVERSATION$HIDE_APP_PANEL
      : I18nKey.CONVERSATION$SHOW_APP_PANEL,
    { title: panel.contribution.title },
  );

  const handleToggle = () => {
    if (isMobile) {
      if (conversationId) {
        navigate(
          buildConversationAppPanelPath(
            conversationId,
            panel.extension.name,
            panel.contribution.id,
          ),
        );
      }
      return;
    }
    if (isOpen) closeAppPanel();
    else openAppPanel(panel.key);
  };

  // @spec CX-006 — Stable test ids for header panels
  return (
    <ChatActionTooltip tooltip={tooltipText} ariaLabel={tooltipText}>
      <button
        type="button"
        onClick={handleToggle}
        className={cn(
          mobileTopBarIconButtonClassName,
          "size-7 self-center",
          isOpen && "bg-contrast/10 text-foreground",
        )}
        aria-label={tooltipText}
        aria-pressed={isOpen}
        data-testid={`conversation-app-panel-toggle-${panel.extension.name}-${panel.contribution.id}`}
      >
        {icon ? (
          <img src={icon} alt="" className="size-5" />
        ) : (
          <PanelRight className="size-5" aria-hidden />
        )}
      </button>
    </ChatActionTooltip>
  );
}

/** One button per registered App panel, in panel order. */
export function ConversationAppPanelToggles() {
  const { conversationId } = useOptionalConversationId();
  const { panels } = useCanvasExtensionsRuntime();
  if (!conversationId) return null;
  return (
    <>
      {panels.map((panel) => (
        <ConversationAppPanelToggle key={panel.key} panel={panel} />
      ))}
    </>
  );
}
