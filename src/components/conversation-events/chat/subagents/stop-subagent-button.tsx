import React from "react";
import { useTranslation } from "react-i18next";
import { Square } from "lucide-react";
import { StyledTooltip } from "#/components/shared/buttons/styled-tooltip";
import { useActiveConversation } from "#/hooks/query/use-active-conversation";
import { useCancelAcpSession } from "#/hooks/mutation/use-cancel-acp-session";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import {
  canStopSubagent,
  isStopWithheld,
} from "#/utils/subagents/subagent-status";
import { SubagentSourceContext, useSubagents } from "./subagent-source";

export interface StopSubagentButtonProps {
  sessionId: string;
  title: string;
}

const STOP_CLASS =
  "flex flex-shrink-0 items-center gap-1 rounded border border-border px-1.5 text-xs";

/** Stop for a child that granted cancel; never optimistic. */
function StopControl({ sessionId, title }: StopSubagentButtonProps) {
  const { t } = useTranslation("openhands");
  const { data: conversation } = useActiveConversation();
  const { mutate, isPending } = useCancelAcpSession();
  const [requested, setRequested] = React.useState(false);
  const busy = requested || isPending;

  const stop = () => {
    if (busy || !conversation) return;
    mutate(
      {
        conversationId: conversation.id,
        conversationUrl: conversation.conversation_url ?? null,
        sessionApiKey: conversation.session_api_key ?? null,
        sessionId,
      },
      { onSuccess: () => setRequested(true) },
    );
  };

  return (
    <button
      type="button"
      data-testid="subagent-stop"
      data-subagent-stop={requested ? "stopping" : "ready"}
      aria-disabled={busy || undefined}
      aria-label={
        requested
          ? t(I18nKey.SUBAGENTS$STOPPING)
          : t(I18nKey.SUBAGENTS$STOP_LABEL, { title })
      }
      onClick={stop}
      className={cn(
        STOP_CLASS,
        busy ? "cursor-default opacity-60" : "cursor-pointer",
      )}
    >
      <Square className="h-3 w-3" />
      {requested ? t(I18nKey.SUBAGENTS$STOPPING) : t(I18nKey.SUBAGENTS$STOP)}
    </button>
  );
}

/** Stop shown disabled, saying why: the agent withheld `cancel`. */
function WithheldStop() {
  const { t } = useTranslation("openhands");
  return (
    <StyledTooltip content={t(I18nKey.SUBAGENTS$STOP_WITHHELD)} placement="top">
      <button
        type="button"
        data-testid="subagent-stop"
        data-subagent-stop="withheld"
        aria-disabled
        className={cn(STOP_CLASS, "cursor-not-allowed opacity-50")}
      >
        <Square className="h-3 w-3" />
        {t(I18nKey.SUBAGENTS$STOP)}
      </button>
    </StyledTooltip>
  );
}

/** Enabled iff `canStopSubagent`; disabled with the reason iff withheld. */
export function StopSubagentButton({
  sessionId,
  title,
}: StopSubagentButtonProps) {
  const { readOnly } = React.useContext(SubagentSourceContext);
  const record = useSubagents((index) => index.children.get(sessionId));

  if (readOnly || !record) return null;
  if (canStopSubagent(record)) {
    return <StopControl sessionId={sessionId} title={title} />;
  }
  return isStopWithheld(record) ? <WithheldStop /> : null;
}
