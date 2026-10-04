import { useTranslation } from "react-i18next";
import { SettingsSwitch } from "#/components/features/settings/settings-switch";
import {
  useShowSubagentCosts,
  writeShowSubagentCosts,
} from "#/components/conversation-events/chat/subagents/subagent-cost-preference";
import { I18nKey } from "#/i18n/declaration";

export function SubagentCostsSwitch() {
  const { t } = useTranslation("openhands");
  const showCosts = useShowSubagentCosts();

  return (
    <SettingsSwitch
      testId="show-subagent-costs-switch"
      isToggled={showCosts}
      onToggle={writeShowSubagentCosts}
    >
      {t(I18nKey.SETTINGS$SHOW_SUBAGENT_COSTS)}
    </SettingsSwitch>
  );
}
