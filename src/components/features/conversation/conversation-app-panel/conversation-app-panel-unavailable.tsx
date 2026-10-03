import { useTranslation } from "react-i18next";
import { I18nKey } from "#/i18n/declaration";

/** The App panel's unavailable state; mirrors the App route page's. */
export function ConversationAppPanelUnavailable({
  error,
}: {
  error: string | null;
}) {
  const { t } = useTranslation("openhands");
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-lg rounded-xl border border-border bg-base-secondary p-6 text-center">
        <h2 className="text-lg font-semibold text-contrast">
          {t(I18nKey.SETUP$UNAVAILABLE_TITLE)}
        </h2>
        <p className="mt-2 text-sm text-tertiary-light">
          {error || t(I18nKey.SETTINGS$APPS_PAGE_UNAVAILABLE)}
        </p>
      </div>
    </div>
  );
}
