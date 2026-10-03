import React from "react";
import ReactDOM from "react-dom";
import { useTranslation } from "react-i18next";
import { useClickOutsideElement } from "#/hooks/use-click-outside-element";
import type { ConversationAppPanelTabsState } from "#/hooks/use-conversation-app-panel-tabs";
import { I18nKey } from "#/i18n/declaration";
import PillIcon from "#/icons/pill.svg?react";
import PillFillIcon from "#/icons/pill-fill.svg?react";
import { ContextMenu } from "#/ui/context-menu";
import { dropdownInstantColorClassName } from "#/utils/dropdown-classes";
import { cn } from "#/utils/utils";

export interface ConversationAppPanelTabsMenuProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  tabs: ConversationAppPanelTabsState;
}

const MENU_GAP_PX = 8;

/**
 * Every tab of an App panel with "open" and "pin", like the drawer's ⋯ menu;
 * portaled to the body so the panel's overflow does not clip it.
 */
export function ConversationAppPanelTabsMenu({
  isOpen,
  onClose,
  anchorRef,
  tabs,
}: ConversationAppPanelTabsMenuProps) {
  const { t } = useTranslation("openhands");
  const ref = useClickOutsideElement<HTMLUListElement>(onClose, anchorRef);
  const [position, setPosition] = React.useState<React.CSSProperties>();

  React.useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition({
        position: "fixed",
        zIndex: 9999,
        top: rect.bottom + MENU_GAP_PX,
        left: rect.left,
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, anchorRef]);

  if (!isOpen || typeof document === "undefined") return null;

  return ReactDOM.createPortal(
    <div style={position}>
      <ContextMenu
        ref={ref}
        theme="popover"
        position="none"
        alignment="none"
        spacing="none"
        className="w-fit"
      >
        {tabs.tabs.map(({ id, title, pinned }) => (
          <li key={id} className="list-none">
            <div className="group flex h-7.5 w-full min-w-0 items-stretch rounded hover:bg-interactive-hover">
              <button
                type="button"
                data-testid={`conversation-app-panel-menu-open-${id}`}
                className={cn(
                  "flex min-w-0 flex-1 cursor-pointer items-center rounded-l p-2 text-start text-sm text-contrast",
                  dropdownInstantColorClassName,
                )}
                onClick={() => {
                  tabs.selectTab(id);
                  onClose();
                }}
              >
                {title}
              </button>
              <button
                type="button"
                data-testid={`conversation-app-panel-menu-pin-${id}`}
                className={cn(
                  "flex shrink-0 cursor-pointer items-center justify-center rounded-r px-2 text-contrast hover:bg-contrast/10",
                  dropdownInstantColorClassName,
                )}
                aria-pressed={pinned}
                aria-label={t(
                  pinned
                    ? I18nKey.CONVERSATION$UNPIN_TAB
                    : I18nKey.CONVERSATION$PIN_TAB,
                )}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  tabs.togglePin(id);
                }}
              >
                {pinned ? (
                  <PillFillIcon className="-mr-1.25 h-7 w-7" aria-hidden />
                ) : (
                  <PillIcon className="h-4.5 w-4.5" aria-hidden />
                )}
              </button>
            </div>
          </li>
        ))}
      </ContextMenu>
    </div>,
    document.body,
  );
}
