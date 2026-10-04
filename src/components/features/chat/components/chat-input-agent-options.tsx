import React from "react";
import { useTranslation } from "react-i18next";
import type { ACPConfigOption } from "@openhands/typescript-client";
import { ContextMenuListItem } from "#/components/features/context-menu/context-menu-list-item";
import { LoadingSpinner } from "#/components/shared/loading-spinner";
import type { AgentControls } from "#/hooks/chat/use-agent-controls";
import { useClickOutsideElement } from "#/hooks/use-click-outside-element";
import { I18nKey } from "#/i18n/declaration";
import CheckIcon from "#/icons/checkmark.svg?react";
import { ComboboxCaretInline } from "#/ui/combobox-caret";
import { ContextMenu } from "#/ui/context-menu";
import { Typography } from "#/ui/typography";
import { chatInputPillButtonClassName } from "#/utils/form-control-classes";
import { cn } from "#/utils/utils";

export interface ChatInputAgentOptionsProps {
  controls: AgentControls;
  disabled?: boolean;
}

interface AgentOptionPillProps {
  option: ACPConfigOption;
  pendingValue: string | boolean | undefined;
  disabled: boolean;
  onSelect: (value: string) => void;
}

function valueLabel(option: ACPConfigOption, value: string | boolean) {
  return (
    option.options.find((choice) => choice.value === value)?.name ??
    String(value)
  );
}

/** The values of a select, under a header per distinct group. */
function AgentOptionValues({
  option,
  onSelect,
}: {
  option: ACPConfigOption;
  onSelect: (value: string) => void;
}) {
  let previousGroup: string | null | undefined;
  return option.options.flatMap((choice) => {
    const header =
      choice.group && choice.group !== previousGroup ? (
        <li
          key={`group-${choice.group}`}
          role="presentation"
          className="px-2 pt-1 pb-0.5"
        >
          <Typography.Text className="text-[11px] font-medium uppercase leading-4 tracking-wide text-text-dim">
            {choice.group}
          </Typography.Text>
        </li>
      ) : null;
    previousGroup = choice.group;
    const isCurrent = choice.value === option.current_value;
    const row = (
      <li key={choice.value} className="list-none">
        <ContextMenuListItem
          testId={`agent-option-${option.id}-value-${choice.value}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onSelect(choice.value);
          }}
          className={cn(
            "flex items-center gap-2",
            isCurrent && "bg-interactive-hover",
          )}
        >
          <span
            className="flex-1 truncate text-sm leading-5"
            title={choice.description ?? undefined}
          >
            {choice.name}
          </span>
          {isCurrent ? (
            <CheckIcon
              width={14}
              height={14}
              className="shrink-0"
              aria-hidden
            />
          ) : null}
        </ContextMenuListItem>
      </li>
    );
    return header ? [header, row] : [row];
  });
}

function AgentOptionPill({
  option,
  pendingValue,
  disabled,
  onSelect,
}: AgentOptionPillProps) {
  const { t } = useTranslation("openhands");
  const [isOpen, setIsOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = useClickOutsideElement<HTMLUListElement>(
    () => setIsOpen(false),
    triggerRef,
  );
  const shownValue = pendingValue ?? option.current_value;
  const label = `${option.name}: ${valueLabel(option, shownValue)}`;

  // One value left is how an agent says the option cannot change any more.
  if (option.options.length < 2) {
    return (
      <span
        data-testid={`agent-option-${option.id}`}
        data-value={String(shownValue)}
        data-fixed="true"
        title={
          option.description || t(I18nKey.CHAT_INTERFACE$AGENT_OPTION_FIXED)
        }
        className={cn(chatInputPillButtonClassName, "cursor-default")}
      >
        {label}
      </span>
    );
  }

  return (
    <div className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        data-testid={`agent-option-${option.id}`}
        data-value={String(shownValue)}
        className={chatInputPillButtonClassName}
        title={option.description ?? undefined}
        disabled={disabled || pendingValue !== undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((open) => !open);
        }}
      >
        <span>{label}</span>
        {pendingValue !== undefined ? (
          <LoadingSpinner
            size="small"
            className="size-4"
            outerClassName="size-4"
          />
        ) : (
          <ComboboxCaretInline isOpen={isOpen} />
        )}
      </button>
      {isOpen ? (
        <ContextMenu
          ref={menuRef}
          testId={`agent-option-${option.id}-menu`}
          position="top"
          alignment="left"
          spacing="none"
          className="z-[60] mb-2 max-h-[60vh] min-w-50 max-w-80 overflow-y-auto"
        >
          <AgentOptionValues
            option={option}
            onSelect={(value) => {
              setIsOpen(false);
              if (value !== option.current_value) onSelect(value);
            }}
          />
        </ContextMenu>
      ) : null}
    </div>
  );
}

/**
 * The agent's config options (except the model) as pickers above the message
 * input, one pill per option in the agent's order.
 */
// @spec ASC-005 — Stable test ids for agent controls
export function ChatInputAgentOptions({
  controls,
  disabled = false,
}: ChatInputAgentOptionsProps) {
  const { t } = useTranslation("openhands");
  if (controls.options.length === 0 && !controls.rejection) return null;

  return (
    <div className="mb-2 flex w-full flex-col gap-1">
      {controls.options.length > 0 ? (
        <div
          role="group"
          aria-label={t(I18nKey.CHAT_INTERFACE$AGENT_OPTIONS)}
          data-testid="agent-options"
          className="flex flex-wrap gap-2"
        >
          {controls.options.map((option) => (
            <AgentOptionPill
              key={option.id}
              option={option}
              pendingValue={controls.pendingValues[option.id]}
              disabled={disabled}
              onSelect={(value) => controls.setOption(option.id, value)}
            />
          ))}
        </div>
      ) : null}
      {controls.rejection ? (
        <p
          role="status"
          data-testid="agent-option-rejection"
          className="text-xs text-tertiary-light"
        >
          {controls.rejection}
        </p>
      ) : null}
    </div>
  );
}
