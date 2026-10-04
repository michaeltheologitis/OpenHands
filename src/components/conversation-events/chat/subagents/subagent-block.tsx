import React from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import ArrowDown from "#/icons/angle-down-solid.svg?react";
import ArrowUp from "#/icons/angle-up-solid.svg?react";
import { I18nKey } from "#/i18n/declaration";
import { cn } from "#/utils/utils";
import { MAX_INDENTED_DEPTH, summaryLabel } from "./subagent-labels";
import { SubagentRow } from "./subagent-row";
import { useSubagents } from "./subagent-source";

export interface SubagentBlockProps {
  /** `toolCallKey` of the spawning call. */
  cellKey: string;
  /** Depth of the children in this block; children of root calls are 1. */
  depth: number;
}

/** Nested sub-agent content is indented under a rule, down to a limit. */
export const nestedIndentClass = (depth: number) =>
  depth <= MAX_INDENTED_DEPTH ? "ml-2 border-l border-border pl-3" : "";

/** The summary line, collapsed by default, and the children when expanded. */
export function SubagentBlock({ cellKey, depth }: SubagentBlockProps) {
  const { t } = useTranslation("openhands");
  const [expanded, setExpanded] = React.useState(false);
  const contentId = React.useId();
  const sessionIds = useSubagents((index) =>
    index.placement.byCell.get(cellKey),
  );
  const summary = useSubagents((index) =>
    index.placement.cellSummaries.get(cellKey),
  );

  if (!sessionIds || !summary) return null;

  const Chevron = expanded ? ArrowUp : ArrowDown;
  return (
    <div
      data-testid="subagent-block"
      data-subagent-count={summary.total}
      className={cn("mb-1 text-sm", nestedIndentClass(depth))}
    >
      <button
        type="button"
        data-testid="subagent-block-toggle"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={contentId}
        title={
          expanded ? t(I18nKey.SUBAGENTS$COLLAPSE) : t(I18nKey.SUBAGENTS$EXPAND)
        }
        className="flex w-full cursor-pointer items-center gap-2 text-left font-normal text-muted"
      >
        <Chevron className="h-4 w-4 flex-shrink-0 fill-muted" />
        <span className="truncate">{summaryLabel(t, summary)}</span>
        {summary.running > 0 && (
          <LoaderCircle
            data-testid="spinner-icon"
            className="h-4 w-4 flex-shrink-0 animate-spin text-muted"
          />
        )}
      </button>
      {expanded && (
        <ul id={contentId} className="mt-1 flex flex-col gap-1">
          {sessionIds.map((sessionId) => (
            <SubagentRow key={sessionId} sessionId={sessionId} depth={depth} />
          ))}
        </ul>
      )}
    </div>
  );
}
