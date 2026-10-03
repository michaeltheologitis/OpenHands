import React from "react";
import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";
import { MarkdownRenderer } from "#/components/features/markdown/markdown-renderer";
import {
  compareTimestamps,
  routeKey,
  toSessionRef,
  type SubagentAnchor,
  type TranscriptItem,
} from "#/utils/subagents/subagent-index";
import {
  anchorsForParent,
  NO_SUBAGENT_ANCHORS,
} from "#/utils/subagents/subagent-placement";
import { cn } from "#/utils/utils";
import { CollapsibleThinking } from "../event-message-components/collapsible-thinking";
import { AcpToolCallCell } from "./acp-tool-call-cell";
import { nestedIndentClass } from "./subagent-block";
import { SubagentRow } from "./subagent-row";
import { SubagentHistoryContext, useSubagents } from "./subagent-source";

export interface SubagentTranscriptProps {
  sessionId: string;
  depth: number;
}

type TranscriptEntry =
  | TranscriptItem
  | { kind: "anchor"; anchor: SubagentAnchor };

const NO_ITEMS: readonly TranscriptItem[] = [];

const atOf = (entry: TranscriptEntry) =>
  entry.kind === "anchor" ? entry.anchor.at : entry.at;

/** Items and anchored children merged by `at`; items first on a tie. */
const mergeByAt = (
  items: readonly TranscriptItem[],
  anchors: readonly SubagentAnchor[],
): TranscriptEntry[] =>
  [
    ...items,
    ...anchors.map((anchor) => ({ kind: "anchor" as const, anchor })),
  ].sort((a, b) => compareTimestamps(atOf(a), atOf(b)));

const keyOf = (entry: TranscriptEntry) => {
  if (entry.kind === "anchor") return `subagent-${entry.anchor.sessionId}`;
  if (entry.kind === "text") return entry.event.id;
  return entry.key;
};

/** The child's task: its parent's first message to it, else its description. */
function SubagentTask({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation("openhands");
  const latest = useSubagents((index) => index.children.get(sessionId)?.latest);
  const task = useSubagents((index) => {
    const parent = toSessionRef(latest?.parent_session_id);
    const key = index.firstMessageTo.get(routeKey(parent, sessionId));
    return key === undefined ? undefined : index.messages.get(key);
  });
  const text = task?.latest.text || latest?.description;
  if (!text) return null;
  return (
    <div data-testid="subagent-task" className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">
        {t(I18nKey.SUBAGENTS$TASK)}
      </span>
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  );
}

function TranscriptToolCall({
  callKey,
  depth,
}: {
  callKey: string;
  depth: number;
}) {
  const event = useSubagents((index) => index.toolCalls.get(callKey)?.latest);
  return event ? <AcpToolCallCell event={event} depth={depth} /> : null;
}

/** "To …" for what the child sent, "From …" for what it received. */
function TranscriptMessage({
  messageKey,
  sessionId,
}: {
  messageKey: string;
  sessionId: string;
}) {
  const { t } = useTranslation("openhands");
  const message = useSubagents(
    (index) => index.messages.get(messageKey)?.latest,
  );
  const sent = message?.sender_session_id === sessionId;
  const other = sent
    ? message?.recipient_session_id
    : message?.sender_session_id;
  const otherRecord = useSubagents((index) =>
    other ? index.children.get(other) : undefined,
  );
  if (!message?.text) return null;
  const isOwnChild =
    toSessionRef(otherRecord?.latest.parent_session_id) === sessionId;
  // A message to one of this child's own children is that child's task.
  if (sent && otherRecord && isOwnChild) return null;

  const name =
    otherRecord?.latest.title ||
    (otherRecord ? other : t(I18nKey.SUBAGENTS$MAIN_AGENT));
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted">
        {t(
          sent ? I18nKey.SUBAGENTS$MESSAGE_TO : I18nKey.SUBAGENTS$MESSAGE_FROM,
          { name },
        )}
      </span>
      <MarkdownRenderer>{message.text}</MarkdownRenderer>
    </div>
  );
}

/** A child's task, then its entries and anchored children, in log order. */
export function SubagentTranscript({
  sessionId,
  depth,
}: SubagentTranscriptProps) {
  const items = useSubagents((index) => index.transcripts.get(sessionId));
  const placed = useSubagents((index) =>
    index.placement.byAnchor.get(sessionId),
  );
  const pending = useSubagents((index) => index.placement.pending);
  const historyComplete = React.useContext(SubagentHistoryContext);
  const entries = React.useMemo(
    () =>
      mergeByAt(
        items ?? NO_ITEMS,
        anchorsForParent(
          placed ?? NO_SUBAGENT_ANCHORS,
          pending,
          sessionId,
          historyComplete,
        ),
      ),
    [items, placed, pending, sessionId, historyComplete],
  );

  const renderEntry = (entry: TranscriptEntry) => {
    switch (entry.kind) {
      case "tool_call":
        return <TranscriptToolCall callKey={entry.key} depth={depth} />;
      case "message":
        return (
          <TranscriptMessage messageKey={entry.key} sessionId={sessionId} />
        );
      case "text":
        return entry.event.thought ? (
          <CollapsibleThinking content={entry.event.text} />
        ) : (
          <MarkdownRenderer>{entry.event.text}</MarkdownRenderer>
        );
      default:
        return (
          <ul>
            <SubagentRow sessionId={entry.anchor.sessionId} depth={depth + 1} />
          </ul>
        );
    }
  };

  return (
    <div
      data-testid="subagent-transcript"
      className={cn("mt-1 flex flex-col gap-1", nestedIndentClass(depth))}
    >
      <SubagentTask sessionId={sessionId} />
      {entries.map((entry) => (
        <React.Fragment key={keyOf(entry)}>{renderEntry(entry)}</React.Fragment>
      ))}
    </div>
  );
}
