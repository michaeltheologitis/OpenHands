/**
 * What a build's config/defaults.json may set for the npm and desktop
 * launchers, and the checks on those values.
 *
 * Dependency-free (Node built-ins only): the packaged desktop app strips
 * node_modules, so a bare import here would fail only in the installed app.
 */

/**
 * Accept an https:// or ssh:// URL with no whitespace; reject anything else (an
 * scp-style git@host:path, a bare owner/repo, a git+ prefix, http://, file://).
 * uv fetches a git requirement over `git+https` or `git+ssh`; the launcher adds
 * the `git+` prefix itself.
 *
 * @param {unknown} value
 * @param {string} name  how errors name the value, e.g. "OH_AGENT_SERVER_GIT_REPO"
 * @returns {string} the value
 * @throws {Error} `${name} must be an https or ssh git URL, got: ${value}`
 */
export function validateGitRepoUrl(value, name) {
  if (typeof value === "string" && !/\s/.test(value)) {
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "ssh:") && url.host) {
        return value;
      }
    } catch {
      // Not a URL at all; reported below.
    }
  }
  throw new Error(`${name} must be an https or ssh git URL, got: ${value}`);
}
