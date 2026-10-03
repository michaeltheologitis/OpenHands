import React from "react";
import { useTranslation } from "react-i18next";
import { unplacedGroups } from "#/utils/subagents/subagent-placement";
import { SUBAGENTS_UNPLACED_I18N_KEY } from "./subagent-labels";
import { SubagentRow } from "./subagent-row";
import { SubagentHistoryContext, useSubagents } from "./subagent-source";

/** Children whose parent session is not in the conversation, shown apart. */
export function UnplacedSubagents() {
  const { t } = useTranslation("openhands");
  const pending = useSubagents((index) => index.placement.pending);
  const historyComplete = React.useContext(SubagentHistoryContext);
  const groups = React.useMemo(() => unplacedGroups(pending), [pending]);

  if (!historyComplete || groups.length === 0) return null;
  return (
    <>
      {groups.map(({ missingParentId, sessionIds }) => (
        <div
          key={missingParentId}
          data-testid="subagent-unplaced"
          data-missing-parent-session-id={missingParentId}
          className="my-1 flex flex-col gap-1 rounded border border-border p-2 text-sm"
        >
          <p className="text-muted">
            {t(SUBAGENTS_UNPLACED_I18N_KEY, {
              count: sessionIds.length,
              parent: missingParentId,
            })}
          </p>
          <ul className="flex flex-col gap-1">
            {sessionIds.map((sessionId) => (
              <SubagentRow key={sessionId} sessionId={sessionId} depth={1} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
