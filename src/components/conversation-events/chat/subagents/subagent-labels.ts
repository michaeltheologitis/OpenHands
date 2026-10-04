import type { TFunction } from "i18next";
import { I18nKey } from "#/i18n/declaration";
import type {
  SubagentStatus,
  SubagentStatusCategory,
  SubagentSummary,
} from "#/utils/subagents/subagent-status";

/** Plural keys: `_one` and `_other` exist in translation.json, not the base. */
const SUBAGENT_COUNT_I18N_KEY = "SUBAGENTS$COUNT";
export const SUBAGENT_TOOL_CALLS_I18N_KEY = "SUBAGENTS$TOOL_CALLS";
export const SUBAGENTS_UNPLACED_I18N_KEY = "SUBAGENTS$UNPLACED";

/** Visual indentation stops here; deeper rows show their depth instead. */
export const MAX_INDENTED_DEPTH = 6;

// A non-localizable separator glyph between summary parts.
const SUMMARY_SEPARATOR = " · ";

const STATUS_LABEL_KEYS: Record<
  Exclude<SubagentStatusCategory, "other">,
  I18nKey
> = {
  running: I18nKey.SUBAGENTS$STATUS_RUNNING,
  waiting: I18nKey.SUBAGENTS$STATUS_WAITING,
  done: I18nKey.SUBAGENTS$STATUS_DONE,
  stopped: I18nKey.SUBAGENTS$STATUS_STOPPED,
  limited: I18nKey.SUBAGENTS$STATUS_LIMITED,
  refused: I18nKey.SUBAGENTS$STATUS_REFUSED,
  unconfirmed: I18nKey.SUBAGENTS$STATUS_UNCONFIRMED,
};

/** The summary's count parts, in this fixed order; zero parts are omitted. */
const SUMMARY_ORDER = [
  "done",
  "running",
  "waiting",
  "stopped",
  "limited",
  "refused",
  "unconfirmed",
  "other",
] as const;

const categoryLabel = (
  t: TFunction<"openhands">,
  category: SubagentStatusCategory,
  reported: string | null,
) => (category === "other" ? (reported ?? "") : t(STATUS_LABEL_KEYS[category]));

/** "running", "running · last known", or an agent's own state as reported. */
export function statusLabel(
  t: TFunction<"openhands">,
  status: SubagentStatus,
): string {
  if (status.lastKnown) {
    return [
      categoryLabel(t, status.lastKnown, status.reported),
      t(I18nKey.SUBAGENTS$LAST_KNOWN),
    ].join(SUMMARY_SEPARATOR);
  }
  return categoryLabel(t, status.category, status.reported);
}

/** "3 sub-agents · 2 done · 1 running". Costs are never on it (never added). */
export function summaryLabel(
  t: TFunction<"openhands">,
  summary: SubagentSummary,
): string {
  const parts = SUMMARY_ORDER.filter((category) => summary[category] > 0).map(
    (category) =>
      t(I18nKey.SUBAGENTS$SUMMARY_PART, {
        count: summary[category],
        status: categoryLabel(t, category, t(I18nKey.SUBAGENTS$STATUS_OTHER)),
      }),
  );
  return [t(SUBAGENT_COUNT_I18N_KEY, { count: summary.total }), ...parts].join(
    SUMMARY_SEPARATOR,
  );
}
