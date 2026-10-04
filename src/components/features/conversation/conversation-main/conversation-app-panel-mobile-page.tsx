import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  useCanvasExtensionsRuntime,
  useRegisteredAppPanel,
} from "#/components/features/canvas-extensions/canvas-extensions-runtime";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import { useConversationId } from "#/hooks/use-conversation-id";
import { I18nKey } from "#/i18n/declaration";
import { toConversationAppPanelKey } from "#/stores/conversation-store";
import {
  mobileTopBarIconButtonClassName,
  mobileTopBarIconClassName,
} from "#/utils/mobile-top-bar-icon-button-classes";
import { ConversationAppPanel } from "../conversation-app-panel/conversation-app-panel";
import { ConversationAppPanelUnavailable } from "../conversation-app-panel/conversation-app-panel-unavailable";

export interface ConversationAppPanelMobilePageProps {
  extensionName: string;
  panelId: string;
  onNavigateBack: () => void;
}

/**
 * An App panel as a page of its own on a narrow window, as the drawer's
 * `/panel` page is. It leaves the drawer and App panel state alone.
 */
export function ConversationAppPanelMobilePage({
  extensionName,
  panelId,
  onNavigateBack,
}: ConversationAppPanelMobilePageProps) {
  const { t } = useTranslation("openhands");
  const { conversationId } = useConversationId();
  const { activating, errors } = useCanvasExtensionsRuntime();
  const panel = useRegisteredAppPanel(
    toConversationAppPanelKey(extensionName, panelId),
  );

  const backButton = (
    <button
      type="button"
      data-testid="conversation-app-panel-page-back"
      onClick={onNavigateBack}
      aria-label={t(I18nKey.COMMON$BACK)}
      className={mobileTopBarIconButtonClassName}
    >
      <ChevronLeft
        size={20}
        className={mobileTopBarIconClassName}
        aria-hidden
        strokeWidth={2}
      />
    </button>
  );

  if (panel) {
    return (
      <div
        data-testid="conversation-app-panel-page"
        className="flex h-full min-h-0 flex-col bg-surface"
      >
        <ConversationAppPanel
          conversationId={conversationId}
          panel={panel}
          variant="compact"
          leading={backButton}
        />
      </div>
    );
  }

  return (
    <div
      data-testid="conversation-app-panel-page"
      className="flex h-full min-h-0 flex-col bg-surface"
    >
      <div className="flex h-10 min-h-10 shrink-0 items-center border-b border-border pl-2.5">
        {backButton}
      </div>
      {activating ? (
        <div className="flex flex-1 items-center justify-center">
          <LoadingSpinner size="large" />
        </div>
      ) : (
        <ConversationAppPanelUnavailable
          error={errors.get(extensionName) ?? null}
        />
      )}
    </div>
  );
}
