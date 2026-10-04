import React from "react";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle, Square } from "lucide-react";
import ArrowDown from "#/icons/angle-down-solid.svg?react";
import ArrowUp from "#/icons/angle-up-solid.svg?react";
import { I18nKey } from "#/i18n/declaration";
import {
  formatSubagentCost,
  getSubagentStatus,
} from "#/utils/subagents/subagent-status";
import {
  MAX_INDENTED_DEPTH,
  statusLabel,
  SUBAGENT_TOOL_CALLS_I18N_KEY,
} from "./subagent-labels";
import { useSubagents } from "./subagent-source";
import { StopSubagentButton } from "./stop-subagent-button";
import { SubagentTranscript } from "./subagent-transcript";

export interface SubagentRowProps {
  sessionId: string;
  depth: number;
}

const firstLineOf = (text: string) => text.trim().split("\n", 1)[0];

/** One child: status, title, answer, tool calls, cost, Stop; its transcript. */
export const SubagentRow = React.memo(function SubagentRow({
  sessionId,
  depth,
}: SubagentRowProps) {
  const { t } = useTranslation("openhands");
  const [expanded, setExpanded] = React.useState(false);
  const record = useSubagents((index) => index.children.get(sessionId));
  const stats = useSubagents((index) => index.stats.get(sessionId));
  const answer = useSubagents((index) =>
    stats?.answerKey ? index.messages.get(stats.answerKey) : undefined,
  );

  if (!record) return null;

  const status = getSubagentStatus(record);
  const title =
    record.latest.title || t(I18nKey.SUBAGENTS$UNTITLED, { id: sessionId });
  const answerText = answer?.latest.text
    ? firstLineOf(answer.latest.text)
    : null;
  const cost = formatSubagentCost(
    record.latest.cost,
    record.latest.cost_currency,
  );
  const Chevron = expanded ? ArrowUp : ArrowDown;

  return (
    <li
      data-testid="subagent-row"
      data-acp-session-id={sessionId}
      data-subagent-status={status.category}
      data-subagent-stale={status.stale ? "" : undefined}
      className="flex flex-col"
    >
      <div className="flex min-w-0 items-center gap-2 text-muted">
        <button
          type="button"
          data-testid="subagent-row-toggle"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={t(
            expanded
              ? I18nKey.SUBAGENTS$COLLAPSE_ONE
              : I18nKey.SUBAGENTS$EXPAND_ONE,
            { title },
          )}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left font-normal"
        >
          <Chevron className="h-3 w-3 flex-shrink-0 fill-muted" />
          {status.category === "running" && (
            <LoaderCircle
              data-testid="spinner-icon"
              className="h-4 w-4 flex-shrink-0 animate-spin"
            />
          )}
          {status.category === "done" && (
            <Check
              data-testid="subagent-done-icon"
              className="h-4 w-4 flex-shrink-0"
              aria-hidden
            />
          )}
          {status.category === "stopped" && (
            <Square
              data-testid="subagent-stopped-icon"
              className="h-3 w-3 flex-shrink-0"
              aria-hidden
            />
          )}
          <span data-testid="subagent-status" className="flex-shrink-0">
            {statusLabel(t, status)}
          </span>
          <span
            data-testid="subagent-title"
            className="truncate text-foreground"
          >
            {title}
          </span>
          {depth > MAX_INDENTED_DEPTH && (
            <span className="flex-shrink-0 text-xs">
              {t(I18nKey.SUBAGENTS$DEPTH, { depth })}
            </span>
          )}
          {answerText && (
            <q data-testid="subagent-answer" className="truncate">
              {answerText}
            </q>
          )}
          <span data-testid="subagent-tool-calls" className="flex-shrink-0">
            {t(SUBAGENT_TOOL_CALLS_I18N_KEY, { count: stats?.toolCalls ?? 0 })}
          </span>
        </button>
        {cost && (
          <span data-testid="subagent-cost" className="flex-shrink-0 text-xs">
            {cost}
          </span>
        )}
        <StopSubagentButton sessionId={sessionId} title={title} />
      </div>
      {expanded && <SubagentTranscript sessionId={sessionId} depth={depth} />}
    </li>
  );
});
