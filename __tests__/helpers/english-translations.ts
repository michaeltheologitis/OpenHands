import translations from "#/i18n/translation.json";

type TranslationOptions = Record<string, unknown> & { count?: number };

const table = translations as Record<string, Record<string, string>>;

/**
 * A `t` that renders the real English strings, choosing `_one` or `_other` by
 * `count` and filling in `{{name}}` from the options, so a test can assert the
 * text a user reads. The suite's default mock returns bare keys.
 */
export const englishT = (key: string, options: TranslationOptions = {}) => {
  const plural =
    options.count === undefined
      ? undefined
      : `${key}_${options.count === 1 ? "one" : "other"}`;
  const template = (plural && table[plural]?.en) ?? table[key]?.en ?? key;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    String(options[name] ?? ""),
  );
};
